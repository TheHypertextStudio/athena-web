/**
 * `@docket/api` — the sync **conflict log**: where a losing external value goes when Docket wins.
 *
 * @remarks
 * Introduced for the Notion connector, which is the first one whose whole purpose is that Docket
 * supersedes the source tool: `planTaskReconcile` now resolves a two-sided edit in Docket's favour
 * for every write-back connector, and a decision that discards the other side's value without
 * recording it is exactly the "silently overwrote your work" failure the launch requirements call
 * out. So the losing value is persisted as data, queryable per task and per integration, before
 * the push that overwrites it is issued.
 *
 * **Why the existing `audit_event` ledger and not a new table.** `audit_event` is already the
 * universal, org-scoped, actor-attributed feed with a JSONB payload and an index on
 * `(subject_type, subject_id)` — every property a conflict record needs. Reusing it means this
 * capability ships with **no migration at all** against a database that holds live production
 * data, and a conflict shows up in the task's own history rather than in a side channel nobody
 * opens. The `metadata.kind` discriminator (`sync_conflict`) is what separates these rows from
 * ordinary `updated` audit rows.
 */
import { auditEvent, db } from '@docket/db';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { TaskSyncConflict } from './integration-reconcile';

/** The `metadata.kind` discriminator marking an `audit_event` row as a sync-conflict record. */
export const SYNC_CONFLICT_METADATA_KIND = 'sync_conflict';

/**
 * One recorded conflict, as stored in `audit_event.metadata` and returned by
 * {@link listSyncConflicts}.
 *
 * @remarks
 * `resolution` is a stable machine code, never user-facing copy: the UI decides its own wording.
 * There is exactly one value today because there is exactly one policy — Docket wins — and naming
 * it explicitly is what makes a future second policy a visible schema change rather than a silent
 * behavioural one.
 */
export interface SyncConflictRecord {
  /** Discriminator separating these rows from other audit metadata. */
  readonly kind: typeof SYNC_CONFLICT_METADATA_KIND;
  /** The provider whose value lost. */
  readonly provider: string;
  /** The integration the conflict occurred on. */
  readonly integrationId: string;
  /** How the conflict was settled. */
  readonly resolution: 'docket_wins';
  /** The provider's external id for the conflicted item. */
  readonly externalId: string;
  /** The provider's last-write timestamp that lost (RFC3339). */
  readonly remoteUpdatedAt: string;
  /** Docket's `updatedAt` at the moment it won (ISO-8601). */
  readonly localUpdatedAt: string;
  /** The provider's title at the moment it lost. */
  readonly remoteTitle: string;
  /** The provider's body at the moment it lost, when it carried one. */
  readonly remoteBody: string | null;
  /** The provider's due date at the moment it lost (`null` = explicitly unset). */
  readonly remoteDueDate: string | null;
  /** The provider's completion flag at the moment it lost, when the provider carries one. */
  readonly remoteCompleted: boolean | null;
}

/** One conflict row joined back to the task it happened on. */
export interface SyncConflictRow {
  /** The `audit_event` row id. */
  readonly id: string;
  /** The Docket task whose value won. */
  readonly taskId: string;
  /** When the conflict was recorded. */
  readonly recordedAt: string;
  /** The stored conflict payload. */
  readonly conflict: SyncConflictRecord;
}

/**
 * Persist one losing external value, before the push that overwrites it is issued.
 *
 * @remarks
 * Deliberately called BEFORE the provider write, not after: if the push fails, the record of what
 * Notion held is still the truthful thing to have kept, and a conflict that was detected but never
 * written down is precisely the silent data loss this exists to prevent. Written with the syncing
 * actor so the feed reads "the sync overwrote Notion's value", not "somebody did".
 *
 * @param orgId - The organization the task belongs to.
 * @param actorId - The actor funding the sync run.
 * @param integrationId - The integration being synced.
 * @param provider - The provider whose value lost.
 * @param taskId - The Docket task whose value won.
 * @param conflict - The losing remote values, from {@link TaskSyncConflict}.
 *
 * @example
 * ```typescript
 * await recordSyncConflict(orgId, actorId, row.id, row.provider, local.id, action.conflict);
 * ```
 */
export async function recordSyncConflict(
  orgId: string,
  actorId: string | null,
  integrationId: string,
  provider: string,
  taskId: string,
  conflict: TaskSyncConflict,
): Promise<void> {
  const record: SyncConflictRecord = {
    kind: SYNC_CONFLICT_METADATA_KIND,
    provider,
    integrationId,
    resolution: 'docket_wins',
    externalId: conflict.externalId,
    remoteUpdatedAt: conflict.remoteUpdatedAt,
    localUpdatedAt: conflict.localUpdatedAt,
    remoteTitle: conflict.remoteTitle,
    remoteBody: conflict.remoteBody,
    remoteDueDate: conflict.remoteDueDate ?? null,
    remoteCompleted: conflict.remoteCompleted ?? null,
  };
  await db.insert(auditEvent).values({
    organizationId: orgId,
    ...(actorId !== null ? { actorId } : {}),
    subjectType: 'task',
    subjectId: taskId,
    type: 'updated',
    metadata: record as unknown as Record<string, unknown>,
  });
}

/** Narrow an `audit_event.metadata` blob to a {@link SyncConflictRecord}, or `null`. */
export function asSyncConflictRecord(metadata: unknown): SyncConflictRecord | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const record = metadata as Record<string, unknown>;
  if (record['kind'] !== SYNC_CONFLICT_METADATA_KIND) return null;
  if (typeof record['externalId'] !== 'string') return null;
  if (typeof record['integrationId'] !== 'string') return null;
  return record as unknown as SyncConflictRecord;
}

/**
 * Read the recorded conflicts for one integration, newest first.
 *
 * @remarks
 * Filtered in SQL on the JSONB discriminator so an integration with a long ordinary audit history
 * does not have to be scanned in memory. Ordinary `updated` audit rows carry no `kind`, so they
 * never match.
 *
 * @param orgId - The organization to read within.
 * @param integrationId - The integration whose conflicts to list.
 * @param limit - Maximum rows to return (newest first).
 */
export async function listSyncConflicts(
  orgId: string,
  integrationId: string,
  limit = 50,
): Promise<SyncConflictRow[]> {
  const rows = await db
    .select({
      id: auditEvent.id,
      taskId: auditEvent.subjectId,
      createdAt: auditEvent.createdAt,
      metadata: auditEvent.metadata,
    })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.organizationId, orgId),
        eq(auditEvent.subjectType, 'task'),
        sql`${auditEvent.metadata} ->> 'kind' = ${SYNC_CONFLICT_METADATA_KIND}`,
        sql`${auditEvent.metadata} ->> 'integrationId' = ${integrationId}`,
      ),
    )
    .orderBy(desc(auditEvent.createdAt))
    .limit(limit);

  const conflicts: SyncConflictRow[] = [];
  for (const row of rows) {
    const conflict = asSyncConflictRecord(row.metadata);
    if (conflict === null) continue;
    conflicts.push({
      id: row.id,
      taskId: row.taskId,
      recordedAt: row.createdAt.toISOString(),
      conflict,
    });
  }
  return conflicts;
}
