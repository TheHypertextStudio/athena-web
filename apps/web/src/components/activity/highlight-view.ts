/**
 * `activity` — pure view-model for a narrated day.
 *
 * @remarks
 * Everything here answers a question the panel has to answer honestly, and answers it from the
 * payload rather than from appearances. The important one is {@link summarizeDay}: a day with nothing
 * in it and a day whose sources could not be read look identical on screen unless something insists
 * they are different, and this is that something.
 */
import type { HighlightSourceStatus, HighlightsDayOut, SourceSystemKind } from '@docket/types';

/** Human labels for the sources a day can draw on. Application-owned, never a provider's own name. */
const SOURCE_LABEL: Partial<Record<SourceSystemKind, string>> = {
  github: 'GitHub',
  gmail: 'Gmail',
  google_calendar: 'Calendar',
  linear: 'Linear',
  docket: 'Docket',
};

/**
 * The display label for a source.
 *
 * @param system - The canonical source system.
 * @returns a human label.
 */
export function sourceLabel(system: SourceSystemKind): string {
  return SOURCE_LABEL[system] ?? system.replaceAll('_', ' ');
}

/** Join labels into a readable list ("Gmail, GitHub and Calendar"). */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`;
}

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
  // Nothing to show *and* something could not be read: the day is unfinished, not empty.
  if (troubledSources.length > 0 || day.status === 'pending')
    return { ...base, shape: 'incomplete' };
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
