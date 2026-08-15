/**
 * `@docket/api` — the org work-layer export collector.
 *
 * @remarks
 * Snapshots every org-scoped work-layer table for one organization into a flat
 * `tableName → rows[]` map, strictly filtered by `organization_id` so no cross-org rows
 * can leak. {@link collectWorkLayer} is the complete, manage-gated org-facing snapshot
 * (`POST /orgs/:orgId/billing/export`). Personal account exports use
 * {@link collectVisibleWorkLayerForActor} instead: membership is not permission to download
 * every row in an organization.
 */
import type { Database } from '@docket/db';
import {
  comment,
  cycle,
  db as defaultDb,
  initiative,
  label,
  milestone,
  program,
  project,
  savedView,
  task,
  team,
  update,
} from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { buildTaskViewFilter } from '../routes/task-helpers';

/**
 * Collect every org-scoped work-layer table for an org into a single export document.
 *
 * @param orgId - The organization whose work layer to snapshot.
 * @param db - The database client (defaults to the shared singleton).
 * @returns the per-table row collections, keyed by table name.
 */
export async function collectWorkLayer(
  orgId: string,
  db: Database = defaultDb,
): Promise<Record<string, unknown[]>> {
  const [
    teams,
    initiatives,
    programs,
    projects,
    milestones,
    cycles,
    tasks,
    labels,
    comments,
    updates,
    savedViews,
  ] = await Promise.all([
    db.select().from(team).where(eq(team.organizationId, orgId)),
    db.select().from(initiative).where(eq(initiative.organizationId, orgId)),
    db.select().from(program).where(eq(program.organizationId, orgId)),
    db.select().from(project).where(eq(project.organizationId, orgId)),
    db.select().from(milestone).where(eq(milestone.organizationId, orgId)),
    db.select().from(cycle).where(eq(cycle.organizationId, orgId)),
    db.select().from(task).where(eq(task.organizationId, orgId)),
    db.select().from(label).where(eq(label.organizationId, orgId)),
    db.select().from(comment).where(eq(comment.organizationId, orgId)),
    db.select().from(update).where(eq(update.organizationId, orgId)),
    db.select().from(savedView).where(eq(savedView.organizationId, orgId)),
  ]);
  return {
    team: teams,
    initiative: initiatives,
    program: programs,
    project: projects,
    milestone: milestones,
    cycle: cycles,
    task: tasks,
    label: labels,
    comment: comments,
    update: updates,
    savedView: savedViews,
  };
}

/** The task-filtered portion of an org work layer that a personal export may serialize. */
export interface VisibleWorkLayer {
  /** The stable work-layer shape written into a workspace JSON file. */
  readonly work: Record<string, unknown[]>;
  /** Visible task ids, used to screen task-addressed personal rows such as daily-plan items. */
  readonly visibleTaskIds: ReadonlySet<string>;
}

/**
 * Collect the work rows that a specific active human actor may safely receive in a personal
 * account export.
 *
 * @remarks
 * This intentionally differs from {@link collectWorkLayer}: a personal export is a caller's
 * view, not an organization administrator's backup. Tasks use the canonical bulk visibility
 * predicate, and comments are included only when they are directly anchored to one of those
 * visible tasks. The remaining work-layer tables deliberately remain empty: their current
 * schemas do not provide a trustworthy task association, so treating organization membership as
 * permission to export them could disclose a private project, update, label, or saved view.
 * `update` is specifically project/program/initiative-scoped rather than task-scoped.
 *
 * @param orgId - The organization whose visible work layer is being collected.
 * @param actorId - The active human actor receiving the personal export.
 * @param db - The database client (defaults to the shared singleton).
 * @returns visible tasks and task comments plus the ids needed to screen personal task pointers.
 */
export async function collectVisibleWorkLayerForActor(
  orgId: string,
  actorId: string,
  db: Database = defaultDb,
): Promise<VisibleWorkLayer> {
  const [canViewTask, activeTasks] = await Promise.all([
    buildTaskViewFilter(orgId, actorId),
    db
      .select()
      .from(task)
      .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt))),
  ]);
  const visibleTasks = activeTasks.filter(canViewTask);
  const visibleTaskIds = new Set(visibleTasks.map((row) => row.id));
  const visibleComments =
    visibleTaskIds.size === 0
      ? []
      : await db
          .select()
          .from(comment)
          .where(
            and(
              eq(comment.organizationId, orgId),
              eq(comment.subjectType, 'task'),
              isNull(comment.archivedAt),
              inArray(comment.subjectId, [...visibleTaskIds]),
            ),
          );

  return {
    work: {
      team: [],
      initiative: [],
      program: [],
      project: [],
      milestone: [],
      cycle: [],
      task: visibleTasks,
      label: [],
      comment: visibleComments,
      update: [],
      savedView: [],
    },
    visibleTaskIds,
  };
}
