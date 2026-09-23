/**
 * `@docket/api` — audit-event inserts that carry the provenance of the change in flight.
 *
 * @remarks
 * Every `audit_event` row stores the origin of the request that wrote it, so an activity row and
 * the change set recorded beside it name the same channel and performer. The origin is
 * best-effort ({@link auditOrigin}): a row written outside any provenance scope is still written,
 * with a null origin.
 */
import { auditEvent, type db } from '@docket/db';

import { auditOrigin } from './context';

/** One `audit_event` insert. */
export type AuditEventInsert = typeof auditEvent.$inferInsert;

/** A database handle that can insert rows: the pool or an open transaction. */
export type AuditEventWriter = Pick<typeof db, 'insert'>;

/**
 * Stamp each row with the current scope's origin for one operation.
 *
 * @param tool - The operation name recorded as `origin.tool`.
 * @param rows - The rows to stamp.
 * @returns new rows carrying `origin`.
 */
export function withAuditOrigin(
  tool: string,
  rows: readonly AuditEventInsert[],
): AuditEventInsert[] {
  const origin = auditOrigin(tool);
  return rows.map((row) => ({ ...row, origin }));
}

/** Whether the argument is a list of rows rather than one row. */
function isRowList(
  rows: AuditEventInsert | readonly AuditEventInsert[],
): rows is readonly AuditEventInsert[] {
  return Array.isArray(rows);
}

/**
 * Insert audit-event rows stamped with the current scope's origin.
 *
 * @remarks
 * The origin built for `tool` replaces any origin already on the rows, so the operation named at
 * the insert is the one recorded.
 *
 * @param database - The pool or the caller's transaction.
 * @param tool - The operation name recorded as `origin.tool`.
 * @param rows - One row or several; an empty list writes nothing.
 */
export async function insertAuditEvents(
  database: AuditEventWriter,
  tool: string,
  rows: AuditEventInsert | readonly AuditEventInsert[],
): Promise<void> {
  const list = isRowList(rows) ? rows : [rows];
  if (list.length === 0) return;
  await database.insert(auditEvent).values(withAuditOrigin(tool, list));
}
