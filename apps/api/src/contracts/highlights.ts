/**
 * `domain packages` — the narrated day, on the wire.
 *
 * @remarks
 * What a person reads when they ask "what did I do today", and what they curate. Two properties of
 * these shapes are deliberate and worth stating, because both are easy to lose later.
 *
 * **Source health is a state, never a message.** A day where a provider could not be reached must not
 * render identically to a day where nothing happened, so the payload reports per-source health — but
 * as a closed enum the app writes its own copy for. Provider diagnostics never cross this boundary:
 * they are operator information, and a workspace policy test forbids the web app from reading them.
 *
 * **There is no duration field.** Highlights carry a start and an end so a row can show *when*
 * something happened, and nothing else. Worked-versus-planned time is a separate, specified feature,
 * and a duration sitting here would invite it to arrive by accident and be wrong.
 */
import { z } from 'zod';

import {
  CanonicalEntityKind,
  EntityAssociation,
  SourceSystemKind,
} from '@docket/connections/event-contract';
import { StreamEventOut } from './stream';

/**
 * How one source's contribution to a day turned out.
 *
 * @remarks
 * The distinction that matters most is `ok`-with-nothing versus `failed`: the first is a quiet day,
 * the second is a broken connection, and conflating them is the failure this enum exists to prevent.
 */
export const HighlightSourceState = z
  .enum(['ok', 'never_connected', 'stale', 'failed', 'disconnected'])
  .describe(
    'How a source contributed: `ok` (read cleanly), `never_connected` (no connection exists), `stale` (connected, but not read since before this day), `failed` (the last read did not succeed), `disconnected` (intentionally severed).',
  );
/** Highlight-source-state value. */
export type HighlightSourceState = z.infer<typeof HighlightSourceState>;

/** One source's contribution to a day. */
export const HighlightSourceStatus = z
  .object({
    system: SourceSystemKind,
    state: HighlightSourceState,
    /** ISO-8601 instant this source was last read successfully; null when it never has been. */
    lastReadAt: z.string().nullable(),
    /** Events this source contributed to the day. */
    eventCount: z.number().int(),
  })
  .meta({
    id: 'HighlightSourceStatus',
    description: "One connected source's contribution to a narrated day.",
  });
/** Highlight-source-status value. */
export type HighlightSourceStatus = z.infer<typeof HighlightSourceStatus>;

/** How far one highlight's sentence has got. */
export const HighlightNarrationState = z
  .enum(['pending', 'generating', 'ready', 'failed'])
  .describe(
    'Narration progress for one highlight: `pending` (not yet written), `generating` (being written), `ready` (written), `failed` (could not be written — the record still stands).',
  );
/** Highlight-narration-state value. */
export type HighlightNarrationState = z.infer<typeof HighlightNarrationState>;

/** The narration of one highlight: what was written, and whether a person rewrote it. */
export const HighlightNarration = z
  .object({
    state: HighlightNarrationState,
    /** The sentence to show — the person's rewrite when there is one. Null when none exists yet. */
    text: z.string().nullable(),
    /** Whether a person rewrote it, so a surface can say so honestly. */
    edited: z.boolean(),
  })
  .meta({ id: 'HighlightNarration', description: "One highlight's sentence and its provenance." });
/** Highlight-narration value. */
export type HighlightNarration = z.infer<typeof HighlightNarration>;

/** One episode of a narrated day. */
export const HighlightOut = z
  .object({
    /** The highlight's own id — what a curation request addresses. Not an event id. */
    id: z.string(),
    /** The episode's stable `(subject, day)` identity. */
    episodeKey: z.string(),
    /** Chronological position within the day. */
    sort: z.number().int(),
    /** The episode's span. A range so a row can show when; never a duration worked. */
    occurredAt: z.string(),
    endedAt: z.string(),
    system: SourceSystemKind,
    entityKind: CanonicalEntityKind.nullable(),
    /** The Docket entity this resolved to, when it did. */
    docketEntityId: z.string().nullable(),
    /** Whether the subject resolved to Docket work — what gates offering to link it manually. */
    association: EntityAssociation,
    /** The subject's label. */
    subjectTitle: z.string().nullable(),
    narration: HighlightNarration,
    /** Whether this line is in the highlights. A dropped line is kept as a record, not deleted. */
    kept: z.boolean(),
    /** When a person last touched this line; null when only Docket has. */
    curatedAt: z.string().nullable(),
    /** The append-only events this narrates, so a surface can show the evidence. */
    events: z.array(StreamEventOut),
  })
  .meta({ id: 'HighlightOut', description: 'One narrated episode of a day.' });
/** Highlight-out value. */
export type HighlightOut = z.infer<typeof HighlightOut>;

