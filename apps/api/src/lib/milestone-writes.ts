/**
 * `@docket/api` — writing a Project's milestones, wherever the write comes from.
 *
 * @remarks
 * Two routers create milestones: the milestones router, one at a time under an existing Project,
 * and the projects router, as part of the transaction that creates the Project itself. Both map the
 * same {@link MilestoneCreate} onto the same columns, and a field remembered in one place and not
 * the other is a silent difference between two surfaces that should be identical — `createdBy` was
 * exactly that, set by one and dropped by the other. The mapping lives here so there is one of it.
 * The MCP `milestones` tool reads, updates, and deletes through the same helpers as the REST
 * routes, so the two surfaces cannot drift on what a write touches.
 *
 * Positions are assigned here too, because appending is a read of rows the caller cannot see.
 */
import { db, milestone, project, task } from '@docket/db';
import type {
  MilestoneCreate,
  MilestoneOut,
  MilestoneProgress,
  MilestoneUpdate,
} from '@docket/work/milestone-contract';
import { and, eq, max } from 'drizzle-orm';
import type { z } from 'zod';

import { NotFoundError } from '../error';
import { one } from './one';
import { assertProjectInOrg } from './project-guard';

/** A transaction handle, as `db.transaction` hands one to its callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A milestone row as the database returns it. */
export type MilestoneRow = typeof milestone.$inferSelect;

/** What deleting a milestone did. */
export interface DeletedMilestone {
  /** The row as it was just before it was deleted. */
  readonly row: MilestoneRow;
  /** Every Task that pointed at it, when the caller asked for them. */
  readonly detachedTaskIds: readonly string[];
}

/** The progress a milestone with no visible Tasks reports. */
const NO_PROGRESS: MilestoneProgress = { total: 0, completed: 0 };

/**
 * Shape a milestone row for the wire.
 *
 * @param row - The milestone row.
 * @param progress - Its visible Task totals; absent means none.
 * @returns the {@link MilestoneOut} value.
 */
export function toMilestoneOut(
  row: MilestoneRow,
  progress: MilestoneProgress = NO_PROGRESS,
): z.input<typeof MilestoneOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    targetDate: row.targetDate?.toISOString() ?? null,
    sort: row.sort,
    createdAt: row.createdAt.toISOString(),
    progress,
  };
}

/**
 * Count milestone progress from Task rows a caller has already read and filtered for visibility.
 *
 * @remarks
 * For reads that hold the Project's visible Tasks anyway, so progress counts exactly the Tasks the
 * same response shows without a second query.
 *
 * @param tasks - The visible, non-archived Tasks.
 * @returns totals keyed by milestone id; a milestone with no Tasks here is absent.
 */
export function milestoneProgressOf(
  tasks: readonly { readonly milestoneId: string | null; readonly completedAt: Date | null }[],
): Map<string, MilestoneProgress> {
  const progress = new Map<string, { total: number; completed: number }>();
  for (const row of tasks) {
    if (row.milestoneId === null) continue;
    const counts = progress.get(row.milestoneId) ?? { total: 0, completed: 0 };
    counts.total += 1;
    if (row.completedAt !== null) counts.completed += 1;
    progress.set(row.milestoneId, counts);
  }
  return progress;
}

/**
 * Read one milestone as a member of the given Project.
 *
 * @remarks
 * The parent is checked first, on the same terms the collection reads use, so a milestone under an
 * archived Project is as unreachable as the Project's own list.
 *
 * @param orgId - The caller's organization.
 * @param projectId - The Project that must own it.
 * @param milestoneId - The milestone.
 * @returns the milestone row.
 * @throws NotFoundError when the Project or the milestone is absent or cross-tenant, or when the
 *   milestone belongs to a different Project.
 */
export async function loadMilestone(
  orgId: string,
  projectId: string,
  milestoneId: string,
): Promise<MilestoneRow> {
  await assertProjectInOrg(orgId, projectId);
  const row = await one(
    db
      .select()
      .from(milestone)
      .where(
        and(
          eq(milestone.id, milestoneId),
          eq(milestone.organizationId, orgId),
          eq(milestone.projectId, projectId),
        ),
      ),
  );
  if (!row) throw new NotFoundError('Milestone not found');
  return row;
}

