/**
 * `@docket/athena` — the channel-agnostic vocabulary of a live Athena voice session.
 *
 * @remarks
 * There is exactly one voice session model, and both channels speak it: the browser (WebRTC to a
 * realtime speech model) and the telephone (Twilio ConversationRelay). Everything a channel does
 * that the other does not is confined to its transport adapter; the words in this module are what
 * cross the boundary between an adapter and the session engine.
 *
 * The shape of {@link VoiceInboundEvent} is the load-bearing decision. It is deliberately NOT
 * "here is the assistant's finished reply, please speak it". A turn arrives as a stream of small
 * facts — the user said this much, speech started, a tool was called, the user cut in at 460ms —
 * because a voice mode that can only act on a completed reply is a text chat with a speaker
 * bolted to the end of it. Every event here is emitted while the turn is still happening.
 *
 * @see {@link ../../../docs/engineering/specs/voice-and-phone.md}
 */
import { z } from 'zod';

/** Which transport a voice session is running over. */
export const VoiceChannel = z.enum(['web', 'phone']);
/** Voice channel value. */
export type VoiceChannel = z.infer<typeof VoiceChannel>;

/**
 * The four states a person can perceive, plus the terminal one.
 *
 * @remarks
 * `thinking` is a real state rather than a gap between `listening` and `speaking`: it is the
 * window in which Athena may already be doing work (a tool call can start here and finish while
 * she is `speaking`), and the UI must be able to say so instead of showing dead air.
 */
export const VoiceSessionState = z.enum(['idle', 'listening', 'thinking', 'speaking', 'ended']);
/** Voice session state value. */
export type VoiceSessionState = z.infer<typeof VoiceSessionState>;

/** Why a voice session stopped. */
export const VoiceEndReason = z.enum([
  'user_ended',
  'caller_hung_up',
  'transport_closed',
  'phone_access_revoked',
  'plan_required',
  'error',
]);
/** Voice end reason value. */
export type VoiceEndReason = z.infer<typeof VoiceEndReason>;

/**
 * How a browser reaches its realtime speech link.
 *
 * @remarks
 * `webrtc` is the production path: the browser holds the peer connection to the speech model
 * directly, so Docket is never in the audio path and adds no latency to it. `mock` is the
 * fixture-backed local path — a deterministic script, no network, no account.
 */
export const VoiceProviderTransport = z.enum(['webrtc', 'mock']);
/** Voice provider transport value. */
export type VoiceProviderTransport = z.infer<typeof VoiceProviderTransport>;

/**
 * The short-lived credential a browser uses to open its own audio link.
 *
 * @remarks
 * The value is an *ephemeral* secret minted per session and expiring in minutes — Docket's own
 * provider key never reaches a browser. `expiresAt` is returned so the client can refuse to start
 * rather than opening a link that will be rejected mid-greeting.
 */
export const VoiceProviderCredential = z
  .object({
    transport: VoiceProviderTransport,
    /** Provider id, for display and for support diagnostics. */
    provider: z.string(),
    /** Realtime model the session is bound to. */
    model: z.string(),
    /** The endpoint the browser posts its SDP offer to; empty for the mock transport. */
    url: z.string(),
    /** The ephemeral client secret. Never Docket's provider key. */
    clientSecret: z.string(),
    expiresAt: z.string(),
  })
  .meta({
    id: 'VoiceProviderCredential',
    description: 'A short-lived credential for a browser-held realtime audio link.',
  });
/** Voice provider credential value. */
export type VoiceProviderCredential = z.infer<typeof VoiceProviderCredential>;

/** One persisted line of a voice session, as it appears in the conversation timeline. */
export const VoiceTurnOut = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'athena']),
    text: z.string(),
    channel: VoiceChannel,
    /** True when this assistant line was cut short by the person speaking over it. */
    interrupted: z.boolean(),
    createdAt: z.string(),
    /**
     * Who actually wrote a `user` line.
     *
     * @remarks
     * `role` separates Athena from everyone else and stops there, so without this an email
     * delivered to the person's Athena inbox renders exactly like something they said. Absent
     * means `principal` — every line written before this field existed came from a Docket surface
     * the person had authenticated to.
     */
    provenance: z.enum(['principal', 'email', 'linear', 'external_agent', 'mcp_app']).optional(),
    /** Display identity of a non-principal author, e.g. the sending address. */
    origin: z.string().optional(),
  })
  .meta({ id: 'VoiceTurnOut', description: 'One spoken line persisted into the conversation.' });
