/**
 * `@docket/api` — the ConversationRelay socket's own lifecycle: setup admission, the post-setup
 * message loop (`drive`), and close-time cleanup.
 *
 * @remarks
 * `voice-telephony-protocol.test.ts` covers the pure wire-translation table
 * (`twilio-relay-bridge.ts`) this socket sits on top of, plus the socket's pre-setup guard. This
 * file is scoped to `relaySocketHandlers` itself: a scripted fake engine drives every outbound
 * command shape through `drive` deterministically, and a real, durably-opened session covers the
 * `onClose` cleanup end to end.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type { relaySocketHandlers as RelaySocketHandlers } from '../../src/routes/twilio-relay-socket';
import type { VoiceEngineStep, VoiceSessionEngine } from '../../src/routes/voice-engine';
import type {
  LiveVoiceSession,
  openVoiceSession as OpenVoiceSession,
} from '../../src/routes/voice-session-service';
import { addMember, getDb, seedOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let relaySocketHandlers!: typeof RelaySocketHandlers;
let openVoiceSession!: typeof OpenVoiceSession;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ relaySocketHandlers } = await import('../../src/routes/twilio-relay-socket'));
  ({ openVoiceSession } = await import('../../src/routes/voice-session-service'));
});

function fakeSocket() {
  return { send: vi.fn(), close: vi.fn() };
}

/** A minimal live session whose engine's `receive` is fully scripted by the test. */
function fakeLiveSession(receive: ReturnType<typeof vi.fn>): LiveVoiceSession {
  return {
    engine: { receive } as unknown as VoiceSessionEngine,
    ctx: {
      voiceSessionId: 'vs_fake',
      conversationId: 'conv_fake',
      userId: 'user_fake',
      organizationId: null,
      channel: 'phone',
      initiatorActorId: null,
    },
    provider: 'twilio-relay',
  };
}