/**
 * Apply a partial update to one milestone.
 *
 * @remarks
 * An absent key leaves its column alone; an explicit `null` description or target date clears it.
 * The caller has already proven the milestone belongs to the Project it named.
 *
 * @param orgId - The caller's organization.
 * @param milestoneId - The milestone to change.
 * @param patch - The fields to write.
 * @returns the updated row.
 * @throws NotFoundError when the row vanished between the caller's read and this write.
 */
export async function updateMilestone(
  orgId: string,
  milestoneId: string,
  patch: MilestoneUpdate,
): Promise<MilestoneRow> {
  const [row] = await db
    .update(milestone)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.targetDate !== undefined
        ? { targetDate: patch.targetDate ? new Date(patch.targetDate) : null }
        : {}),
      ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
    })
    .where(and(eq(milestone.id, milestoneId), eq(milestone.organizationId, orgId)))
    .returning();
  /* v8 ignore next -- @preserve defensive: the caller's `loadMilestone` proved the row exists */
  if (!row) throw new NotFoundError('Milestone not found');
  return row;
}

/**
 * Delete one milestone, optionally reporting the Tasks it released.
 *
 * @remarks
 * The Tasks survive: the foreign key clears their `milestone_id`. A caller that records an undo
 * asks for their ids, read in the same transaction as the delete so the list is the set the delete
 * detached; anyone else skips the read.
 *
 * @param orgId - The caller's organization.
 * @param milestoneId - The milestone to delete.
 * @param collectDetached - Whether to read the ids of the Tasks that pointed at it.
 * @returns the deleted row and, when asked for, the Tasks that pointed at it.
 * @throws NotFoundError when the row vanished between the caller's read and this write.
 */
export async function deleteMilestone(
  orgId: string,
  milestoneId: string,
  collectDetached = false,
): Promise<DeletedMilestone> {
  return db.transaction(async (tx) => {
    const detached = collectDetached
      ? await tx
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.organizationId, orgId), eq(task.milestoneId, milestoneId)))
      : [];
    const [row] = await tx
      .delete(milestone)
      .where(and(eq(milestone.id, milestoneId), eq(milestone.organizationId, orgId)))
      .returning();
    /* v8 ignore next -- @preserve defensive: the caller's `loadMilestone` proved the row exists */
    if (!row) throw new NotFoundError('Milestone not found');
    return { row, detachedTaskIds: detached.map((t) => t.id) };
  });
}

/** Everything a milestone write needs that does not come from the request body. */
export interface MilestoneWriteContext {
  /** The caller's organization, already verified to own the Project. */
  readonly orgId: string;
  /** The Project the milestones belong to. */
  readonly projectId: string;
  /** The actor to record as the creator. */
  readonly actorId: string;
}

/**
 * The position the next appended milestone takes.
 *
 * @remarks
 * Reads the highest position in use rather than the count: the API never renumbers after a delete,
 * so a project holding 0 and 2 would otherwise hand the next milestone a colliding 1.
 *
 * Must run inside a transaction that has already locked the parent Project — see
 * {@link lockProjectForAppend}. Read on its own it is a classic read-then-write race: two creates
 * in flight at once both see the state before either commits, and both land at the same position.
 * That is not hypothetical here, because the add row on the project Overview deliberately accepts
 * the next name before the previous create has settled.
 *
 * @param tx - The open transaction holding the Project lock.
 * @param orgId - The caller's organization.
 * @param projectId - The Project to append within.
 * @returns one past the highest position in use, or `0` when the project has no milestones.
 */
async function appendSort(tx: Tx, orgId: string, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ highest: max(milestone.sort) })
    .from(milestone)
    .where(and(eq(milestone.organizationId, orgId), eq(milestone.projectId, projectId)));
  return (row?.highest ?? -1) + 1;
}