/** One person's narrated day. */
export const HighlightsDayOut = z
  .object({
    /** The local calendar day (`YYYY-MM-DD`). */
    date: z.string(),
    /** The IANA zone the day's boundaries were computed in. */
    timezone: z.string(),
    /** How far the day has got. */
    status: z.enum(['pending', 'reconciling', 'ready', 'empty', 'failed']),
    /** Whether any narration is still in flight, so a surface can wait rather than guess. */
    generating: z.boolean(),
    /** Canonical events the day was built from. */
    eventCount: z.number().int(),
    /** When the day was last rebuilt from the log; null before it ever has been. */
    reconciledAt: z.string().nullable(),
    highlights: z.array(HighlightOut),
    /** Per-source health, so a broken connection never reads as a quiet day. */
    sources: z.array(HighlightSourceStatus),
  })
  .meta({ id: 'HighlightsDayOut', description: "One person's narrated day." });
/** Highlights-day-out value. */
export type HighlightsDayOut = z.infer<typeof HighlightsDayOut>;

/**
 * A change to one highlight's story.
 *
 * @remarks
 * One body covers dropping, restoring and rewriting, because they are one gesture from the person's
 * side: deciding what their day says. `narration: null` reverts to the generated sentence; an empty
 * string is refused, since a line cannot be blanked — dropping it is the way to remove it.
 */
export const HighlightPatch = z
  .object({
    kept: z.boolean().optional().describe('Whether this line is in the highlights.'),
    narration: z
      .string()
      .nullable()
      .optional()
      .describe('The rewritten sentence, or `null` to revert to the generated one.'),
  })
  .meta({ id: 'HighlightPatch', description: "A change to one highlight's story." });
/** Highlight-patch value. */
export type HighlightPatch = z.infer<typeof HighlightPatch>;

/**
 * Which task an activity event is about.
 *
 * @remarks
 * Used when Docket could not resolve the subject itself — a meeting and a mail thread have no Docket
 * mirror to match against, so they always arrive unresolved.
 */
export const StreamEventLinkBody = z
  .object({ taskId: z.string().describe('The task this activity is about.') })
  .meta({
    id: 'StreamEventLinkBody',
    description: 'Which task an unresolved activity event is about.',
  });
/** Stream-event-link-body value. */
export type StreamEventLinkBody = z.infer<typeof StreamEventLinkBody>;

/**
 * Source systems whose activity is one person's own, not the workspace's.
 *
 * @remarks
 * A mailbox and a personal calendar are private surfaces that happen to be reached through an
 * org-scoped integration. Their `event` rows therefore carry an `organizationId` for tenancy while
 * still belonging to exactly one person, and any org-wide read has to exclude them for everybody
 * else — an email subject or a meeting title is not workspace activity just because the connection
 * that produced it lives in a workspace.
 *
 * Deliberately a denylist of private sources rather than an allowlist of shareable ones: a new
 * source added without thinking about this should default to being *hidden* from colleagues, not to
 * being broadcast to them.
 */
export const PERSONAL_ACTIVITY_SOURCES = ['gmail', 'google_calendar'] as const;
/** Personal-activity source value. */
export type PersonalActivitySource = (typeof PERSONAL_ACTIVITY_SOURCES)[number];

/**
 * Human labels for the sources a day can draw on.
 *
 * @remarks
 * Application-owned, never a provider's own error or display string. Shared rather than duplicated
 * because the panel and the digest email both name sources to the same person: two lists would drift
 * and tell them "GitHub" in one place and "github" in the other about the same missing day.
 */
const SOURCE_LABEL: Partial<Record<SourceSystemKind, string>> = {
  github: 'GitHub',
  gmail: 'Gmail',
  google_calendar: 'Calendar',
  linear: 'Linear',
  docket: 'Docket',
  slack: 'Slack',
  discord: 'Discord',
  google_drive: 'Drive',
  outlook: 'Outlook',
};

/**
 * The display label for a source.
 *
 * @param system - The canonical source system.
 * @returns a human label.
 *
 * @example
 * ```typescript
 * sourceLabel('google_calendar'); // 'Calendar'
 * ```
 */
export function sourceLabel(system: SourceSystemKind): string {
  return SOURCE_LABEL[system] ?? system.replaceAll('_', ' ');
}

/**
 * Join labels into a readable English list.
 *
 * @param labels - The labels to join.
 * @returns `""`, `"Gmail"`, or `"Gmail, GitHub and Calendar"`.
 *
 * @example
 * ```typescript
 * joinLabels(['Gmail', 'GitHub']); // 'Gmail and GitHub'
 * ```
 */
export function joinLabels(labels: readonly string[]): string {
  // Written with `join` rather than index access so there is no unreachable `?? ''` to defend: an
  // index into a possibly-empty array is optional to TypeScript even where the length check has
  // already ruled it out, and a branch that cannot be taken is a branch that cannot be tested.
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.slice(-1).join('')}`;
}