describe('relaySocketHandlers — setup admission', () => {
  it('closes the socket when the setup message names no session id at all', async () => {
    const socket = fakeSocket();
    const lookup = vi.fn(() => null);
    const handlers = relaySocketHandlers(socket, lookup);

    await handlers.onMessage(
      JSON.stringify({ type: 'setup', callSid: 'CA1', customParameters: {} }),
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1008);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('accepts setup and stops closing once the named session is found', async () => {
    const socket = fakeSocket();
    const session = fakeLiveSession(vi.fn());
    const lookup = vi.fn(() => session);
    const handlers = relaySocketHandlers(socket, lookup);

    await handlers.onMessage(
      JSON.stringify({
        type: 'setup',
        callSid: 'CA1',
        customParameters: { voiceSessionId: 'vs_fake' },
      }),
    );

    expect(lookup).toHaveBeenCalledWith('vs_fake');
    expect(socket.close).not.toHaveBeenCalled();
  });
});

describe('relaySocketHandlers — the post-setup message loop', () => {
  it('ignores a message the engine event mapping has no opinion about', async () => {
    const socket = fakeSocket();
    const receive = vi.fn();
    const handlers = relaySocketHandlers(socket, () => fakeLiveSession(receive));
    await handlers.onMessage(
      JSON.stringify({ type: 'setup', customParameters: { voiceSessionId: 'vs_fake' } }),
    );

    await handlers.onMessage(JSON.stringify({ type: 'info', name: 'tokensPlayed' }));

    expect(receive).not.toHaveBeenCalled();
  });

  it('drives every outbound command shape in one batch: spoken text, a silent tool result, a mirrored end-of-turn, and hangup', async () => {
    const socket = fakeSocket();
    const firstStep: VoiceEngineStep = {
      state: 'speaking',
      commands: [
        { type: 'speak', text: 'Working on it', last: false, interruptible: true },
        { type: 'tool.result', callId: 'call_1', ok: true, output: 'done' },
        { type: 'speak', text: '', last: true, interruptible: true },
        { type: 'end', reason: 'user_ended' },
      ],
      turns: [],
      actions: [],
      trace: [],
    };
    const secondStep: VoiceEngineStep = {
      state: 'ended',
      commands: [],
      turns: [],
      actions: [],
      trace: [],
    };
    const receive = vi.fn().mockResolvedValueOnce(firstStep).mockResolvedValueOnce(secondStep);
    const handlers = relaySocketHandlers(socket, () => fakeLiveSession(receive));
    await handlers.onMessage(
      JSON.stringify({ type: 'setup', customParameters: { voiceSessionId: 'vs_fake' } }),
    );

    await handlers.onMessage(
      JSON.stringify({ type: 'prompt', voicePrompt: 'Book the venue', lang: 'en-US', last: true }),
    );

    // Every command with a wire mapping went out, in order; the silent tool result did not.
    expect(socket.send).toHaveBeenCalledTimes(3);
    const sent = (socket.send.mock.calls as [string][]).map(([text]) => JSON.parse(text));
    expect(sent[0]).toMatchObject({ type: 'text', token: 'Working on it' });
    expect(sent[1]).toMatchObject({ type: 'text', token: '' });
    expect(sent[2]).toMatchObject({ type: 'end' });
    // The 'end' command also hangs up the socket transport itself.
    expect(socket.close).toHaveBeenCalledWith(1000);
    // The last:true speak fragment was mirrored back into the engine as Athena's own transcript —
    // the second (recursive) `receive` call.
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive.mock.calls[1]?.[0]).toEqual([
      { type: 'assistant.transcript.delta', text: 'Working on it' },
      { type: 'assistant.transcript.delta', text: '' },
      { type: 'assistant.audio.end' },
    ]);
  });

  it('does not re-invoke the engine when a batch produced nothing to mirror', async () => {
    const receive = vi.fn().mockResolvedValueOnce({
      state: 'thinking',
      commands: [{ type: 'tool.result', callId: 'call_1', ok: true, output: 'done' }],
      turns: [],
      actions: [],
      trace: [],
    } satisfies VoiceEngineStep);
    const socket = fakeSocket();
    const handlers = relaySocketHandlers(socket, () => fakeLiveSession(receive));
    await handlers.onMessage(
      JSON.stringify({ type: 'setup', customParameters: { voiceSessionId: 'vs_fake' } }),
    );

    await handlers.onMessage(JSON.stringify({ type: 'dtmf', digit: '1' }));

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledOnce();
  });

  it('drops a post-setup message once the session is found but before any engine event arrives', async () => {
    const socket = fakeSocket();
    const receive = vi.fn();
    const handlers = relaySocketHandlers(socket, () => fakeLiveSession(receive));
    await handlers.onMessage(
      JSON.stringify({ type: 'setup', customParameters: { voiceSessionId: 'vs_fake' } }),
    );

    await expect(handlers.onMessage('{not valid json')).resolves.toBeUndefined();

    expect(receive).not.toHaveBeenCalled();
  });
});

describe('relaySocketHandlers — onClose', () => {
  it('does nothing when the socket closes before any session was ever found', async () => {
    const socket = fakeSocket();
    const handlers = relaySocketHandlers(socket, () => null);

    await expect(handlers.onClose(1000)).resolves.toBeUndefined();
  });

  it('closes the durable voice session, with the close code mapped to its end reason', async () => {
    const label = `RelaySocket${Math.random().toString(36).slice(2, 8)}`;
    const userId = await seedUserWithHub(db, schema, label);
    const orgId = await seedOrg(db, schema, true);
    await db
      .update(schema.organization)
      .set({ lifecycleState: 'active' })
      .where(eq(schema.organization.id, orgId));
    await addMember(db, schema, orgId, userId, 'owner');
    const opened = await openVoiceSession({
      userId,
      channel: 'phone',
      provider: 'twilio-relay',
      organizationId: orgId,
      callSid: 'CA_relay_socket_close',
    });

    const socket = fakeSocket();
    // No explicit lookup — resolves the session through the same process-local registry
    // `openVoiceSession` just registered it in.
    const handlers = relaySocketHandlers(socket);
    await handlers.onMessage(
      JSON.stringify({
        type: 'setup',
        callSid: 'CA_relay_socket_close',
        customParameters: { voiceSessionId: opened.voiceSessionId },
      }),
    );

    await handlers.onClose(1006);

    const [row] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, opened.voiceSessionId));
    expect(row).toMatchObject({ status: 'ended', endedReason: 'transport_closed' });
  });
});
