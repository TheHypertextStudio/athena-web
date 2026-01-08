/**
 * Soft delete utilities and query helpers.
 *
 * Soft delete keeps records in the database with a deletedAt timestamp
 * instead of actually removing them. This allows for:
 * - Recovery of accidentally deleted data
 * - Audit trails
 * - Maintaining referential integrity
 *
 * @packageDocumentation
 */

import { sql, and, isNull, isNotNull } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Filter condition to exclude soft-deleted records.
 * Use in WHERE clauses to only show active records.
 *
 * @example
 * ```ts
 * const activeTasks = await db
 *   .select()
 *   .from(tasks)
 *   .where(notDeleted(tasks.deletedAt));
 * ```
 */
export function notDeleted(deletedAtColumn: PgColumn) {
  return isNull(deletedAtColumn);
}

/**
 * Filter condition to only show soft-deleted records.
 * Use for trash/archive views.
 *
 * @example
 * ```ts
 * const deletedTasks = await db
 *   .select()
 *   .from(tasks)
 *   .where(isDeleted(tasks.deletedAt));
 * ```
 */
export function isDeleted(deletedAtColumn: PgColumn) {
  return isNotNull(deletedAtColumn);
}

/**
 * Combine notDeleted with other conditions.
 *
 * @example
 * ```ts
 * const myActiveTasks = await db
 *   .select()
 *   .from(tasks)
 *   .where(withNotDeleted(tasks.deletedAt, eq(tasks.creatorId, userId)));
 * ```
 */
export function withNotDeleted(deletedAtColumn: PgColumn, ...conditions: Parameters<typeof and>) {
  return and(notDeleted(deletedAtColumn), ...conditions);
}

/**
 * Mark a record as deleted (soft delete).
 *
 * @example
 * ```ts
 * await db
 *   .update(tasks)
 *   .set(softDelete())
 *   .where(eq(tasks.id, taskId));
 * ```
 */
export function softDelete() {
  return {
    deletedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Restore a soft-deleted record.
 *
 * @example
 * ```ts
 * await db
 *   .update(tasks)
 *   .set(restore())
 *   .where(eq(tasks.id, taskId));
 * ```
 */
export function restore() {
  return {
    deletedAt: null,
    updatedAt: new Date(),
  };
}

/**
 * Days after which soft-deleted records can be permanently deleted.
 * Used for implementing retention policies.
 */
export const RETENTION_DAYS = {
  /** Standard retention: 30 days */
  STANDARD: 30,
  /** Extended retention: 90 days */
  EXTENDED: 90,
  /** Compliance retention: 365 days */
  COMPLIANCE: 365,
} as const;

/**
 * Check if a soft-deleted record is past its retention period.
 */
export function isPastRetention(
  deletedAt: Date,
  retentionDays: number = RETENTION_DAYS.STANDARD,
): boolean {
  const retentionCutoff = new Date();
  retentionCutoff.setDate(retentionCutoff.getDate() - retentionDays);
  return deletedAt < retentionCutoff;
}

/**
 * Get the date when a soft-deleted record will be eligible for permanent deletion.
 */
export function getPermanentDeletionDate(
  deletedAt: Date,
  retentionDays: number = RETENTION_DAYS.STANDARD,
): Date {
  const deletionDate = new Date(deletedAt);
  deletionDate.setDate(deletionDate.getDate() + retentionDays);
  return deletionDate;
}

/**
 * SQL condition to find records past their retention period.
 * Use for cleanup jobs.
 *
 * @example
 * ```ts
 * // Find all tasks deleted more than 30 days ago
 * const oldDeletedTasks = await db
 *   .select()
 *   .from(tasks)
 *   .where(pastRetention(tasks.deletedAt, 30));
 * ```
 */
export function pastRetention(
  deletedAtColumn: PgColumn,
  retentionDays: number = RETENTION_DAYS.STANDARD,
) {
  return sql`${deletedAtColumn} < NOW() - INTERVAL '${sql.raw(String(retentionDays))} days'`;
}
