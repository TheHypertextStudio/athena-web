/**
 * `stream` — pure reader-position-preserving merge for a polling infinite timeline.
 *
 * @remarks
 * A new fetched prefix is held as pending while the reader keeps their current first visible event
 * as an anchor. Older pagination results append immediately. The latest complete fetched order is
 * retained so revealing pending activity is atomic and cannot duplicate rows.
 */
import type { StreamEventRow } from './stream-meta';

/** One buffered client view of the current server result. */
export interface StreamSnapshot {
  readonly queryKey: string;
  readonly visible: readonly StreamEventRow[];
  readonly pending: readonly StreamEventRow[];
  readonly latestFetched: readonly StreamEventRow[];
}

/** Deduplicate rows by id while preserving the first occurrence. */
function unique(rows: readonly StreamEventRow[]): StreamEventRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/**
 * Merge a fresh polling/pagination result into the reader's snapshot.
 *
 * @param current - The prior snapshot, or null on initial load.
 * @param fetchedRows - Every row currently held by the infinite query in server order.
 * @param queryKey - Stable identity for the active filter/sort/scope result.
 */
export function mergeStreamSnapshot(
  current: StreamSnapshot | null,
  fetchedRows: readonly StreamEventRow[],
  queryKey: string,
): StreamSnapshot {
  const fetched = unique(fetchedRows);
  const anchor = current?.visible[0];
  if (current?.queryKey !== queryKey || !anchor) {
    return { queryKey, visible: fetched, pending: [], latestFetched: fetched };
  }

  const anchorId = anchor.id;
  const anchorIndex = fetched.findIndex((row) => row.id === anchorId);
  if (anchorIndex < 0) {
    return { queryKey, visible: fetched, pending: [], latestFetched: fetched };
  }

  const visibleIds = new Set(current.visible.map((row) => row.id));
  const pending = fetched.slice(0, anchorIndex).filter((row) => !visibleIds.has(row.id));
  const fetchedById = new Map(fetched.map((row) => [row.id, row]));
  const refreshedVisible = current.visible.map((row) => fetchedById.get(row.id) ?? row);
  const appended = fetched.slice(anchorIndex + 1).filter((row) => !visibleIds.has(row.id));

  return {
    queryKey,
    visible: unique([...refreshedVisible, ...appended]),
    pending,
    latestFetched: fetched,
  };
}

/** Reveal every fetched event in server order and clear the pending prefix. */
export function revealStreamSnapshot(snapshot: StreamSnapshot): StreamSnapshot {
  return {
    ...snapshot,
    visible: snapshot.latestFetched,
    pending: [],
  };
}
