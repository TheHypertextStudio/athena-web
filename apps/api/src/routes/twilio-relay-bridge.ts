/**
 * `@docket/api` — the phone channel's audio-transport adapter, and nothing more.
 *
 * @remarks
 * This is the entire telephony-specific half of the voice feature. It translates Twilio
 * ConversationRelay's wire messages into {@link VoiceInboundEvent} and {@link VoiceOutboundCommand}
 * back into Twilio's, and it contains **no** turn-taking, no persistence, no tool dispatch and no
 * conversation state — all of which live in the one shared {@link VoiceSessionEngine}. If you are
 * looking for "how does the phone decide what to do", it is not in this file, and that is the
 * point of the file.
 *
 * ## The wire protocol, as documented by Twilio
 *
 * From Twilio: `setup` (call metadata + our `<Parameter>` values), `prompt` (transcribed caller
 * speech, `last: true` on a final utterance), `interrupt` (`utteranceUntilInterrupt`,
 * `durationUntilInterruptMs`), `dtmf` (`digit`), `error` (`description`), plus speaker/token
 * lifecycle `info` messages.
 *
 * To Twilio: `text` (`token`, `last`, `interruptible`, `preemptible`), `play`, `sendDigits`,
 * `language`, and `end` (`handoffData`).
 *
 * ## Two translation decisions worth naming
 *
 * **`interrupt` carries the truth about what was heard.** `utteranceUntilInterrupt` is the portion
 * of Athena's utterance that actually reached the caller's ear before playback stopped — so it is
 * mapped straight onto `user.interrupted.spokenText`, and the conversation records what happened
 * rather than what was intended.
 *
 * **Athena's own words are mirrored back into the engine as they are spoken.** Every `speak`
 * command is also fed to the engine as an `assistant.transcript.delta`, because Twilio does the
 * synthesis and never tells us what it said. Without this mirror the phone transcript would be
 * missing Athena's half of the conversation entirely.
 */
import type { VoiceEndReason, VoiceInboundEvent, VoiceOutboundCommand } from '@docket/athena/voice';

/** A message Twilio sends over the ConversationRelay socket. */
export interface RelayInboundMessage {
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

/** A message the application sends back over the ConversationRelay socket. */
export type RelayOutboundMessage =
  | {
      readonly type: 'text';
      readonly token: string;
      readonly last: boolean;
      readonly interruptible: boolean;
      readonly preemptible: boolean;
    }
  | { readonly type: 'end'; readonly handoffData: string };

/** What the socket learns from Twilio's `setup` message. */
export interface RelaySetup {
  readonly callSid: string;
  readonly from: string;
  readonly to: string;
  /** The `<Parameter>` values the TwiML attached — carries our `voiceSessionId`. */
  readonly voiceSessionId: string | null;
}

/** Read Twilio's `setup` message. */
export function readSetup(message: RelayInboundMessage): RelaySetup | null {
  if (message.type !== 'setup') return null;
  const custom = message['customParameters'];
  const params =
    typeof custom === 'object' && custom !== null ? (custom as Record<string, unknown>) : {};
  const sessionId = params['voiceSessionId'];
  return {
    callSid: str(message['callSid']),
    from: str(message['from']),
    to: str(message['to']),
    voiceSessionId: typeof sessionId === 'string' && sessionId ? sessionId : null,
  };
}

/**
 * Translate one Twilio message into the engine's vocabulary.
 *
 * @remarks
 * Returns `null` for messages the engine has no opinion about — `setup` (handled separately),
 * token-playback `info`, and anything unrecognized. Unrecognized is deliberately silent rather
 * than an error: Twilio adds message types over time, and a phone call is a bad place to discover
 * that a new informational message crashed the socket.
 *
 * A Twilio `error` message becomes `session.end` with reason `error` rather than being surfaced —
 * `description` is provider text and never reaches a person or a conversation row.
 *
 * @param message - The parsed JSON message from Twilio.
 * @returns the engine event, or `null` when there is nothing to report.
 */
export function toEngineEvent(message: RelayInboundMessage): VoiceInboundEvent | null {
  switch (message.type) {
    case 'prompt':
      return {
        type: 'user.transcript',
        text: str(message['voicePrompt']),
        final: message['last'] === true,
      };
    case 'interrupt':
      return {
        type: 'user.interrupted',
        spokenText: str(message['utteranceUntilInterrupt']),
        elapsedMs: Math.max(0, Math.trunc(num(message['durationUntilInterruptMs']))),
      };
    case 'dtmf':
      return { type: 'dtmf', digit: str(message['digit']) };
    case 'error':
      return { type: 'session.end', reason: 'error' };
    default:
      return null;
  }
}

/**
 * Translate one engine command into Twilio's vocabulary.
 *
 * @remarks
 * `stop.audio` maps to nothing on the wire: Twilio's media server already stopped playback the
 * moment it detected the barge-in — that is what `interruptible="any"` buys — so re-sending a stop
 * would be a no-op at best and a race at worst. `tool.result` maps to nothing either, because on
 * this channel the tool result reaches the model through the engine's own reply rather than
 * through Twilio.
 *
 * `preemptible: false` on every spoken token is deliberate: a token Athena has committed to should
 * not be discarded by a later one arriving, or the caller hears half-sentences.
 *
 * @param command - The engine's command.
 * @returns the Twilio message, or `null` when the command has no wire representation.
 */
export function toRelayMessage(command: VoiceOutboundCommand): RelayOutboundMessage | null {
  switch (command.type) {
    case 'speak':
      return {
        type: 'text',
        token: command.text,
        last: command.last,
        interruptible: command.interruptible,
        preemptible: false,
      };
    case 'end':
      return { type: 'end', handoffData: JSON.stringify({ reasonCode: command.reason }) };
    case 'stop.audio':
    case 'tool.result':
      return null;
  }
}

/**
 * Why a socket closing should end the session.
 *
 * @remarks
 * Twilio closes the socket when the caller hangs up and also when the call fails. `1000` is the
 * normal close and means the person hung up; anything else is treated as the transport dying,
 * which is a materially different fact for an operator reading session rows.
 *
 * @param code - The WebSocket close code.
 */
export function endReasonForClose(code: number): VoiceEndReason {
  return code === 1000 ? 'caller_hung_up' : 'transport_closed';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
