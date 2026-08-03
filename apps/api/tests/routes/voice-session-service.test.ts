/**
 * `@docket/api` — the voice session service's edge branches not already exercised by
 * `voice-channel-parity.test.ts` / `voice-telephony-protocol.test.ts`: entitlement short-circuits,
 * the no-workspace refusal, the non-responding (real speech-to-speech) channel, the process-local
 * registry's stale/unknown lookups, closing a session this process never lived, and the
 * recall/recent-turns text projections across every author/channel/voice-marker combination.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { NotFoundError } from '../../src/error';
import type {
  closeVoiceSession as CloseVoiceSession,
  isAthenaEntitled as IsAthenaEntitled,
  liveVoiceSessionByCallSid as LiveVoiceSessionByCallSid,
  openVoiceSession as OpenVoiceSession,
  recentConversation as RecentConversation,
  recentTurns as RecentTurns,
  rememberCallSid as RememberCallSid,
  resolveVoiceWorkspace as ResolveVoiceWorkspace,
} from '../../src/routes/voice-session-service';
import { addMember, getDb, seedOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let openVoiceSession!: typeof OpenVoiceSession;
let closeVoiceSession!: typeof CloseVoiceSession;
let isAthenaEntitled!: typeof IsAthenaEntitled;
let resolveVoiceWorkspace!: typeof ResolveVoiceWorkspace;
let liveVoiceSessionByCallSid!: typeof LiveVoiceSessionByCallSid;
let rememberCallSid!: typeof RememberCallSid;
let recentConversation!: typeof RecentConversation;
let recentTurns!: typeof RecentTurns;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({
    openVoiceSession,
    closeVoiceSession,
    isAthenaEntitled,
    resolveVoiceWorkspace,
    liveVoiceSessionByCallSid,
    rememberCallSid,
    recentConversation,
    recentTurns,
  } = await import('../../src/routes/voice-session-service'));
});

let seq = 0;

/** Seed a person with an active personal workspace they own. */
async function seedPerson() {
  seq += 1;
  const userId = await seedUserWithHub(db, schema, `VoiceSvc${String(seq)}`);
  const orgId = await seedOrg(db, schema, true);
  await db
    .update(schema.organization)
    .set({ lifecycleState: 'active' })
    .where(eq(schema.organization.id, orgId));
  await addMember(db, schema, orgId, userId, 'owner');
  return { userId, orgId };
}

describe('isAthenaEntitled', () => {
  it('is false for a null workspace, with no lookup at all', async () => {
    expect(await isAthenaEntitled(null)).toBe(false);
  });

  it('is false rather than throwing when the workspace does not exist', async () => {
    expect(await isAthenaEntitled('org_does_not_exist')).toBe(false);
  });
});

describe('resolveVoiceWorkspace and the no-workspace refusal', () => {
  it('resolves to no workspace for an account with no personal organization', async () => {
    const userId = await seedUserWithHub(db, schema, `Homeless${String(++seq)}`);
    expect(await resolveVoiceWorkspace(userId)).toBeNull();
  });

  it('refuses to open a voice session with no workspace to talk about', async () => {
    const userId = await seedUserWithHub(db, schema, `Homeless${String(++seq)}`);
    await expect(openVoiceSession({ userId, channel: 'web', provider: 'mock' })).rejects.toThrow(
      NotFoundError,
    );
    await expect(openVoiceSession({ userId, channel: 'web', provider: 'mock' })).rejects.toThrow(
      /no workspace to talk about/i,
    );
  });
});

describe('openVoiceSession on a channel whose provider generates its own reply', () => {
  it('configures no responder for a real speech-to-speech web session', async () => {
    const person = await seedPerson();
    const opened = await openVoiceSession({
      userId: person.userId,
      channel: 'web',
      provider: 'openai-realtime',
      organizationId: person.orgId,
    });
    try {
      // With no responder configured, a final user transcript produces no reply commands at all —
      // the speech-to-speech model, not this engine, is expected to generate one in-band.
      const step = await opened.engine.receive([
        { type: 'user.transcript', text: 'Hello Athena', final: true },
      ]);
      expect(step.commands).toEqual([]);
    } finally {
      await closeVoiceSession(opened.voiceSessionId, 'user_ended');
    }
  });
});

describe('the process-local live-session registry', () => {
  it('returns null for a call sid no webhook ever registered', () => {
    expect(liveVoiceSessionByCallSid('CA_never_registered')).toBeNull();
  });

  it('returns null for a call sid mapped to a session this process no longer holds', () => {
    rememberCallSid('vs_not_actually_live', 'CA_orphaned');
    expect(liveVoiceSessionByCallSid('CA_orphaned')).toBeNull();
  });
});

