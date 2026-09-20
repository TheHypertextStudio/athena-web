/** Cursor-backed saved-view reads that filter stale stored definitions before paging. */
import { db, savedView } from '@docket/db';
import { and, asc, type SQL } from 'drizzle-orm';

import type { Page } from '../contracts/pagination';
import { encodeIdCursor, pageResultById, seekAfterId } from '../lib/list-cursor';

/** Read one full visible page even when stale rows must be omitted. */
export async function pageSavedViews<Output extends { id: string }>(
  visibility: SQL,
  cursor: string | undefined,
  limit: number,
  project: (row: typeof savedView.$inferSelect) => Output | null,
): Promise<Page<Output>> {
  const items: Output[] = [];
  let scanCursor = cursor;
  let exhausted = false;
  while (items.length < limit + 1 && !exhausted) {
    const batchLimit = limit + 1 - items.length;
    const rows = await db
      .select()
      .from(savedView)
      .where(and(visibility, seekAfterId(savedView.id, scanCursor, 'asc')))
      .orderBy(asc(savedView.id))
      .limit(batchLimit);
    exhausted = rows.length < batchLimit;
    const last = rows.at(-1);
    if (last) scanCursor = encodeIdCursor(last.id);
    items.push(...rows.map(project).filter((item): item is Output => item !== null));
  }
  return pageResultById(items, limit);
}