/** Voice turn value. */
export type VoiceTurnOut = z.infer<typeof VoiceTurnOut>;

/** An action Athena took during the session, as the live surface renders it. */
export const VoiceActionOut = z
  .object({
    id: z.string(),
    /** Tool name, e.g. `create_task`. */
    tool: z.string(),
    /** Application-owned sentence describing what was done. */
    summary: z.string(),
    status: z.enum(['running', 'done', 'failed']),
    /** When the action began — strictly before the audio segment it overlapped finished. */
    startedAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .meta({ id: 'VoiceActionOut', description: 'An action taken during a voice turn.' });
/** Voice action value. */
export type VoiceActionOut = z.infer<typeof VoiceActionOut>;

/** One reversible task change made during a phone call. */
export const PhoneCallChangeOut = z.object({
  changeSetId: z.string(),
  summary: z.string(),
  tool: z.enum(['create_task', 'complete_task']),
  createdAt: z.string(),
  undoneAt: z.string().nullable(),
  undoAvailable: z.boolean(),
});
/** Phone-call change value. */
export type PhoneCallChangeOut = z.infer<typeof PhoneCallChangeOut>;

/** Review data shown over the canonical Athena conversation after a phone call. */
export const PhoneCallSummaryOut = z.object({
  voiceSessionId: z.string(),
  conversationId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  changes: z.array(PhoneCallChangeOut),
});
/** Phone-call summary value. */
export type PhoneCallSummaryOut = z.infer<typeof PhoneCallSummaryOut>;

/** Result of undoing one call change. */
export const PhoneCallUndoOut = z.object({
  changeSetId: z.string(),
  undone: z.literal(true),
});
/** Phone-call undo value. */
export type PhoneCallUndoOut = z.infer<typeof PhoneCallUndoOut>;

/**
 * Everything a client needs to start and render a voice session.
 *
 * @remarks
 * `conversationId` is the same id `GET /v1/me/athena/chat` returns. Entering voice never opens a
 * conversation of its own — that is the whole point of the mode, and it is why this shape carries
 * the canonical id rather than a voice-only one.
 */
export const VoiceSessionOut = z
  .object({
    id: z.string(),
    /** The one canonical Athena conversation this session writes into. */
    conversationId: z.string(),
    channel: VoiceChannel,
    state: VoiceSessionState,
    /** Present only on the start response for a browser session. */
    credential: VoiceProviderCredential.nullable(),
    /** The line Athena opens with, so the client can render it before audio arrives. */
    greeting: z.string(),
    /** Tool definitions the realtime model is given for this session. */
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.record(z.string(), z.unknown()),
      }),
    ),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
  })
  .meta({ id: 'VoiceSessionOut', description: 'A live Athena voice session.' });
/** Voice session value. */
export type VoiceSessionOut = z.infer<typeof VoiceSessionOut>;

/**
 * What a transport reports into the engine.
 *
 * @remarks
 * Both adapters produce exactly this union; neither produces anything of its own. The engine's
 * `receive` is total over it, so adding a channel cannot add a branch the engine silently ignores.
 */
