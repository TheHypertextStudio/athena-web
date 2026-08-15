/**
 * `@docket/db` — seeding a workspace's status sets.
 *
 * @remarks
 * Every workspace needs a status set for each kind of work it tracks before any of that work can
 * exist, because the status is what a Task, Project, Program, or Initiative points at. That makes
 * this a bootstrap primitive rather than an application concern: workspace creation calls it, the
 * migration that backfills existing workspaces produces the same rows, and tests call it to make
 * a workspace usable.
 *
 * The seed itself lives in `@docket/types` ({@link DEFAULT_WORK_STATUSES}) so the API, the web
 * app, and this module cannot disagree about what a new workspace starts with.
 */
import { and, eq, isNull } from 'drizzle-orm';

import { DEFAULT_WORK_STATUSES, type WorkStatusEntityType } from '@docket/types';

import type { Database } from './client';
import { genId } from './id';
import { workStatus } from './schema';

/**
 * A workspace's seeded statuses, keyed by `<entityType>:<key>`.
 *
 * @remarks
 * Returned so a caller that has just seeded a workspace can point its first work at a status
 * without a second round trip.
 */
export type SeededStatuses = ReadonlyMap<string, string>;

/** The lookup key for one status within a {@link SeededStatuses} map. */
export function statusLookupKey(entityType: WorkStatusEntityType, key: string): string {
  return `${entityType}:${key}`;
}

/** The database handle this module accepts: the client, or a transaction on it. */
type DbLike = Pick<Database, 'insert' | 'select'>;

/**
 * Give a workspace the default status set for every kind of work.
 *
 * @remarks
 * Idempotent by check rather than by upsert: a workspace that already has statuses keeps them,
 * so re-running a bootstrap never duplicates a set or resets a rename. Only the workspace sets
 * are seeded — a team's own Task statuses come into being when someone forks that team.
 *
 * @param db - The database handle, or the transaction to seed inside.
 * @param organizationId - The workspace to seed.
 * @param createdBy - The Actor to credit, when one exists yet.
 * @returns the seeded statuses, keyed by {@link statusLookupKey}.
 *
 * @example
 * ```typescript
 * const statuses = await seedWorkspaceStatuses(tx, org.id, ownerActor.id);
 * const landing = statuses.get(statusLookupKey('task', 'backlog'));
 * ```
 */
export async function seedWorkspaceStatuses(
  db: DbLike,
  organizationId: string,
  createdBy: string | null = null,
): Promise<SeededStatuses> {
  const existing = await db
    .select({ id: workStatus.id, entityType: workStatus.entityType, key: workStatus.key })
    .from(workStatus)
    .where(and(eq(workStatus.organizationId, organizationId), isNull(workStatus.teamId)));

  if (existing.length > 0) {
    return new Map(existing.map((row) => [statusLookupKey(row.entityType, row.key), row.id]));
  }

  const rows = Object.entries(DEFAULT_WORK_STATUSES).flatMap(([entityType, seeds]) =>
    seeds.map((seed) => ({
      id: genId(),
      organizationId,
      createdBy,
      entityType: entityType as WorkStatusEntityType,
      teamId: null,
      key: seed.key,
      name: seed.name,
      description: seed.description,
      category: seed.category,
      position: seed.position,
      isDefault: seed.isDefault ?? false,
    })),
  );

  await db.insert(workStatus).values(rows);
  return new Map(rows.map((row) => [statusLookupKey(row.entityType, row.key), row.id]));
}
