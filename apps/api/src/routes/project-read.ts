import { actor, db, program, project, team } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { ProjectOut } from '../contracts/project';

import { sourcePersonProjection } from '../lib/identity/source-person-projection';

interface ProjectAggregateRow {
  row: typeof project.$inferSelect;
  programRow: typeof program.$inferSelect | null;
  teamRow: typeof team.$inferSelect | null;
  leadRow: typeof actor.$inferSelect | null;
  sourcePeople: NonNullable<z.input<typeof ProjectOut>['sourcePeople']>;
}

type ProjectRow = typeof project.$inferSelect;

/** Project a native project and its source person evidence into the API representation. */
export function toProjectOut(
  p: ProjectRow,
  sourcePeople?: z.input<typeof ProjectOut>['sourcePeople'],
): z.input<typeof ProjectOut> {
  return {
    id: p.id,
    ...(sourcePeople ? { sourcePeople } : {}),
    organizationId: p.organizationId,
    name: p.name,
    summary: p.summary,
    description: p.description,
    status: p.status,
    priority: p.priority,
    health: p.health,
    leadId: p.leadId,
    teamId: p.teamId,
    programId: p.programId,
    startDate: p.startDate?.toISOString() ?? null,
    startDateResolution: p.startDateResolution,
    startDateFiscalYearStartMonth: p.startDateFiscalYearStartMonth,
    targetDate: p.targetDate?.toISOString() ?? null,
    targetDateResolution: p.targetDateResolution,
    targetDateFiscalYearStartMonth: p.targetDateFiscalYearStartMonth,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Read the current team for label validation without exposing an archived or foreign project. */
export async function projectTeamId(orgId: string, id: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ teamId: project.teamId })
    .from(project)
    .where(and(eq(project.id, id), eq(project.organizationId, orgId), isNull(project.archivedAt)))
    .limit(1);
  return row?.teamId;
}

/** Read a project's named references and source people in one tenant-scoped query. */
export async function loadProjectAggregateRow(
  orgId: string,
  id: string,
): Promise<ProjectAggregateRow | undefined> {
  const [row] = await db
    .select({
      row: project,
      programRow: program,
      teamRow: team,
      leadRow: actor,
      sourcePeople: sourcePersonProjection(project.organizationId, 'project', project.id),
    })
    .from(project)
    .leftJoin(program, and(eq(project.programId, program.id), eq(program.organizationId, orgId)))
    .leftJoin(team, and(eq(project.teamId, team.id), eq(team.organizationId, orgId)))
    .leftJoin(actor, and(eq(project.leadId, actor.id), eq(actor.organizationId, orgId)))
    .where(and(eq(project.id, id), eq(project.organizationId, orgId), isNull(project.archivedAt)))
    .limit(1);
  return row;
}
