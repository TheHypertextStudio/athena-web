/**
 * One conversation, every door (ACH-02, ACH-08, ACH-10, ACH-11).
 *
 * @remarks
 * The claim under test is the one that is easiest to assert and hardest to keep: that web text,
 * web voice and the telephone are the *same* conversation rather than three that get reconciled.
 * These tests read the conversation id out of each entry point and compare it, then push a spoken
 * turn through each channel and read it back out of the shared timeline.
 *
 * They also assert the shape of the sharing: both channels construct the same
 * {@link VoiceSessionEngine} class, and the phone's own module contains no turn-taking of its own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type * as DbModule from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DispatchModule from '../../src/routes/agent-dispatch';
import type * as TwilioModule from '../../src/routes/twilio-voice';
import type * as EngineModule from '../../src/routes/voice-engine';
import type * as VoiceServiceModule from '../../src/routes/voice-session-service';
import { addMember, getDb, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let dispatch!: typeof DispatchModule;
let voiceService!: typeof VoiceServiceModule;
let twilio!: typeof TwilioModule;
let engineModule!: typeof EngineModule;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  dispatch = await import('../../src/routes/agent-dispatch');
  voiceService = await import('../../src/routes/voice-session-service');
  twilio = await import('../../src/routes/twilio-voice');
  engineModule = await import('../../src/routes/voice-engine');
});

let seq = 0;

async function seedPerson() {
  seq += 1;
  const userId = await seedUserWithHub(db, schema, `Parity${String(seq)}`);
  const orgId = await seedOrg(db, schema, true);
  await db
    .update(schema.organization)
    .set({ lifecycleState: 'active' })
    .where(eq(schema.organization.id, orgId));
  await addMember(db, schema, orgId, userId, 'owner');
  await db.insert(schema.team).values({
    organizationId: orgId,
    name: 'Personal',
    key: `T${Math.random().toString(36).slice(2, 6)}`,
  });
  const e164 = `+1415111${String(1000 + seq)}`;
  one(
    await db
      .insert(schema.phoneNumber)
      .values({
        userId,
        e164,
        dialCode: '1',
        country: 'US',
        nationalNumber: e164.slice(2),
        status: 'verified',
        verifiedAt: new Date(),
      })
      .returning(),
  );
  return { userId, orgId, e164 };
}

/** Every visible line of a conversation, oldest first. */
async function timeline(conversationId: string) {
  return db
    .select({ body: schema.sessionActivity.body, type: schema.sessionActivity.type })
    .from(schema.sessionActivity)
    .where(
      and(
        eq(schema.sessionActivity.sessionId, conversationId),
        eq(schema.sessionActivity.type, 'response'),
      ),
    )
    .orderBy(asc(schema.sessionActivity.createdAt));
}

