/**
 * `@docket/types` — the deliberate, scoped opt-in that lets an external page read what its owner
 * is tracking right now.
 *
 * @remarks
 * The Time Ledger is personal data and every `/v1/time` route is session-scoped. This module
 * defines the ONE exception, and defines it narrowly on purpose: a share token is minted by
 * hand, names only "my current task", can be revoked, and is the sole thing that makes any of
 * it readable from another origin. There is no "public time" flag anywhere — absent a token the
 * external answer does not exist rather than being merely unauthorized.
 *
 * The reader's payload ({@link PublicTimerStatusOut}) is deliberately not a Time Record: it
 * carries no record id, no interval list, no historical total, and no workspace unless the owner
 * opted into that too. A widget can render "working on X for 42 minutes" and nothing further.
 */
import { z } from 'zod';

import { TimeShareTokenId } from './primitives';

/** Whether a shared timer is running, paused, or not tracking at all. */
export const PublicTimerState = z.enum(['running', 'paused', 'idle']);
/** Public-timer-state value. */
export type PublicTimerState = z.infer<typeof PublicTimerState>;

/** A minted share token as its owner sees it. The raw secret is never in this shape. */
export const TimeShareTokenOut = z
  .object({
    id: TimeShareTokenId,
    label: z.string(),
    includeTitle: z.boolean(),
    includeWorkspace: z.boolean(),
    createdAt: z.string(),
    /** The hard expiry after which the credential cannot be used, even if it was not revoked. */
    expiresAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .meta({
    id: 'TimeShareTokenOut',
    description: 'A revocable, current-task-only share token as its owner sees it.',
  });
/** Time-share-token-out value. */
export type TimeShareTokenOut = z.infer<typeof TimeShareTokenOut>;

/**
 * A freshly minted token, including the raw secret.
 *
 * @remarks
 * `token` and `embedSnippet` appear exactly once, in the create response. Only a SHA-256 hash is
 * persisted, so neither can be recovered later — losing the value means minting a new token,
 * which is the correct outcome for a credential that grants any external read at all.
 */
export const TimeShareTokenCreated = TimeShareTokenOut.extend({
  /** The raw bearer value. Shown once; unrecoverable afterwards. */
  token: z.string(),
  /** The absolute status URL a widget fetches. */
  statusUrl: z.string(),
  /** A copy-pasteable HTML+JS snippet that renders the current task on any page. */
  embedSnippet: z.string(),
}).meta({
  id: 'TimeShareTokenCreated',
  description: 'A newly minted share token, with its one-time secret and an embed snippet.',
});
/** Time-share-token-created value. */
export type TimeShareTokenCreated = z.infer<typeof TimeShareTokenCreated>;

/** The caller's share tokens. */
export const TimeShareTokenListOut = z
  .object({ items: z.array(TimeShareTokenOut) })
  .meta({ id: 'TimeShareTokenListOut', description: 'The caller’s current-task share tokens.' });
/** Time-share-token-list-out value. */
export type TimeShareTokenListOut = z.infer<typeof TimeShareTokenListOut>;

/** Body for minting one share token. */
export const TimeShareTokenCreate = z
  .object({
    label: z.string().trim().min(1).max(80),
    /** Withhold the task's name and expose only whether tracking is running. */
    includeTitle: z.boolean().optional().default(true),
    /** Additionally expose the workspace the tracked task belongs to. */
    includeWorkspace: z.boolean().optional().default(false),
    /** Finite credential lifetime: five minutes through one year; defaults to 30 days. */
    expiresInSeconds: z
      .number()
      .int()
      .min(5 * 60)
      .max(365 * 24 * 60 * 60)
      .optional()
      .default(30 * 24 * 60 * 60),
  })
  .meta({ id: 'TimeShareTokenCreate', description: 'Mint a current-task share token.' });
/** Time-share-token-create value. */
export type TimeShareTokenCreate = z.infer<typeof TimeShareTokenCreate>;

/**
 * What an external page is allowed to learn.
 *
 * @remarks
 * `state: 'idle'` is an explicit, successful answer — a widget renders "not working right now"
 * rather than an error — so a quiet evening is never indistinguishable from a broken token.
 * `elapsedMs` counts only the tracked segments of the *current* session, and `serverNow` lets a
 * widget tick locally without asking again every second.
 */
export const PublicTimerStatusOut = z
  .object({
    state: PublicTimerState,
    /** The tracked task's title, or null when idle or when the owner withheld it. */
    taskTitle: z.string().nullable(),
    /** The tracked task's workspace name, or null unless the owner opted in. */
    workspaceName: z.string().nullable(),
    /** When the current session began, or null when idle. */
    startedAt: z.string().nullable(),
    /** Latest start, resume, or pause transition in the current session; null when idle. */
    lastTransitionAt: z.string().nullable(),
    /** Tracked milliseconds in the current session, excluding paused gaps. */
    elapsedMs: z.number().int().nonnegative(),
    /** The server clock at read time, so a widget can tick without re-polling. */
    serverNow: z.string(),
  })
  .meta({
    id: 'PublicTimerStatusOut',
    description: 'The current-task answer an external widget is permitted to read.',
  });
/** Public-timer-status-out value. */
export type PublicTimerStatusOut = z.infer<typeof PublicTimerStatusOut>;
