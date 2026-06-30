/**
 * `@docket/api` — the org work-layer export collector.
 *
 * @remarks
 * Snapshots every org-scoped work-layer table for one organization into a flat
 * `tableName → rows[]` map, strictly filtered by `organization_id` so no cross-org rows
 * can leak. Shared by the org-facing export (`POST /orgs/:orgId/billing/export`) and the
 * account-level personal-data export (which snapshots one such layer per org the user
 * belongs to).
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
import { eq } from 'drizzle-orm';

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
