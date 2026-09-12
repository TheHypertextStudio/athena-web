/**
 * `@docket/api` — writing a Project's milestones, wherever the write comes from.
 *
 * @remarks
 * Two routers create milestones: the milestones router, one at a time under an existing Project,
 * and the projects router, as part of the transaction that creates the Project itself. Both map the
 * same {@link MilestoneCreate} onto the same columns, and a field remembered in one place and not
 * the other is a silent difference between two surfaces that should be identical — `createdBy` was
 * exactly that, set by one and dropped by the other. The mapping lives here so there is one of it.
 *
 * Positions are assigned here too, because appending is a read of rows the caller cannot see.
 */
import { db, milestone, project } from '@docket/db';
import type { MilestoneCreate } from '@docket/work/milestone-contract';
import { and, eq, max } from 'drizzle-orm';

/** A transaction handle, as `db.transaction` hands one to its callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A milestone row as the database returns it. */
export type MilestoneRow = typeof milestone.$inferSelect;

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
  const row = await db.transaction(async (tx) => {
    await lockProjectForAppend(tx, context.orgId, context.projectId);
    const [inserted] = await insertMilestones(
      tx,
      context,
      [entry],
      await appendSort(tx, context.orgId, context.projectId),
    );
    return inserted;
  });
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!row) throw new Error('milestone insert returned no row');
  return row;
}