export const VoiceInboundEvent = z.discriminatedUnion('type', [
  /** Final or partial transcript of what the person said. */
  z.object({ type: z.literal('user.transcript'), text: z.string(), final: z.boolean() }),
  /** Athena's own words, streamed as the model produces them. */
  z.object({ type: z.literal('assistant.transcript.delta'), text: z.string() }),
  /** Audio playback for the current assistant turn has begun. */
  z.object({ type: z.literal('assistant.audio.start') }),
  /** Audio playback for the current assistant turn finished uninterrupted. */
  z.object({ type: z.literal('assistant.audio.end') }),
  /** The person spoke over Athena. `spokenText` is what actually reached their ear. */
  z.object({
    type: z.literal('user.interrupted'),
    spokenText: z.string(),
    elapsedMs: z.number().int().nonnegative(),
  }),
  /** The model asked for a tool. Dispatched on arrival — never queued to the end of the turn. */
  z.object({
    type: z.literal('tool.call'),
    callId: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
  /** A telephone keypad press. */
  z.object({ type: z.literal('dtmf'), digit: z.string() }),
  /** The transport is going away. */
  z.object({ type: z.literal('session.end'), reason: VoiceEndReason }),
]);
/** Voice inbound event value. */
export type VoiceInboundEvent = z.infer<typeof VoiceInboundEvent>;

/**
 * What the engine tells a transport to do.
 *
 * @remarks
 * `speak` carries a **fragment**, not a finished reply, and `interruptible` rides on each fragment,
 * because the telephone channel needs to know per-fragment whether the caller may cut in. The
 * field is `text` rather than `token` deliberately: `token` is what Twilio's wire protocol calls
 * it, but on this side of the boundary the word collides with credential scanning, and a spoken
 * word is not a secret. `stop.audio` is the
 * barge-in command: it is emitted the instant an interruption is reported, before anything is
 * persisted, so the person hears silence rather than waiting for a database write.
 */
export const VoiceOutboundCommand = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('speak'),
    text: z.string(),
    last: z.boolean(),
    interruptible: z.boolean(),
  }),
  z.object({ type: z.literal('stop.audio') }),
  z.object({
    type: z.literal('tool.result'),
    callId: z.string(),
    ok: z.boolean(),
    /** Application-owned text handed back to the model. Never an exception message. */
    output: z.string(),
  }),
  z.object({ type: z.literal('end'), reason: VoiceEndReason }),
]);
/** Voice outbound command value. */
export type VoiceOutboundCommand = z.infer<typeof VoiceOutboundCommand>;

/**
 * The engine's ordered trace of what happened when.
 *
 * @remarks
 * This exists so "actions are not batched to the end of the turn" is a checkable property rather
 * than a claim: a tool's `started` entry carries a monotonic clock reading that can be compared
 * against the `audio.segment.end` of the segment it overlapped. It is also what the live surface
 * renders, so the trace a test asserts on is the trace a person sees.
 */
export const VoiceTraceEntry = z
  .object({
    at: z.string(),
    /** Monotonic sequence within the session — total order even when two entries share a ms. */
    seq: z.number().int(),
    kind: z.enum([
      'state',
      'audio.segment.start',
      'audio.segment.end',
      'tool.start',
      'tool.end',
      'interrupt',
      'turn.persisted',
    ]),
    detail: z.string(),
  })
  .meta({ id: 'VoiceTraceEntry', description: 'One ordered fact about a voice session.' });
/** Voice trace entry value. */
export type VoiceTraceEntry = z.infer<typeof VoiceTraceEntry>;

/** The live server-to-client push shape for a browser voice session. */
export const VoiceServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: VoiceSessionState }),
  z.object({ type: z.literal('turn'), turn: VoiceTurnOut }),
  z.object({ type: z.literal('action'), action: VoiceActionOut }),
  z.object({ type: z.literal('command'), command: VoiceOutboundCommand }),
]);
/** Voice server event value. */
export type VoiceServerEvent = z.infer<typeof VoiceServerEvent>;

/** The response to relaying one batch of client events into the engine. */
export const VoiceEventsAck = z
  .object({
    state: VoiceSessionState,
    commands: z.array(VoiceOutboundCommand),
    turns: z.array(VoiceTurnOut),
    actions: z.array(VoiceActionOut),
    trace: z.array(VoiceTraceEntry),
  })
  .meta({
    id: 'VoiceEventsAck',
    description: 'Engine output for one relayed batch of transport events.',
  });
/** Voice events ack value. */
export type VoiceEventsAck = z.infer<typeof VoiceEventsAck>;

/** Relay a batch of transport events into the engine. */
export const VoiceEventsBody = z
  .object({ events: z.array(VoiceInboundEvent).min(1).max(64) })
  .meta({ id: 'VoiceEventsBody', description: 'Transport events to feed the session engine.' });
/** Voice events body value. */
export type VoiceEventsBody = z.infer<typeof VoiceEventsBody>;

/** Start a browser voice session on the caller's one conversation. */
export const VoiceSessionStartBody = z
  .object({
    /** Workspace focus recorded on the conversation, exactly as the text composer sends it. */
    workspaceId: z.string().nullish(),
  })
  .meta({ id: 'VoiceSessionStartBody', description: 'Start a browser voice session.' });
/** Voice session start body value. */
export type VoiceSessionStartBody = z.infer<typeof VoiceSessionStartBody>;
