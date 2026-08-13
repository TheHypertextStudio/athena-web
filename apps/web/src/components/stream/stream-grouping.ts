/**
 * `stream` — pure projection from a newest-first event sequence to chronological date sections
 * and adjacent subject episodes.
 *
 * @remarks
 * Episodes never reorder the canonical event log. Only consecutive events for the same subject,
 * in the same recency bucket and no more than two hours apart, share a presentation group. Every
 * source event remains in `allEvents`; conservative classification and duplicate folding affect
 * only which lines are initially visible.
 *
 * The grouping itself lives in `@docket/types` so the server groups activity through the same
 * implementation — see {@link groupAdjacentEpisodes}. What stays here is presentation the server
 * has no business knowing: recency labels are relative to the *viewer's* clock, and only a browser
 * has one.
 */
import {
  groupAdjacentEpisodes,
  type Episode,
  episodeEventFingerprint,
  episodeSubjectKey,
  isSubstantiveEpisodeEvent,
} from '@docket/types';

import type { StreamEventRow } from './stream-meta';

/**
 * One presentation episode about a single subject.
 *
 * @remarks
 * {@link StreamEventRow} satisfies the shared `EpisodeEvent` contract structurally, so no
 * conversion happens at this boundary.
 */
export type StreamEpisode = Episode<StreamEventRow>;

/** A labelled recency section containing subject episodes. */
export interface StreamDateGroup {
  readonly label: string;
  readonly episodes: readonly StreamEpisode[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight (local) at the start of `date`'s day. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Return the recency section key for one timestamp. */
function recencyLabel(occurredAt: string, now: Date): string {
  const time = new Date(occurredAt).getTime();
  const today = startOfDay(now);
  if (time >= today) return 'Today';
  if (time >= today - DAY_MS) return 'Yesterday';
  if (time >= today - 6 * DAY_MS) return 'Earlier this week';
  return 'Earlier';
}

/** Resolve the stable tenant-qualified subject key used for adjacent clustering. */
export const streamSubjectKey = episodeSubjectKey;

/** Decide whether a canonical event must remain an explicit line. */
export const isSubstantiveStreamEvent = isSubstantiveEpisodeEvent;

/** Presentation fingerprint for defensive duplicate folding. */
export const streamEventFingerprint = episodeEventFingerprint;

/**
 * Build recency sections and adjacent subject episodes without reordering or dropping events.
 *
 * @param rows - Canonical events in server order, newest first.
 * @param now - Local reference time used for recency labels.
 */
export function buildStreamGroups(rows: readonly StreamEventRow[], now: Date): StreamDateGroup[] {
  const groups: { label: string; rows: StreamEventRow[] }[] = [];

  for (const row of rows) {
    const label = recencyLabel(row.occurredAt, now);
    let group = groups[groups.length - 1];
    if (group?.label !== label) {
      group = { label, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }

  return groups.map((group) => ({
    label: group.label,
    episodes: groupAdjacentEpisodes(group.rows),
  }));
}

/** Compatibility adapter for consumers that still need plain date buckets. */
export function groupByRecency(
  rows: readonly StreamEventRow[],
  now: Date,
): { readonly label: string; readonly rows: readonly StreamEventRow[] }[] {
  return buildStreamGroups(rows, now).map((group) => ({
    label: group.label,
    rows: group.episodes.flatMap((episode) => episode.allEvents),
  }));
}
