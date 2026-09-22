/**
 * `@docket/api` — the milestone half of placing a plan.
 *
 * @remarks
 * A milestone sits under a project, and a task placed under a milestone lands on it. Kept beside
 * `place.ts` rather than inside it so the walk there stays about the tree, with the rules that only
 * milestones need living here: matching by name within the project, appending to the project's
 * timeline, and attaching tasks a re-run matches.
 */
import { milestone, task } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ValidationError } from '../../error';
import { trackedFields, type ChangeRecord } from '../../mcp/change-set';
import { resolveMilestone } from '../../mcp/descriptors';
import { entityHref } from '../../mcp/entity-href';
import { appendMilestonesInTx } from '../milestone-writes';
import type { OrganizeItem, PlaceInput, PlaceResult, Tx } from './place';

/**
 * Resolve an item's `milestone`, and the project it implies.
 *
 * @remarks
 * A milestone names its project, so a task given only `milestone` still lands in the right one. A
 * `project` given alongside scopes the name to that project.
 *
 * @param orgId - The organization the names belong to.
 * @param item - The item as supplied.
 * @param projectId - The item's `project`, already resolved.
 * @returns the project and milestone the item lands in, null where it names neither.
 */
export async function resolveItemMilestone(
  orgId: string,
  item: OrganizeItem,
  projectId: string | undefined,
): Promise<{ projectId: string | null; milestoneId: string | null }> {
  if (item.milestone === undefined) return { projectId: projectId ?? null, milestoneId: null };
  const resolved = await resolveMilestone(orgId, projectId ?? null, item.milestone, 'milestone');
  return { projectId: resolved.projectId, milestoneId: resolved.id };
}

/**
 * Put a matched task on the milestone the plan places it under.
 *
 * @remarks
 * Re-running a plan that now groups existing tasks under milestones attaches them, the same way a
 * re-run links existing projects to a new initiative rather than doing nothing. The task was
 * matched within the milestone's project, so the link is always valid.
 *
 * @param tx - The open transaction.
 * @param row - The matched task.
 * @param milestoneId - The milestone the plan puts it on, or null for none.
 * @returns the change to record, or undefined when nothing moved.
 */
export async function attachToMilestone(
  tx: Tx,
  row: typeof task.$inferSelect,
  milestoneId: string | null,
): Promise<ChangeRecord | undefined> {
  if (milestoneId === null || row.milestoneId === milestoneId) return undefined;
  const [after] = await tx
    .update(task)
    .set({ milestoneId })
    .where(and(eq(task.id, row.id), eq(task.organizationId, row.organizationId)))
    .returning();
  /* v8 ignore next -- @preserve defensive: the row was just read in this transaction */
  if (!after) return undefined;
  return {
    kind: 'task',
    id: row.id,
    op: 'update',
    before: trackedFields('task', row),
    after: trackedFields('task', after),
  };
}

/** Refuse a milestone with no project to sit in. */
function needsProject(item: OrganizeItem): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'invalid_value',
        path: ['parent'],
        message: `Milestone "${item.title}" needs a project: place it under a project item, or name one with \`project\`.`,
        values: ['project'],
        input: item.ref,
      },
    ]),
  );
}

/**
 * Place a milestone: match one of that name in its project, or append a new one.
 *
 * @param tx - The open transaction.
 * @param input - The resolved item.
 * @returns what it became, and the change to record when it was created.
 * @throws {ValidationError} When the item has no project to sit in.
 */
export async function placeMilestone(tx: Tx, input: PlaceInput): Promise<PlaceResult> {
  const { item, at, orgId } = input;
  const projectId = at.projectId;
  if (projectId === null) needsProject(item);
  const identity = {
    ref: item.ref,
    title: item.title,
    parent: item.parent,
    href: entityHref(orgId, 'project', projectId),
    kind: 'milestone',
    projectId,
  } as const;
  const [existing] = await tx
    .select({ id: milestone.id })
    .from(milestone)
    .where(
      and(
        eq(milestone.organizationId, orgId),
        eq(milestone.projectId, projectId),
        sql`lower(${milestone.name}) = lower(${item.title})`,
      ),
    )
    .limit(1);
  if (existing) return { placed: { ...identity, id: existing.id, created: false } };

  const [row] = await appendMilestonesInTx(tx, { orgId, projectId, actorId: input.actorId }, [
    {
      name: item.title,
      ...(item.description === undefined ? {} : { description: item.description }),
      ...(item.targetDate === undefined ? {} : { targetDate: item.targetDate }),
    },
  ]);
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('milestone insert returned no row');
  return {
    placed: { ...identity, id: row.id, created: true },
    change: { kind: 'milestone', id: row.id, op: 'create', after: trackedFields('milestone', row) },
  };
}