describe('one conversation across every Athena interface', () => {
  it('resolves web text, web voice and an inbound phone call to the same conversation id', async () => {
    const person = await seedPerson();

    const textConversation = await dispatch.resolveCanonicalConversation(
      person.userId,
      person.orgId,
    );
    const webVoice = await voiceService.openVoiceSession({
      userId: person.userId,
      channel: 'web',
      provider: 'mock',
      organizationId: person.orgId,
    });
    const call = await twilio.decideInboundCall({ From: person.e164, CallSid: 'CA_parity_1' });
    expect(call.disposition).toBe('connected');
    const phoneSession = one(
      await db
        .select()
        .from(schema.voiceSession)
        .where(eq(schema.voiceSession.id, call.voiceSessionId ?? '')),
    );

    expect(webVoice.conversationId).toBe(textConversation.id);
    expect(phoneSession.conversationId).toBe(textConversation.id);

    // And there is exactly one open conversation, not three.
    const open = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.ownerUserId, person.userId),
          eq(schema.agentSession.kind, 'chat'),
        ),
      );
    expect(open).toHaveLength(1);

    await voiceService.closeVoiceSession(webVoice.voiceSessionId, 'user_ended');
    await voiceService.closeVoiceSession(phoneSession.id, 'caller_hung_up');
  });

  it('interleaves a typed turn and a spoken turn in one timeline, each marked with its channel', async () => {
    const person = await seedPerson();
    const conversation = await dispatch.resolveCanonicalConversation(person.userId, person.orgId);

    // A typed message, exactly as the web composer writes one.
    await db.insert(schema.sessionActivity).values({
      sessionId: conversation.id,
      organizationId: null,
      type: 'response',
      body: { text: 'My passport number is in the safe.', author: 'user' },
    });

    const voice = await voiceService.openVoiceSession({
      userId: person.userId,
      channel: 'web',
      provider: 'mock',
      organizationId: person.orgId,
    });
    await voice.engine.receive([
      { type: 'user.transcript', text: 'What did I tell you about the passport?', final: true },
    ]);

    const lines = await timeline(conversation.id);
    const texts = lines.map((row) => (typeof row.body.text === 'string' ? row.body.text : ''));
    expect(texts).toContain('My passport number is in the safe.');
    expect(texts).toContain('What did I tell you about the passport?');

    // The typed line carries no channel marker; the spoken one does.
    const spoken = lines.find((row) => row.body.text === 'What did I tell you about the passport?');
    expect(spoken?.body['voice']).toMatchObject({ channel: 'web' });
    const typed = lines.find((row) => row.body.text === 'My passport number is in the safe.');
    expect(typed?.body['voice']).toBeUndefined();

    await voiceService.closeVoiceSession(voice.voiceSessionId, 'user_ended');
  });

  it('carries what was typed on the web into the instructions a phone call opens with', async () => {
    const person = await seedPerson();
    const conversation = await dispatch.resolveCanonicalConversation(person.userId, person.orgId);
    await db.insert(schema.sessionActivity).values({
      sessionId: conversation.id,
      organizationId: null,
      type: 'response',
      body: { text: 'The venue deposit is due on the fourteenth.', author: 'user' },
    });

    const recent = await voiceService.recentConversation(conversation.id);
    expect(recent).toContain('The venue deposit is due on the fourteenth.');

    // The same recall reaches the telephone, because the session opens on the same conversation.
    const call = await twilio.decideInboundCall({ From: person.e164, CallSid: 'CA_recall_1' });
    const phoneSession = one(
      await db
        .select()
        .from(schema.voiceSession)
        .where(eq(schema.voiceSession.id, call.voiceSessionId ?? '')),
    );
    expect(await voiceService.recentConversation(phoneSession.conversationId)).toContain(
      'The venue deposit is due on the fourteenth.',
    );
    await voiceService.closeVoiceSession(phoneSession.id, 'caller_hung_up');
  });

  it('puts a spoken turn into the durable transcript the text loop resumes from', async () => {
    const person = await seedPerson();
    const voice = await voiceService.openVoiceSession({
      userId: person.userId,
      channel: 'web',
      provider: 'mock',
      organizationId: person.orgId,
    });
    await voice.engine.receive([
      { type: 'user.transcript', text: 'Remember that the caterer is Nadia.', final: true },
    ]);

    const [row] = await db
      .select({ messages: schema.agentSessionTranscript.messages })
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, voice.conversationId));
    expect(JSON.stringify(row?.messages ?? [])).toContain('Remember that the caterer is Nadia.');

    await voiceService.closeVoiceSession(voice.voiceSessionId, 'user_ended');
  });

  it('drives both channels with the same engine class', async () => {
    const person = await seedPerson();
    const web = await voiceService.openVoiceSession({
      userId: person.userId,
      channel: 'web',
      provider: 'mock',
      organizationId: person.orgId,
    });
    const call = await twilio.decideInboundCall({ From: person.e164, CallSid: 'CA_shared_1' });
    const phone = voiceService.liveVoiceSessionByCallSid('CA_shared_1');

    expect(web.engine).toBeInstanceOf(engineModule.VoiceSessionEngine);
    expect(phone?.engine).toBeInstanceOf(engineModule.VoiceSessionEngine);
    expect(call.disposition).toBe('connected');

    await voiceService.closeVoiceSession(web.voiceSessionId, 'user_ended');
    if (phone) await voiceService.closeVoiceSession(phone.ctx.voiceSessionId, 'caller_hung_up');
  });

  it('keeps the telephony adapter free of a second conversation loop', () => {
    const root = join(import.meta.dirname, '..', '..', 'src', 'routes');
    const bridge = readFileSync(join(root, 'twilio-relay-bridge.ts'), 'utf8');
    const socket = readFileSync(join(root, 'twilio-relay-socket.ts'), 'utf8');
    const webhook = readFileSync(join(root, 'twilio-voice.ts'), 'utf8');

    for (const [name, source] of [
      ['twilio-relay-bridge.ts', bridge],
      ['twilio-relay-socket.ts', socket],
      ['twilio-voice.ts', webhook],
    ] as const) {
      // No telephony module constructs its own engine, writes its own transcript, or runs its own
      // tools. Every one of those is the shared engine's job.
      expect(source, name).not.toContain('new VoiceSessionEngine');
      expect(source, name).not.toContain('appendUserTurn');
      expect(source, name).not.toContain('appendAssistantTurn');
      expect(source, name).not.toContain('sessionActivity');
      expect(source, name).not.toContain('.run(');
    }
    // And the bridge really is only a translation: it reaches the engine solely through the
    // channel-agnostic vocabulary.
    expect(bridge).toContain('VoiceInboundEvent');
    expect(bridge).toContain('VoiceOutboundCommand');
  });
});
