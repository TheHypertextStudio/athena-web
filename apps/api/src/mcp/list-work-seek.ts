/**
 * `@docket/api` — the keyset paging predicate shared by every `list_work` query.
 */
import { and, eq, lt, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { WorkCursor } from './tools-shared-queries';

/**
 * The keyset predicate that resumes a page, built per table.
 *
 * @remarks
 * `(createdAt DESC, id DESC)` with the id as tiebreak, so paging never skips or repeats a row even
 * as work is created underneath it.
 */
export function seekAfter(
  createdAtColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  after: WorkCursor | undefined,
): SQL | undefined {
  if (!after) return undefined;
  return or(
    lt(createdAtColumn, after.createdAt),
    and(eq(createdAtColumn, after.createdAt), lt(idColumn, after.id)),
  );
}
