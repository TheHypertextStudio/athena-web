/**
 * `activity` — pure view-model for a narrated day.
 *
 * @remarks
 * Everything here answers a question the panel has to answer honestly, and answers it from the
 * payload rather than from appearances. The important one is {@link summarizeDay}: a day with nothing
 * in it and a day whose sources could not be read look identical on screen unless something insists
 * they are different, and this is that something.
 */
import type { HighlightOut, HighlightSourceStatus, HighlightsDayOut } from '@docket/types';

// Re-exported rather than redefined: the digest email names the same sources to the same person, so
// one list is the only way "GitHub" cannot become "github" between the panel and the inbox.
export { joinLabels, sourceLabel } from '@docket/types';

/** What the panel needs to know about a day in order to describe it truthfully. */
export interface DaySummary {
  /** Entries currently kept. */
  readonly keptCount: number;
  /** Entries in total, kept or dropped. */
  readonly totalCount: number;
  /** Sources that were read cleanly. */
  readonly readSources: readonly HighlightSourceStatus[];
  /** Sources that could not be read, or have not been read for this day. */
  readonly troubledSources: readonly HighlightSourceStatus[];
  /** Whether anything is connected at all. */
  readonly anyConnected: boolean;
  /**
   * Which of the mutually-exclusive things is true of this day.
   *
   * @remarks
   * `quiet` and `incomplete` are the pair worth separating: both show an empty list, but one means
   * "nothing happened" and the other means "we could not find out". Telling somebody their day was
   * quiet when a source was unreachable is the failure this exists to prevent.
   */
  readonly shape: 'loading' | 'not_connected' | 'incomplete' | 'quiet' | 'listed';
}

/**
 * Describe a day: what it contains, which sources answered, and which shape it is.
 *
 * @param day - The day payload, or `undefined` while it is still being read.
 * @returns the summary the panel renders from.
 */
export function summarizeDay(day: HighlightsDayOut | undefined): DaySummary {
  const highlights = day?.highlights ?? [];
  const sources = day?.sources ?? [];
  const readSources = sources.filter((source) => source.state === 'ok');
  const troubledSources = sources.filter(
    (source) => source.state === 'failed' || source.state === 'stale',
  );
  const anyConnected = sources.some((source) => source.state !== 'never_connected');

  const base = {
    keptCount: highlights.filter((highlight) => highlight.kept).length,
    totalCount: highlights.length,
    readSources,
    troubledSources,
    anyConnected,
  };

  if (!day) return { ...base, shape: 'loading' };
  if (highlights.length > 0) return { ...base, shape: 'listed' };
  if (!anyConnected) return { ...base, shape: 'not_connected' };
  // Only a day that has finished being built may be called quiet. `ready` and `empty` are the two
  // settled answers; `pending`, `reconciling` and `failed` all mean the day is still unfinished, and
  // saying "nothing came in today" about one of those is exactly the conflation the status enum
  // exists to prevent. Written as an allowlist of settled states so a status added later reads as
  // unfinished rather than silently joining the quiet case.
  const settled = day.status === 'ready' || day.status === 'empty';
  // Nothing to show, and either a source could not be read or the day is not finished: unfinished,
  // not empty.
  if (troubledSources.length > 0 || !settled) return { ...base, shape: 'incomplete' };
  return { ...base, shape: 'quiet' };
}

/**
 * The local clock range an entry spans, or a single time when it was momentary.
 *
 * @param input - The entry's start and end, and the zone to read them in.
 * @returns a display string.
 */
export function entryTimeLabel(input: {
  readonly occurredAt: string;
  readonly endedAt: string;
  readonly timezone: string;
}): string {
  const clock = (iso: string): string =>
    new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: input.timezone,
    });
  const from = clock(input.occurredAt);
  const to = clock(input.endedAt);
  // A range, never a duration — the length of a working session is a different question, and the
  // Time Ledger is what answers it.
  return from === to ? from : `${from}–${to}`;
}

/** How a narration should be presented: its text, and whether it can be edited or is still coming. */
export interface NarrationView {
  /** The sentence to show; empty when there is none to show yet. */
  readonly text: string;
  /** Whether the person may write or rewrite this line now. */
  readonly editable: boolean;
  /** Whether a sentence is still being written for it. */
  readonly pending: boolean;
}

/**
 * Decide what one entry's narration should say and offer.
 *
 * @remarks
 * Lives here rather than in the row because it is a decision about meaning, not markup, and because
 * the rule it encodes is easy to get wrong in a way no rendering test would notice.
 *
 * @param highlight - The entry.
 * @returns what to render for its narration.
 *
 * @example
 * ```typescript
 * narrationView(entry).editable; // false while a sentence is still being written
 * ```
 */
export function narrationView(highlight: HighlightOut): NarrationView {
  const { state, text } = highlight.narration;
  if (state === 'ready' && text !== null) return { text, editable: true, pending: false };
  if (state === 'failed') {
    // Never an invented first-person sentence — but never blank when the person has written one
    // either. Narration failing does not un-write their rewrite, and `text` already prefers it over
    // the generated line, so discarding it here made a saved edit look thrown away on the next
    // render. The genuinely empty case is nobody having written anything, which gets the plain
    // write-it-yourself affordance.
    return { text: text ?? '', editable: true, pending: false };
  }
  return { text: '', editable: false, pending: true };
}
