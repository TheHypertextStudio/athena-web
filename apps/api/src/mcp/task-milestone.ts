/**
 * `@docket/api` — which milestone a Task written through MCP ends up on.
 *
 * @remarks
 * A milestone groups Tasks within its own Project only. So a milestone named on a write resolves
 * against the Project the Task will be in after the write, and a Task moved to another Project
 * without naming a milestone leaves behind one that belonged to the old Project. `update`,
 * `capture`, and `organize` all decide this the same way, through here.
 */
import { task } from '@docket/db';
import { eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { staleMilestonePatch } from '../routes/task-helpers';
import { resolveMilestone, ULID } from './descriptors';

/** The `list_work` filter that narrows tasks to one milestone. */
export const milestoneFilter = z.string().optional().describe('Only tasks on this milestone.');

/**
 * The task predicate for a `milestone` filter, or nothing when none was given.
 *
 * @param orgId - The organization to resolve within.
 * @param projectId - The `project` filter, already resolved, which scopes a milestone name.
 * @param milestone - The milestone name or id.
 * @returns the predicate, or undefined.
 * @throws {ValidationError} When the name is ambiguous or matches nothing.
 */
export async function milestoneCondition(
  orgId: string,
  projectId: string | undefined,
  milestone: string | undefined,
): Promise<SQL | undefined> {
  if (milestone === undefined) return undefined;
  const resolved = await resolveMilestone(orgId, projectId ?? null, milestone, 'milestone');
  return eq(task.milestoneId, resolved.id);
}

/** The Task columns the decision reads. */
export interface TaskPlacement {
  readonly projectId: string | null;
  readonly milestoneId: string | null;
}

/** The `milestoneId` patch for one Task, or why the Task was left alone. */
export type MilestoneDecision =
  { readonly milestoneId?: string | null } | 'milestone_not_in_project';

/**
 * Build the per-Task milestone decision for one write.
 *
 * @remarks
 * A name is resolved once per Project and reused, so re-filing a hundred Tasks onto "Beta" costs
 * one lookup per Project rather than one per Task. An id outside the Task's Project skips that Task;
 * a name resolves inside each Task's own Project, so "Beta" can mean each Project's own Beta.
 *
 * @param orgId - The organization being written.
 * @param value - The milestone named on the write: a name or id, `null` to clear, or absent.
 * @param nextProjectId - The Project the write moves Tasks to, or absent when it leaves them put.
 * @param field - The argument the milestone came from, for errors.
 * @returns a function deciding the patch for each Task.
 * @throws {ValidationError} From the returned function, when a name is ambiguous or unknown in a
 *   Task's Project.
 */
export function taskMilestoneDecider(
  orgId: string,
  value: string | null | undefined,
  nextProjectId: string | null | undefined,
  field = 'set.milestone',
): (row: TaskPlacement) => Promise<MilestoneDecision> {
  const byProject = new Map<string, { id: string; projectId: string }>();
  const resolveIn = async (projectId: string | null, milestone: string) => {
    const scope = ULID.test(milestone) ? null : projectId;
    const key = scope ?? '';
    const cached = byProject.get(key);
    if (cached) return cached;
    const resolved = await resolveMilestone(orgId, scope, milestone, field);
    byProject.set(key, resolved);
    return resolved;
  };

  return async (row) => {
    const projectId = nextProjectId === undefined ? row.projectId : nextProjectId;
    if (value === undefined) {
      return nextProjectId === undefined ? {} : staleMilestonePatch(row.milestoneId, projectId);
    }
    if (value === null) return { milestoneId: null };
    if (projectId === null) return 'milestone_not_in_project';
    const resolved = await resolveIn(projectId, value);
    return resolved.projectId === projectId
      ? { milestoneId: resolved.id }
      : 'milestone_not_in_project';
  };
}

/** The milestone a write names: a name or id, `null` to clear, or absent. */
interface MilestoneWrite {
  readonly milestone?: string | null | undefined;
}

/** The Project a write moves Tasks to, or absent when it leaves them where they are. */
interface ProjectMove {
  readonly projectId: string | null | undefined;
}

/**
 * Decide the milestone patch for every Task a write will touch, before any of them is written.
 *
 * @remarks
 * Resolution can fail on one Task's Project — a name it does not have — and a write that has
 * already committed earlier rows cannot report that cleanly or record them for `undo`. Deciding
 * up front makes a bad name fail the whole call before anything changes.
 *
 * @param orgId - The organization being written.
 * @param set - The write's `milestone`: a name or id, `null` to clear, or absent.
 * @param refs - The write's resolved `projectId`, absent when it leaves Tasks where they are.
 * @param rows - The Tasks the write will touch.
 * @returns each Task's decision, by id.
 * @throws {ValidationError} When a name is ambiguous or unknown in a Task's Project.
 */
export async function taskMilestoneDecisions(
  orgId: string,
  set: MilestoneWrite,
  refs: ProjectMove,
  rows: readonly Record<string, unknown>[],
): Promise<(id: string) => MilestoneDecision> {
  const decide = taskMilestoneDecider(orgId, set.milestone, refs.projectId);
  const decisions = new Map<string, MilestoneDecision>();
  for (const row of rows) {
    const placement = row as unknown as TaskPlacement & { id: string };
    decisions.set(placement.id, await decide(placement));
  }
  return (id) => decisions.get(id) ?? {};
}
