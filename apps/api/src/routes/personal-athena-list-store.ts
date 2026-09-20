/** Cursor-backed reads for the three owner-only personal Athena collections. */
import { athenaAssignment, athenaTrigger, db, personalMcpConnection } from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';

import type { Page } from '../contracts/pagination';
import { pageResult, seekAfter } from '../lib/list-cursor';

interface ListPage {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** Convert over-fetched timestamped rows into a public page after serialization. */
export function personalAthenaPage<Row, Output extends { id: string; createdAt: string }>(
  rows: readonly Row[],
  limit: number,
  serialize: (row: Row) => Output,
): Page<Output> {
  return pageResult(rows.map(serialize), limit, (item) => new Date(item.createdAt));
}

/** Read one page of an owner's personal MCP connections. */
export async function listPersonalMcpConnections(
  ownerUserId: string,
  page: ListPage,
): Promise<(typeof personalMcpConnection.$inferSelect)[]> {
  return db
    .select()
    .from(personalMcpConnection)
    .where(
      and(
        eq(personalMcpConnection.ownerUserId, ownerUserId),
        seekAfter(personalMcpConnection.createdAt, personalMcpConnection.id, page.cursor, 'asc'),
      ),
    )
    .orderBy(asc(personalMcpConnection.createdAt), asc(personalMcpConnection.id))
    .limit(page.limit + 1);
}

/** Read one page of an owner's Athena assignments. */
export async function listPersonalAthenaAssignments(
  ownerUserId: string,
  page: ListPage,
): Promise<(typeof athenaAssignment.$inferSelect)[]> {
  return db
    .select()
    .from(athenaAssignment)
    .where(
      and(
        eq(athenaAssignment.ownerUserId, ownerUserId),
        seekAfter(athenaAssignment.createdAt, athenaAssignment.id, page.cursor, 'asc'),
      ),
    )
    .orderBy(asc(athenaAssignment.createdAt), asc(athenaAssignment.id))
    .limit(page.limit + 1);
}

/** Read one page of an owner's triggers for one assignment. */
export async function listPersonalAthenaTriggers(
  ownerUserId: string,
  assignmentId: string,
  page: ListPage,
): Promise<(typeof athenaTrigger.$inferSelect)[]> {
  return db
    .select()
    .from(athenaTrigger)
    .where(
      and(
        eq(athenaTrigger.assignmentId, assignmentId),
        eq(athenaTrigger.ownerUserId, ownerUserId),
        seekAfter(athenaTrigger.createdAt, athenaTrigger.id, page.cursor, 'asc'),
      ),
    )
    .orderBy(asc(athenaTrigger.createdAt), asc(athenaTrigger.id))
    .limit(page.limit + 1);
}
