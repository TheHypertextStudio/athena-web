/**
 * Who reaches Athena on the telephone, and who does not.
 *
 * @remarks
 * These drive the real inbound-call decision against the real database. The two properties worth
 * stating plainly:
 *
 * - **Only a verified, calling-enabled number resolves to an account.** Everything else resolves
 *   to nobody, and nobody has no conversation to read or append to.
 * - **A gated caller creates nothing.** Not a voice session, not a conversation turn, not a model
 *   call. The assertion is on counts before and after, because "we meant to gate it" and "it was
 *   gated" are different claims.
 */
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DirectoryModule from '../../src/routes/phone-directory';
import type * as TwilioModule from '../../src/routes/twilio-voice';
import type * as VoiceServiceModule from '../../src/routes/voice-session-service';
import { addMember, getDb, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let routes!: typeof DirectoryModule;
let twilio!: typeof TwilioModule;
let voiceService!: typeof VoiceServiceModule;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  routes = await import('../../src/routes/phone-directory');
  twilio = await import('../../src/routes/twilio-voice');
  voiceService = await import('../../src/routes/voice-session-service');
});

let seq = 0;
function nextNumber(): string {
  seq += 1;
  return `+1415000${String(1000 + seq)}`;
}

/**
 * Seed a person with a personal workspace, a team to file work into, and a phone number.
 *
 * @param options - Whether the number is verified, whether calling is on, and the plan state.
 */
async function seedCaller(options: {
  readonly status?: 'pending' | 'verified' | 'blocked';
  readonly callingEnabled?: boolean;
  readonly lifecycleState?: 'trialing' | 'active' | 'past_due';
  readonly e164?: string;
}) {
  const userId = await seedUserWithHub(db, schema, `Caller${String(++seq)}`);
  const orgId = await seedOrg(db, schema, true);
  await db
    .update(schema.organization)
    .set({ lifecycleState: options.lifecycleState ?? 'active' })
    .where(eq(schema.organization.id, orgId));
  await db
    .update(schema.organizationProductEntitlement)
    .set({
      status:
        options.lifecycleState === 'past_due'
          ? 'past_due'
          : options.lifecycleState === 'trialing'
            ? 'trialing'
            : 'active',
    })
    .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
  await addMember(db, schema, orgId, userId, 'owner');
  await db.insert(schema.team).values({
    organizationId: orgId,
    name: 'Personal',
    key: `P${Math.random().toString(36).slice(2, 6)}`,
  });
  const e164 = options.e164 ?? nextNumber();
  const number = one(
    await db
      .insert(schema.phoneNumber)
      .values({
        userId,
        e164,
        dialCode: '1',
        country: 'US',
        nationalNumber: e164.slice(2),
        status: options.status ?? 'verified',
        callingEnabled: options.callingEnabled ?? true,
        ...(options.status === 'verified' || options.status === undefined
          ? { verifiedAt: new Date() }
          : {}),
      })
      .returning(),
  );
  return { userId, orgId, e164, numberId: number.id };
}

/** Count the conversation turns and voice sessions that exist for a user. */
async function footprint(userId: string): Promise<{ sessions: number; activities: number }> {
  const sessions = await db
    .select({ id: schema.voiceSession.id })
    .from(schema.voiceSession)
    .where(eq(schema.voiceSession.userId, userId));
  const conversations = await db
    .select({ id: schema.agentSession.id })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.ownerUserId, userId));
  let activities = 0;
  for (const conversation of conversations) {
    const rows = await db
      .select({ id: schema.sessionActivity.id })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, conversation.id));
    activities += rows.length;
  }
  return { sessions: sessions.length, activities };
}