describe('closing a session this process is not driving', () => {
  it('closes a durable row directly when no live engine is registered for it', async () => {
    const person = await seedPerson();
    const conversation = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id });
    const [row] = await db
      .insert(schema.voiceSession)
      .values({
        conversationId: conversation[0]!.id,
        userId: person.userId,
        organizationId: person.orgId,
        channel: 'web',
        provider: 'mock',
        status: 'active',
      })
      .returning({ id: schema.voiceSession.id });

    await closeVoiceSession(row!.id, 'transport_closed');

    const [closed] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, row!.id));
    expect(closed).toMatchObject({ status: 'ended', endedReason: 'transport_closed' });
    expect(closed?.endedAt).toBeInstanceOf(Date);
  });

  it('leaves an already-ended row alone rather than reopening it', async () => {
    const person = await seedPerson();
    const conversation = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id });
    const endedAt = new Date('2026-01-01T00:00:00.000Z');
    const [row] = await db
      .insert(schema.voiceSession)
      .values({
        conversationId: conversation[0]!.id,
        userId: person.userId,
        organizationId: person.orgId,
        channel: 'web',
        provider: 'mock',
        status: 'ended',
        endedAt,
        endedReason: 'caller_hung_up',
      })
      .returning({ id: schema.voiceSession.id });

    await closeVoiceSession(row!.id, 'transport_closed');

    const [unchanged] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, row!.id));
    // The conditional update only matches an 'active' row, so a session already closed keeps its
    // original reason rather than being silently overwritten.
    expect(unchanged).toMatchObject({ status: 'ended', endedReason: 'caller_hung_up' });
  });
});

describe('recentConversation', () => {
  it('skips a response row whose body carries no text at all', async () => {
    const person = await seedPerson();
    const conversation = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id });
    const conversationId = conversation[0]!.id;
    await db.insert(schema.sessionActivity).values({
      sessionId: conversationId,
      organizationId: null,
      type: 'response',
      body: { author: 'user' },
    });
    expect(await recentConversation(conversationId)).toBe('');
  });

  it("prefixes Athena's own lines with her name", async () => {
    const person = await seedPerson();
    const conversation = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id });
    const conversationId = conversation[0]!.id;
    await db.insert(schema.sessionActivity).values({
      sessionId: conversationId,
      organizationId: null,
      type: 'response',
      body: { text: 'The venue is booked.', author: 'athena' },
    });
    expect(await recentConversation(conversationId)).toBe('Athena: The venue is booked.');
  });
});

describe('recentTurns', () => {
  it("returns Athena's own line, on the phone channel, marked interrupted", async () => {
    const person = await seedPerson();
    const conversation = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values({
      sessionId: conversation[0]!.id,
      organizationId: null,
      type: 'response',
      body: {
        text: 'Calling you back about the venue.',
        author: 'athena',
        voice: { channel: 'phone', interrupted: true },
      },
    });

    const turns = await recentTurns(person.userId);
    expect(turns).toEqual([
      expect.objectContaining({
        role: 'athena',
        text: 'Calling you back about the venue.',
        channel: 'phone',
        interrupted: true,
      }),
    ]);
  });

  it('defaults an absent or malformed voice marker to a web, uninterrupted line', async () => {
    const person = await seedPerson();
    const conversation = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        kind: 'chat',
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values([
      {
        sessionId: conversation[0]!.id,
        organizationId: null,
        type: 'response',
        body: { text: 'Typed with no voice marker.', author: 'user' },
      },
      {
        sessionId: conversation[0]!.id,
        organizationId: null,
        type: 'response',
        // `voice` present but explicitly null — `typeof null === 'object'`, so this exercises the
        // marker guard's second condition rather than its first.
        body: { text: 'Voice marker was null.', author: 'user', voice: null },
      },
      {
        sessionId: conversation[0]!.id,
        organizationId: null,
        type: 'response',
        // A row with no text at all is dropped entirely.
        body: { author: 'user' },
      },
    ]);

    const turns = await recentTurns(person.userId, 10);
    expect(turns).toHaveLength(2);
    for (const turn of turns) {
      expect(turn.channel).toBe('web');
      expect(turn.interrupted).toBe(false);
      expect(turn.role).toBe('user');
    }
    // Both rows share the same `createdAt` instant, so only which two texts survived (not their
    // relative order) is a meaningful assertion here.
    expect(new Set(turns.map((t) => t.text))).toEqual(
      new Set(['Typed with no voice marker.', 'Voice marker was null.']),
    );
  });
});
