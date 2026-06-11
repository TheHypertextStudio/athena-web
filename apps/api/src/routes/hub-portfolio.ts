import {
  db,
  initiativeProgram,
  initiativeProject,
  milestone,
  organization,
  program,
  project,
} from '@docket/db';
import type { HubProgramLane, HubProjectBar } from '@docket/types';
import type { HubPortfolioOut } from '@docket/types';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { z } from 'zod';

import {
  IN_FLIGHT_PROJECT_STATES,
  type MilestoneRow,
  type ProjectRow,
  callerOrgIds,
  groupBy,
  toMilestoneItem,
  toOrgChip,
} from './hub-helpers';

/**
 * Build the hub portfolio payload (without the HTTP envelope).
 * The route handler calls `ok(c, HubPortfolioOut, ...)` inline to preserve Hono's RPC types.
 */
export async function buildHubPortfolioPayload(
  userId: string,
  from: string | undefined,
  to: string | undefined,
  initiativeId: string | undefined,
): Promise<z.input<typeof HubPortfolioOut>> {
  const orgIds = await callerOrgIds(userId);
  if (orgIds.length === 0) return { swimlanes: [] };

  let initiativeProjectIds: Set<string> | undefined;
  let initiativeProgramIds: Set<string> | undefined;
  if (initiativeId !== undefined) {
    const [projEdges, progEdges] = await Promise.all([
      db
        .select({ projectId: initiativeProject.projectId })
        .from(initiativeProject)
        .where(
          and(
            eq(initiativeProject.initiativeId, initiativeId),
            inArray(initiativeProject.organizationId, orgIds),
          ),
        ),
      db
        .select({ programId: initiativeProgram.programId })
        .from(initiativeProgram)
        .where(
          and(
            eq(initiativeProgram.initiativeId, initiativeId),
            inArray(initiativeProgram.organizationId, orgIds),
          ),
        ),
    ]);
    initiativeProjectIds = new Set(projEdges.map((e) => e.projectId));
    initiativeProgramIds = new Set(progEdges.map((e) => e.programId));
  }

  const orgs = await db
    .select()
    .from(organization)
    .where(inArray(organization.id, orgIds))
    .orderBy(organization.name);

  const allPrograms = await db
    .select()
    .from(program)
    .where(and(inArray(program.organizationId, orgIds), notInArray(program.status, ['archived'])));
  const allProjects = await db
    .select()
    .from(project)
    .where(
      and(
        inArray(project.organizationId, orgIds),
        inArray(project.status, [...IN_FLIGHT_PROJECT_STATES]),
      ),
    );

  const programs = initiativeProgramIds
    ? allPrograms.filter((p) => initiativeProgramIds.has(p.id))
    : allPrograms;
  const projects = initiativeProjectIds
    ? allProjects.filter((p) => initiativeProjectIds.has(p.id))
    : allProjects;

  const inWindow = (p: ProjectRow): boolean => {
    if (from && p.targetDate && p.targetDate < new Date(from)) return false;
    if (to && p.startDate && p.startDate > new Date(to)) return false;
    return true;
  };
  const windowed = projects.filter(inWindow);

  const projectIds = windowed.map((p) => p.id);
  const milestones: MilestoneRow[] =
    projectIds.length > 0
      ? await db.select().from(milestone).where(inArray(milestone.projectId, projectIds))
      : [];
  const milestonesByProject = groupBy(milestones, (m) => m.projectId);

  const toBar = (p: ProjectRow): z.input<typeof HubProjectBar> => ({
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    status: p.status,
    health: p.health,
    startDate: p.startDate?.toISOString() ?? null,
    targetDate: p.targetDate?.toISOString() ?? null,
    milestones: (milestonesByProject.get(p.id) ?? []).map(toMilestoneItem),
  });

  const projectsByOrg = groupBy(windowed, (p) => p.organizationId);
  const programsByOrg = groupBy(programs, (p) => p.organizationId);

  const swimlanes = orgs.map((org) => {
    const orgProjects = projectsByOrg.get(org.id) ?? [];
    const orgPrograms = programsByOrg.get(org.id) ?? [];
    const programScoped = orgProjects.filter(
      (p): p is ProjectRow & { programId: string } => p.programId !== null,
    );
    const projectsByProgram = groupBy(programScoped, (p) => p.programId);
    const lanes: z.input<typeof HubProgramLane>[] = orgPrograms.map((prog) => ({
      program: {
        id: prog.id,
        organizationId: prog.organizationId,
        name: prog.name,
        status: prog.status,
        health: prog.health,
      },
      projects: (projectsByProgram.get(prog.id) ?? []).map(toBar),
    }));
    const unassigned = orgProjects.filter((p) => p.programId === null).map(toBar);
    return { organization: toOrgChip(org), programs: lanes, unassigned };
  });

  return { swimlanes };
}
