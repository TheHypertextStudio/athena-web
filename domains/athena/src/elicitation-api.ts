/**
 * `@docket/athena` — the wire DTOs for Athena's elicitation surface.
 *
 * @remarks
 * Split from {@link ./elicitation} on purpose: that module is the *contract* (the control grammar,
 * the Zod codec, the MCP mapping) and is imported by the renderer, the agent loop and the MCP
 * bridge alike. This module is only the HTTP shape, so a change to how an elicitation is
 * transported cannot ripple into how one is defined.
 *
 * Every `*Out` field maps to a serialized DB column, so nullable columns are `.nullable()` rather
 * than `.nullable().optional()` — a persisted null is a value, not an absence.
 */
import { z } from 'zod';

import {
  ElicitationResolver,
  ElicitationSpecSchema,
  ElicitationStatus,
  ElicitationTimeoutPolicy,
} from './elicitation';

/** The task an elicitation exists to implement, as rendered on the card. */
export const ElicitationTaskRef = z
  .object({
    id: z.string(),
    title: z.string(),
    /** In-app path to the task, so the card's link and the notification's link agree. */
    href: z.string(),
  })
  .meta({
    id: 'ElicitationTaskRef',
    description: 'The task an elicitation exists to implement.',
  });
/** An {@link ElicitationTaskRef} value. */
export type ElicitationTaskRef = z.infer<typeof ElicitationTaskRef>;

/** One elicitation as the client renders it. */
export const ElicitationOut = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    /** The work this question exists to unblock; never null, by database constraint. */
    task: ElicitationTaskRef,
    question: z.string(),
    /** The concrete action this answer authorizes. Required — see `ElicitationRequest`. */
    actionSummary: z.string(),
    /** The declared answer shape the renderer draws controls from. */
    spec: ElicitationSpecSchema,
    status: ElicitationStatus,
    timeoutPolicy: ElicitationTimeoutPolicy,
    timeSensitive: z.boolean(),
    /** When this stops waiting, ISO-8601. Shown on the card so the deadline is never a surprise. */
    expiresAt: z.string(),
    createdAt: z.string(),
    settledAt: z.string().nullable(),
    /** Who settled it: the person, Athena, or nobody (the work was parked). */
    resolver: ElicitationResolver.nullable(),
    /** The recorded answer, already parsed to its declared type. */
    answer: z.unknown().nullable(),
    /** Athena's stated reasoning when she answered in the person's place. */
    autoResolveReason: z.string().nullable(),
    /**
     * Whether this question is being treated as live.
     *
     * @remarks
     * True when the asked person had the Athena surface open and focused inside the presence
     * window at the moment the question was raised. It is the recorded presence state, not a
     * guess from the request that is reading it.
     */
    live: z.boolean(),
  })
  .meta({ id: 'Elicitation', description: 'One typed request for data from the user.' });
/** An {@link ElicitationOut} value. */
export type ElicitationOut = z.infer<typeof ElicitationOut>;

/** Every elicitation currently addressed to the caller. */
export const ElicitationListOut = z
  .object({ items: z.array(ElicitationOut) })
  .meta({ id: 'ElicitationList', description: 'Open elicitations addressed to the caller.' });
/** An {@link ElicitationListOut} value. */
export type ElicitationListOut = z.infer<typeof ElicitationListOut>;

/** The body submitting an answer to an elicitation. */
export const ElicitationAnswerBody = z
  .object({
    /** The answer, in the shape the elicitation's `spec` declared. */
    value: z.unknown(),
  })
  .meta({ id: 'ElicitationAnswerBody', description: 'An answer to one elicitation.' });
/** An {@link ElicitationAnswerBody} value. */
export type ElicitationAnswerBody = z.infer<typeof ElicitationAnswerBody>;

/** One rejected field of a submitted answer, as sent to the client. */
export const ElicitationFieldErrorOut = z
  .object({
    /** Dotted path to the offending value; `''` addresses the answer as a whole. */
    path: z.string(),
    /**
     * Docket's own sentence.
     *
     * @remarks
     * Named `text`, not `message`: see {@link ElicitationFieldError}. Never library, provider, or
     * exception text.
     */
    text: z.string(),
  })
  .meta({ id: 'ElicitationFieldError', description: 'One rejected field of an answer.' });
/** An {@link ElicitationFieldErrorOut} value. */
export type ElicitationFieldErrorOut = z.infer<typeof ElicitationFieldErrorOut>;

/**
 * The response to a refused answer.
 *
 * @remarks
 * Returned with HTTP 422 alongside the still-open elicitation, because the client has to keep
 * rendering the form: the person's other fields are still valid and must not be discarded.
 */
export const ElicitationRejectionOut = z
  .object({
    errors: z.array(ElicitationFieldErrorOut).min(1),
    elicitation: ElicitationOut,
  })
  .meta({
    id: 'ElicitationRejection',
    description: 'Field-level reasons an answer was refused, with the still-open elicitation.',
  });
/** An {@link ElicitationRejectionOut} value. */
export type ElicitationRejectionOut = z.infer<typeof ElicitationRejectionOut>;

/** The body recording that the caller is (or is no longer) watching Athena. */
export const AthenaPresenceBody = z
  .object({
    /** True while the Athena surface is open AND the document has focus. */
    focused: z.boolean(),
  })
  .meta({
    id: 'AthenaPresenceBody',
    description: 'A heartbeat recording whether the caller is watching Athena right now.',
  });
/** An {@link AthenaPresenceBody} value. */
export type AthenaPresenceBody = z.infer<typeof AthenaPresenceBody>;

/** The caller's recorded presence, and what it means for new questions. */
export const AthenaPresenceOut = z
  .object({
    /** Whether a question raised right now would be treated as live. */
    live: z.boolean(),
    /** When the caller was last seen focused, ISO-8601; null if never. */
    lastSeenAt: z.string().nullable(),
    /** How long a focus heartbeat counts for, in milliseconds. */
    windowMs: z.number().int(),
  })
  .meta({ id: 'AthenaPresence', description: "The caller's recorded Athena presence." });
/** An {@link AthenaPresenceOut} value. */
export type AthenaPresenceOut = z.infer<typeof AthenaPresenceOut>;

/** The outcome of one expiry sweep. */
export const ElicitationSweepOut = z
  .object({
    /** How many past-deadline questions Athena answered herself. */
    autoResolved: z.number().int(),
    /** How many were parked because no answer was derivable. */
    parked: z.number().int(),
  })
  .meta({
    id: 'ElicitationSweep',
    description: 'How one elicitation deadline sweep settled the questions it found.',
  });
/** An {@link ElicitationSweepOut} value. */
export type ElicitationSweepOut = z.infer<typeof ElicitationSweepOut>;