describe('caller id resolution', () => {
  it('resolves a verified, calling-enabled number to its one account', async () => {
    const caller = await seedCaller({});
    const resolution = await routes.resolveCaller(caller.e164);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.caller.userId).toBe(caller.userId);
  });

  it('resolves an unverified, a blocked, a paused and an unknown number to nobody', async () => {
    const pending = await seedCaller({ status: 'pending' });
    const blocked = await seedCaller({ status: 'blocked' });
    const paused = await seedCaller({ callingEnabled: false });

    for (const value of [pending.e164, blocked.e164, paused.e164, '+14155559999']) {
      const resolution = await routes.resolveCaller(value);
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.refusal).toBe('unrecognized');
    }
  });

  it('treats a withheld or unusable caller id as absent rather than guessing', async () => {
    for (const value of [undefined, null, '', 'anonymous', 'unavailable', '+1']) {
      const resolution = await routes.resolveCaller(value);
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.refusal).toBe('no-caller-id');
    }
  });

  it('reads a number out of a SIP URI and normalizes punctuation', () => {
    expect(routes.normalizeCallerId('sip:+14155550123@example.com')).toBe('+14155550123');
    expect(routes.normalizeCallerId(' +1 (415) 555-0123 ')).toBe('+14155550123');
    expect(routes.normalizeCallerId('4155550123')).toBeNull();
  });

  it('cannot let two accounts hold the same verified number', async () => {
    const first = await seedCaller({});
    const second = await seedUserWithHub(db, schema, 'SecondClaimant');
    await expect(
      db.insert(schema.phoneNumber).values({
        userId: second,
        e164: first.e164,
        dialCode: '1',
        country: 'US',
        nationalNumber: first.e164.slice(2),
        status: 'verified',
        verifiedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe('inbound call disposition', () => {
  it('connects an entitled caller and binds the call to their one conversation', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    const decision = await twilio.decideInboundCall({ From: caller.e164, CallSid: 'CA_connect_1' });

    expect(decision.disposition).toBe('connected');
    expect(decision.twiml).toContain('<ConversationRelay');
    expect(decision.voiceSessionId).toBeTruthy();

    const session = one(
      await db
        .select()
        .from(schema.voiceSession)
        .where(eq(schema.voiceSession.id, decision.voiceSessionId ?? '')),
    );
    expect(session.channel).toBe('phone');
    expect(session.callSid).toBe('CA_connect_1');
    expect(session.phoneNumberId).toBe(caller.numberId);

    // The conversation it writes into is the caller's canonical Athena chat, not a call log.
    const conversation = one(
      await db
        .select()
        .from(schema.agentSession)
        .where(
          and(
            eq(schema.agentSession.id, session.conversationId),
            eq(schema.agentSession.ownerUserId, caller.userId),
          ),
        ),
    );
    expect(conversation.kind).toBe('chat');
    expect(conversation.executorKind).toBe('athena');

    await voiceService.closeVoiceSession(session.id, 'caller_hung_up');
  });

  it('gates an unentitled caller and creates absolutely nothing', async () => {
    const caller = await seedCaller({ lifecycleState: 'past_due' });
    const before = await footprint(caller.userId);

    const decision = await twilio.decideInboundCall({ From: caller.e164, CallSid: 'CA_gated_1' });

    expect(decision.disposition).toBe('product-required');
    expect(decision.twiml).toContain('<Say');
    expect(decision.twiml).toContain('<Hangup/>');
    expect(decision.twiml).not.toContain('<ConversationRelay');
    expect(decision.voiceSessionId).toBeUndefined();

    const after = await footprint(caller.userId);
    expect(after).toEqual(before);
    expect(after.sessions).toBe(0);
    expect(after.activities).toBe(0);
  });

  it('lifts the gate once Docket Pro is active, on the very next call', async () => {
    const caller = await seedCaller({ lifecycleState: 'past_due' });
    expect(
      (await twilio.decideInboundCall({ From: caller.e164, CallSid: 'CA_cycle_1' })).disposition,
    ).toBe('product-required');

    await db
      .update(schema.organizationProductEntitlement)
      .set({ status: 'active' })
      .where(eq(schema.organizationProductEntitlement.organizationId, caller.orgId));
    const second = await twilio.decideInboundCall({ From: caller.e164, CallSid: 'CA_cycle_2' });
    expect(second.disposition).toBe('connected');
    if (second.voiceSessionId) {
      await voiceService.closeVoiceSession(second.voiceSessionId, 'caller_hung_up');
    }

    // …and drops again when the plan lapses.
    await db
      .update(schema.organizationProductEntitlement)
      .set({ status: 'past_due' })
      .where(eq(schema.organizationProductEntitlement.organizationId, caller.orgId));
    expect(
      (await twilio.decideInboundCall({ From: caller.e164, CallSid: 'CA_cycle_3' })).disposition,
    ).toBe('product-required');
  });

  it('announces without reaching any account when the number is unrecognized', async () => {
    const decision = await twilio.decideInboundCall({
      From: '+14155558888',
      CallSid: 'CA_unknown_1',
    });
    expect(decision.disposition).toBe('unrecognized-caller');
    expect(decision.twiml).not.toContain('<ConversationRelay');
    expect(decision.voiceSessionId).toBeUndefined();
    // No session anywhere carries this call: an unrecognized number reaches no account at all.
    const sessions = await db
      .select({ id: schema.voiceSession.id })
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.callSid, 'CA_unknown_1'));
    expect(sessions).toHaveLength(0);
  });

  it('stamps the number so a stale binding is visible', async () => {
    const caller = await seedCaller({});
    const decision = await twilio.decideInboundCall({ From: caller.e164, CallSid: 'CA_stamp_1' });
    const [number] = await db
      .select()
      .from(schema.phoneNumber)
      .where(eq(schema.phoneNumber.id, caller.numberId));
    expect(number?.lastCalledAt).not.toBeNull();
    if (decision.voiceSessionId) {
      await voiceService.closeVoiceSession(decision.voiceSessionId, 'caller_hung_up');
    }
  });
});
