/**
 * `stream` — group an already-time-sorted event list into recency buckets for section headers.
 *
 * @remarks
 * The server returns newest-first, so this is a single linear bucket pass (no re-sort): each row
 * falls into Today / Yesterday / Earlier this week / Earlier by its `occurredAt` relative to
 * `now`. Pure (takes `now`) so it is unit-testable across day boundaries. When the toolbar groups
 * by a field instead (source/kind/workspace), the view uses the catalog grouping rather than this.
 */
import type { StreamEventRow } from './stream-meta';

/** A labelled, ordered bucket of events. */
export interface StreamGroup {
  readonly label: string;
  readonly rows: readonly StreamEventRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight (local) at the start of `date`'s day. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Bucket newest-first rows into Today / Yesterday / Earlier this week / Earlier.
 *
 * @param rows - Events in newest-first order (the server's order).
 * @param now - The reference time (the local "now").
 * @returns the non-empty buckets, in recency order.
 */
export function groupByRecency(rows: readonly StreamEventRow[], now: Date): StreamGroup[] {
  const today = startOfDay(now);
  const yesterday = today - DAY_MS;
  const weekAgo = today - 6 * DAY_MS;

  const today_: StreamEventRow[] = [];
  const yest: StreamEventRow[] = [];
  const week: StreamEventRow[] = [];
  const earlier: StreamEventRow[] = [];

  for (const row of rows) {
    const t = new Date(row.occurredAt).getTime();
    if (t >= today) today_.push(row);
    else if (t >= yesterday) yest.push(row);
    else if (t >= weekAgo) week.push(row);
    else earlier.push(row);
  }

  return (
    [
      { label: 'Today', rows: today_ },
      { label: 'Yesterday', rows: yest },
      { label: 'Earlier this week', rows: week },
      { label: 'Earlier', rows: earlier },
    ] satisfies StreamGroup[]
  ).filter((g) => g.rows.length > 0);
}