/**
 * Take the Project's row lock, so appends to it happen one at a time.
 *
 * @remarks
 * The lock is on the parent, not the milestone table, so two people adding checkpoints to different
 * projects never wait on each other. Milestone creates are rare and short, and the alternative — a
 * unique `(project_id, sort)` constraint plus a retry loop — buys nothing a lock does not, since
 * `sort` is an ordering key that is allowed to have gaps.
 *
 * @param tx - The open transaction.
 * @param orgId - The caller's organization.
 * @param projectId - The Project to lock.
 */
async function lockProjectForAppend(tx: Tx, orgId: string, projectId: string): Promise<void> {
  await tx
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, orgId)))
    .for('update');
}

/**
 * Write a Project's milestones, in order.
 *
 * @remarks
 * An entry carrying its own `sort` keeps it. An entry without one takes the next position after the
 * entry before it, starting from `firstSort`.
 *
 * @param tx - The open transaction; the caller owns the boundary.
 * @param context - The org, Project, and creating actor.
 * @param entries - The milestones to create, in display order.
 * @param firstSort - The position for the first entry that does not name one.
 * @returns the inserted rows, in the order they were given.
 */
export async function insertMilestones(
  tx: Tx,
  context: MilestoneWriteContext,
  entries: readonly MilestoneCreate[],
  firstSort: number,
): Promise<MilestoneRow[]> {
  if (entries.length === 0) return [];
  return tx
    .insert(milestone)
    .values(
      entries.map((entry, index) => ({
        organizationId: context.orgId,
        projectId: context.projectId,
        name: entry.name,
        description: entry.description ?? null,
        targetDate: entry.targetDate ? new Date(entry.targetDate) : undefined,
        sort: entry.sort ?? firstSort + index,
        createdBy: context.actorId,
      })),
    )
    .returning();
}

/**
 * Create one milestone at the end of an existing Project's list.
 *
 * @remarks
 * Opens its own transaction so the position it reads cannot be taken by a concurrent create between
 * the read and the insert. A caller that supplies `sort` still pays for the transaction, which is
 * one statement's worth of overhead on a write that is already a round trip.
 *
 * @param context - The org, Project, and creating actor.
 * @param entry - The milestone to create.
 * @returns the inserted row.
 * @throws Error when the insert returns nothing, which a successful insert cannot do.
 */
export async function appendMilestone(
  context: MilestoneWriteContext,
  entry: MilestoneCreate,
): Promise<MilestoneRow> {
  const [row] = await appendMilestones(context, [entry]);
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!row) throw new Error('milestone insert returned no row');
  return row;
}

/**
 * Create several milestones at the end of an existing Project's list, all or none.
 *
 * @remarks
 * One transaction and one Project lock for the whole batch, so the entries land contiguously and
 * in the order given even while someone else is adding checkpoints to the same Project.
 *
 * @param context - The org, Project, and creating actor.
 * @param entries - The milestones to create, in display order.
 * @returns the inserted rows, in the order they were given.
 */
export async function appendMilestones(
  context: MilestoneWriteContext,
  entries: readonly MilestoneCreate[],
): Promise<MilestoneRow[]> {
  return db.transaction((tx) => appendMilestonesInTx(tx, context, entries));
}

/**
 * Append milestones inside a transaction the caller already owns.
 *
 * @remarks
 * For writers that place milestones alongside other rows in one transaction, such as `organize`.
 * The Project lock is taken here and held until the caller's transaction ends.
 *
 * @param tx - The caller's open transaction.
 * @param context - The org, Project, and creating actor.
 * @param entries - The milestones to create, in display order.
 * @returns the inserted rows, in the order they were given.
 */
export async function appendMilestonesInTx(
  tx: Tx,
  context: MilestoneWriteContext,
  entries: readonly MilestoneCreate[],
): Promise<MilestoneRow[]> {
  await lockProjectForAppend(tx, context.orgId, context.projectId);
  return insertMilestones(
    tx,
    context,
    entries,
    await appendSort(tx, context.orgId, context.projectId),
  );
}
