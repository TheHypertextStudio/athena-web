/**
 * `@docket/api` — the live ConversationRelay socket, joining Twilio's wire to the shared engine.
 *
 * @remarks
 * The whole file is plumbing between two things that already exist: {@link toEngineEvent} /
 * {@link toRelayMessage} (the phone channel's translation table) and the one
 * {@link VoiceSessionEngine} the browser also drives. The only decisions made here are about the
 * socket's own lifecycle.
 *
 * **Why the socket does not resolve the caller.** The inbound webhook already did — it checked the
 * signature, matched the verified number, checked the plan, and opened the session — and it passed
 * the session id through TwiML as a `<Parameter>`. A socket that re-derived identity from the
 * `setup` message's `from` field would be a second, weaker authentication path for the same call,
 * reachable by anyone who can open a WebSocket. So it looks the session up by id and closes if it
 * cannot find one.
 *
 * **Why Athena's tokens are mirrored back into the engine.** Twilio synthesizes the speech and
 * never reports what it said. Every token we send is therefore also fed in as an
 * `assistant.transcript.delta`, which is what puts Athena's half of a phone call into the
 * conversation at all.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { VoiceInboundEvent } from '@docket/athena/voice';

import {
  endReasonForClose,
  readSetup,
  toEngineEvent,
  toRelayMessage,
  type RelayInboundMessage,
} from './twilio-relay-bridge';
import {
  closeVoiceSession,
  liveVoiceSession,
  type LiveVoiceSession,
} from './voice-session-service';
import { acceptUpgrade, type SocketHandlers } from './voice-websocket';

/** A socket that can send text and close, so tests can drive this without a real one. */
export interface RelaySocket {
  send(text: string): void;
  close(code?: number): void;
}

/**
 * Build the handlers for one ConversationRelay socket.
 *
 * @remarks
 * Deliberately takes the socket rather than creating it, and takes the session lookup as a
 * parameter, so the whole message loop is exercisable with a fake socket and a fake session — the
 * phone channel's behaviour is testable without a telephone.
 *
 * @param socket - The live socket.
 * @param lookup - How to find the session the webhook opened.
 * @returns the message/close handlers to install.
 */
export function relaySocketHandlers(
  socket: RelaySocket,
  lookup: (voiceSessionId: string) => LiveVoiceSession | null = liveVoiceSession,
): SocketHandlers {
  let voiceSessionId: string | null = null;

  return {
    async onMessage(raw: string): Promise<void> {
      let message: RelayInboundMessage;
      try {
        message = JSON.parse(raw) as RelayInboundMessage;
      } catch {
        // Malformed JSON on a call is not worth dropping the call over; the next message is
        // usually fine, and Twilio's own `error` message will arrive if it is not.
        return;
      }

      const setup = readSetup(message);
      if (setup) {
        voiceSessionId = setup.voiceSessionId ?? null;
        const session = voiceSessionId ? lookup(voiceSessionId) : null;
        if (!session) {
          // No session means the webhook never authorized this call. There is nothing to say.
          socket.close(1008);
        }
        return;
      }
      if (!voiceSessionId) return;
      const session = lookup(voiceSessionId);
      if (!session) {
        socket.close(1008);
        return;
      }

      const event = toEngineEvent(message);
      if (!event) return;
      await drive(session, socket, [event]);
    },

    async onClose(code: number): Promise<void> {
      const session = voiceSessionId ? lookup(voiceSessionId) : null;
      if (!session) return;
      await closeVoiceSession(session.ctx.voiceSessionId, endReasonForClose(code));
    },
  };
}

/**
 * Push events through the engine and write its commands back onto the wire.
 *
 * @remarks
 * The mirror is here rather than in the engine because it is a property of *this* channel: on the
 * browser channel the speech model reports its own transcript, so mirroring there would duplicate
 * every line.
 */
async function drive(
  session: LiveVoiceSession,
  socket: RelaySocket,
  events: readonly VoiceInboundEvent[],
): Promise<void> {
  const step = await session.engine.receive(events);
  const mirrored: VoiceInboundEvent[] = [];
  for (const command of step.commands) {
    const outbound = toRelayMessage(command);
    if (outbound) socket.send(JSON.stringify(outbound));
    if (command.type === 'speak') {
      mirrored.push({ type: 'assistant.transcript.delta', text: command.text });
      if (command.last) mirrored.push({ type: 'assistant.audio.end' });
    }
    if (command.type === 'end') socket.close(1000);
  }
  if (mirrored.length > 0) await session.engine.receive(mirrored);
}

/**
 * Accept one ConversationRelay upgrade.
 *
 * @remarks
 * The single call site the HTTP server needs; everything else in this module is testable without
 * a socket.
 *
 * @param request - The upgrade request.
 * @param socket - The raw socket.
 */
export function handleRelayUpgrade(request: IncomingMessage, socket: Duplex): void {
  acceptUpgrade(request, socket, (connection) => relaySocketHandlers(connection));
}
