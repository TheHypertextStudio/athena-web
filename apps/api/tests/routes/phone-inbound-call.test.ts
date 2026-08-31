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

import { startCallbackForInboundCall } from '../../src/routes/phone-call-authorization';
import { CaptureTelephonyProvider } from '../../src/routes/twilio-telephony';
import type * as DirectoryModule from '../../src/routes/phone-directory';
import twilioVoiceRoutes from '../../src/routes/twilio-voice';
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
  it('asks for one DTMF digit and submits empty timeouts to the signed digit route', () => {
    const twiml = twilio.callbackGatherTwiml('auth_123');
    expect(twiml).toContain('input="dtmf"');
    expect(twiml).toContain('numDigits="1"');
    expect(twiml).toContain('timeout="8"');
    expect(twiml).toContain('actionOnEmptyResult="true"');
    expect(twiml).toContain('/callback/auth_123/digit');
  });

  it('creates a callback authorization instead of opening context for a weakly attested call', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    const before = await footprint(caller.userId);

    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_callback_weak',
      StirVerstat: 'TN-Validation-Passed-B',
    });

    expect(decision.disposition).toBe('callback-pending');
    expect(decision.twiml).toContain('call you right back');
    expect(decision.twiml).not.toContain('<ConversationRelay');
    expect(decision.voiceSessionId).toBeUndefined();
    expect(await footprint(caller.userId)).toEqual(before);
    const [authorization] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.inboundCallSid, 'CA_callback_weak'));
    expect(authorization).toMatchObject({
      phoneNumberId: caller.numberId,
      destinationE164: caller.e164,
      source: 'weak_inbound',
      state: 'awaiting_hangup',
    });
  });

  it('opens the restricted session only after digit 1 on the expected callback', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_callback_confirm',
      StirVerstat: 'TN-Validation-Passed-B',
    });
    const [authorization] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.inboundCallSid, 'CA_callback_confirm'));
    if (!authorization) throw new Error('callback authorization missing');
    const telephony = new CaptureTelephonyProvider();
    await startCallbackForInboundCall('CA_callback_confirm', telephony);

    const refused = await twilio.confirmCallbackAuthorization(
      authorization.id,
      'CA_wrong_leg',
      '1',
    );
    expect(refused.disposition).toBe('callback-refused');
    expect(await footprint(caller.userId)).toMatchObject({ sessions: 0, activities: 0 });

    const connected = await twilio.confirmCallbackAuthorization(
      authorization.id,
      telephony.placedCallSids[0] ?? '',
      '1',
    );
    expect(connected.disposition).toBe('connected');
    expect(connected.twiml).toContain('<ConversationRelay');
    const [session] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, connected.voiceSessionId ?? ''));
    expect(session?.authorizationMethod).toBe('callback');
    const duplicate = await twilio.confirmCallbackAuthorization(
      authorization.id,
      telephony.placedCallSids[0] ?? '',
      '1',
    );
    expect(duplicate.voiceSessionId).toBe(connected.voiceSessionId);
    const sessions = await db
      .select({ id: schema.voiceSession.id })
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.callSid, telephony.placedCallSids[0] ?? ''));
    expect(sessions).toHaveLength(1);
    if (connected.voiceSessionId) {
      await voiceService.closeVoiceSession(connected.voiceSessionId, 'caller_hung_up');
    }
  });

  it('rejects a wrong digit and records a stable failure without opening a session', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    await twilio.decideInboundCall({ From: caller.e164, CallSid: 'CA_callback_wrong_digit' });
    const [authorization] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.inboundCallSid, 'CA_callback_wrong_digit'));
    if (!authorization) throw new Error('callback authorization missing');
    const telephony = new CaptureTelephonyProvider();
    await startCallbackForInboundCall('CA_callback_wrong_digit', telephony);

    const refused = await twilio.confirmCallbackAuthorization(
      authorization.id,
      telephony.placedCallSids[0] ?? '',
      '7',
    );

    expect(refused.disposition).toBe('callback-refused');
    expect(await footprint(caller.userId)).toMatchObject({ sessions: 0, activities: 0 });
    const [failed] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.id, authorization.id));
    expect(failed).toMatchObject({ state: 'failed', failureReason: 'confirmation_rejected' });
  });

  it('expires a callback before accepting its confirmation digit', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    const startedAt = new Date('2026-08-30T12:00:00.000Z');
    await twilio.decideInboundCall(
      { From: caller.e164, CallSid: 'CA_callback_expired' },
      startedAt,
    );
    const [authorization] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.inboundCallSid, 'CA_callback_expired'));
    if (!authorization) throw new Error('callback authorization missing');
    const telephony = new CaptureTelephonyProvider();
    await startCallbackForInboundCall(
      'CA_callback_expired',
      telephony,
      new Date('2026-08-30T12:00:10.000Z'),
    );

    const refused = await twilio.confirmCallbackAuthorization(
      authorization.id,
      telephony.placedCallSids[0] ?? '',
      '1',
      new Date('2026-08-30T12:05:01.000Z'),
    );

    expect(refused.disposition).toBe('callback-refused');
    expect(await footprint(caller.userId)).toMatchObject({ sessions: 0, activities: 0 });
    const [expired] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.id, authorization.id));
    expect(expired).toMatchObject({ state: 'expired', failureReason: 'authorization_expired' });
  });

  it('connects an entitled caller and binds the call to their one conversation', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_connect_1',
      StirVerstat: 'TN-Validation-Passed-A',
    });

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
    const second = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_cycle_2',
      StirVerstat: 'TN-Validation-Passed-A',
    });
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
    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_stamp_1',
      StirVerstat: 'TN-Validation-Passed-A',
    });
    const [number] = await db
      .select()
      .from(schema.phoneNumber)
      .where(eq(schema.phoneNumber.id, caller.numberId));
    expect(number?.lastCalledAt).not.toBeNull();
    if (decision.voiceSessionId) {
      await voiceService.closeVoiceSession(decision.voiceSessionId, 'caller_hung_up');
    }
  });

  it('revokes the live engine and provider call when phone access is paused', async () => {
    const caller = await seedCaller({});
    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_revoke_live',
      StirVerstat: 'TN-Validation-Passed-A',
    });
    if (!decision.voiceSessionId) throw new Error('expected connected call');
    const telephony = new CaptureTelephonyProvider();

    await voiceService.revokePhoneAccess(caller.numberId, telephony);

    expect(voiceService.liveVoiceSession(decision.voiceSessionId)).toBeNull();
    expect(telephony.endedCallSids).toEqual(['CA_revoke_live']);
    const [row] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, decision.voiceSessionId));
    expect(row).toMatchObject({ status: 'ended', endedReason: 'phone_access_revoked' });
  });

  it('keeps a live session open for non-terminal Twilio call statuses', async () => {
    const caller = await seedCaller({});
    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_status_ringing',
      StirVerstat: 'TN-Validation-Passed-A',
    });
    if (!decision.voiceSessionId) throw new Error('expected connected call');

    await twilio.handleCallStatus('CA_status_ringing', 'answered', new CaptureTelephonyProvider());

    expect(voiceService.liveVoiceSession(decision.voiceSessionId)).not.toBeNull();
    await voiceService.closeVoiceSession(decision.voiceSessionId, 'caller_hung_up');
  });

  it('ends the session once the call itself has ended', async () => {
    const caller = await seedCaller({});
    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_status_completed',
      StirVerstat: 'TN-Validation-Passed-A',
    });
    if (!decision.voiceSessionId) throw new Error('expected connected call');

    await twilio.handleCallStatus(
      'CA_status_completed',
      'completed',
      new CaptureTelephonyProvider(),
    );

    // A session left open after the caller hangs up holds a relay socket and a model context for a
    // conversation nobody is in.
    expect(voiceService.liveVoiceSession(decision.voiceSessionId)).toBeNull();
    const [row] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, decision.voiceSessionId));
    expect(row).toMatchObject({ status: 'ended', endedReason: 'caller_hung_up' });
  });

  it('refuses every telephony webhook that is not signed by Twilio', async () => {
    // These four endpoints connect calls, confirm callback authorizations, and close sessions.
    // An unsigned POST is anybody on the internet, so each must refuse before it reads a
    // parameter — not merely fail to find a matching record.
    const unsigned = (path: string, body: Record<string, string>) =>
      twilioVoiceRoutes.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });

    for (const [path, body] of [
      ['/voice', { From: '+14155550123', CallSid: 'CA_unsigned' }],
      ['/callback/auth_unsigned/answer', { CallSid: 'CA_unsigned' }],
      ['/callback/auth_unsigned/digit', { CallSid: 'CA_unsigned', Digits: '1' }],
      ['/status', { CallSid: 'CA_unsigned', CallStatus: 'completed' }],
    ] as const) {
      const response = await unsigned(path, body);
      expect(response.status, path).toBe(403);
    }
  });

  it('treats a repeated status webhook for a finished call as a no-op', async () => {
    const caller = await seedCaller({});
    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_status_repeat',
      StirVerstat: 'TN-Validation-Passed-A',
    });
    if (!decision.voiceSessionId) throw new Error('expected connected call');
    const telephony = new CaptureTelephonyProvider();
    await twilio.handleCallStatus('CA_status_repeat', 'completed', telephony);

    // Twilio retries status webhooks, so the second delivery arrives with the session already
    // closed. It has to settle quietly rather than throw or re-close.
    await twilio.handleCallStatus('CA_status_repeat', 'completed', telephony);

    const [row] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, decision.voiceSessionId));
    expect(row).toMatchObject({ status: 'ended', endedReason: 'caller_hung_up' });
    expect(telephony.callbacks).toEqual([]);
  });

  it('records why a callback leg never reached the caller', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_callback_unanswered',
      StirVerstat: 'TN-Validation-Passed-B',
    });
    const [authorization] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.inboundCallSid, 'CA_callback_unanswered'));
    if (!authorization) throw new Error('callback authorization missing');
    const telephony = new CaptureTelephonyProvider();
    await startCallbackForInboundCall('CA_callback_unanswered', telephony);

    await twilio.handleCallStatus(telephony.placedCallSids[0] ?? '', 'no-answer', telephony);

    // The authorization has to settle, and it has to say why: an authorization left `dialing`
    // forever is one the caller can neither use nor retry past.
    const [settled] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.id, authorization.id));
    expect(settled).toMatchObject({ state: 'failed', failureReason: 'callback_no_answer' });
  });

  it('completes a callback authorization once its answered leg hangs up', async () => {
    const caller = await seedCaller({ lifecycleState: 'active' });
    await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_callback_done',
      StirVerstat: 'TN-Validation-Passed-B',
    });
    const [authorization] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.inboundCallSid, 'CA_callback_done'));
    if (!authorization) throw new Error('callback authorization missing');
    const telephony = new CaptureTelephonyProvider();
    await startCallbackForInboundCall('CA_callback_done', telephony);
    const outboundSid = telephony.placedCallSids[0] ?? '';
    const connected = await twilio.confirmCallbackAuthorization(authorization.id, outboundSid, '1');
    expect(connected.disposition).toBe('connected');

    await twilio.handleCallStatus(outboundSid, 'completed', telephony);

    // A callback that did its job ends `completed`, never `failed` — the two are the difference
    // between "this number reached its owner" and "this number should be backed off".
    const [settled] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.id, authorization.id));
    expect(settled).toMatchObject({ state: 'completed', failureReason: null });
    if (connected.voiceSessionId) {
      await voiceService.closeVoiceSession(connected.voiceSessionId, 'caller_hung_up');
    }
  });

  it('ends the session on a call that failed rather than completed, and calls nobody back', async () => {
    const caller = await seedCaller({});
    const decision = await twilio.decideInboundCall({
      From: caller.e164,
      CallSid: 'CA_status_no_answer',
      StirVerstat: 'TN-Validation-Passed-A',
    });
    if (!decision.voiceSessionId) throw new Error('expected connected call');
    const telephony = new CaptureTelephonyProvider();

    await twilio.handleCallStatus('CA_status_no_answer', 'no-answer', telephony);

    expect(voiceService.liveVoiceSession(decision.voiceSessionId)).toBeNull();
    // Only a completed call starts a callback. A call that never connected must not cause Docket
    // to ring the caller back on its own.
    expect(telephony.callbacks).toEqual([]);
  });
});
