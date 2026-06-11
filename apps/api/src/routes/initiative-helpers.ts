import {
  actor,
  db,
  initiative,
  initiativeProgram,
  initiativeProject,
  program,
  project,
} from '@docket/db';
import type { Health } from '@docket/types';
import type { InitiativeDetail, InitiativeOut } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';

export type InitiativeRow = typeof initiative.$inferSelect;
export type ProjectRow = typeof project.$inferSelect;
export type ProgramRow = typeof program.$inferSelect;

export const TERMINAL_PROJECT_STATUSES = new Set(['completed', 'canceled']);

/** Health verdicts ordered worst→best so the roll-up can pick the most severe. */
const HEALTH_SEVERITY: readonly Health[] = ['off_track', 'at_risk', 'on_track'];

export const idParam = z.object({ id: z.string() });
export const projectLinkParam = z.object({ id: z.string(), projectId: z.string() });
export const programLinkParam = z.object({ id: z.string(), programId: z.string() });

export function toOut(i: InitiativeRow): z.input<typeof InitiativeOut> {
  return {
    id: i.id,
    organizationId: i.organizationId,
    name: i.name,
    description: i.description,
    ownerId: i.ownerId,
    status: i.status,
    targetDate: i.targetDate?.toISOString() ?? null,
    health: i.health,
    createdAt: i.createdAt.toISOString(),
  };
}

/** Load a single Initiative scoped to the org, or throw {@link NotFoundError}. */
export async function loadInitiative(orgId: string, id: string): Promise<InitiativeRow> {
  const rows = await db
    .select()
    .from(initiative)
    .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Initiative not found');
  return row;
}

/**
 * Assert a body-provided `ownerId` references an Actor in the caller's org, or 404.
 *
 * @remarks
 * `initiative.owner_id → actor.id` is a bare FK against the actor's global PK with no
 * `organization_id` constraint baked in. Without this check, a CREATE/PATCH could attach
 * another tenant's actor as the initiative owner. A `null`/`undefined` `ownerId` is a no-op.
 *
 * @throws {NotFoundError} When the owner is missing or owned by another org.
 */
export async function assertOwnerInOrg(
  orgId: string,
  ownerId: string | null | undefined,
): Promise<void> {
  if (ownerId === null || ownerId === undefined) return;
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(and(eq(actor.id, ownerId), eq(actor.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Owner not found');
}

function worstHealth(healths: readonly (Health | null)[]): Health | null {
  for (const candidate of HEALTH_SEVERITY) {
    if (healths.includes(candidate)) return candidate;
  }
  return null;
}

function healthDistribution(
  healths: readonly (Health | null)[],
): z.input<typeof InitiativeDetail.shape.distribution> {
  return {
    onTrack: healths.filter((h) => h === 'on_track').length,
    atRisk: healths.filter((h) => h === 'at_risk').length,
    offTrack: healths.filter((h) => h === 'off_track').length,
    unknown: healths.filter((h) => h === null).length,
  };
}

/** Load every Project associated with an Initiative (org-scoped via the join row). */
export async function associatedProjects(
  orgId: string,
  initiativeId: string,
): Promise<ProjectRow[]> {
  return db
    .select({ p: project })
    .from(initiativeProject)
    .innerJoin(project, eq(initiativeProject.projectId, project.id))
    .where(
      and(
        eq(initiativeProject.initiativeId, initiativeId),
        eq(initiativeProject.organizationId, orgId),
      ),
    )
    .then((rows) => rows.map((r) => r.p));
}

/** Load every Program associated with an Initiative (org-scoped via the join row). */
export async function associatedPrograms(
  orgId: string,
  initiativeId: string,
): Promise<ProgramRow[]> {
  return db
    .select({ p: program })
    .from(initiativeProgram)
    .innerJoin(program, eq(initiativeProgram.programId, program.id))
    .where(
      and(
        eq(initiativeProgram.initiativeId, initiativeId),
        eq(initiativeProgram.organizationId, orgId),
      ),
    )
    .then((rows) => rows.map((r) => r.p));
}

/**
 * Whether a dated Project overlaps a `[from, to]` window.
 *
 * @remarks
 * A Project with no dates always overlaps (unscheduled, must remain visible). Either
 * bound of the window may be open (`undefined`).
 *
 * @returns true when the Project should appear in the windowed timeline.
 */
export function projectOverlapsWindow(proj: ProjectRow, from?: string, to?: string): boolean {
  if (from === undefined && to === undefined) return true;
  const startEdge = proj.startDate ?? proj.targetDate;
  const endEdge = proj.targetDate ?? proj.startDate;
  if (startEdge === null || endEdge === null) return true;
  const start = startEdge.getTime();
  const end = endEdge.getTime();
  if (from !== undefined && end < new Date(from).getTime()) return false;
  if (to !== undefined && start > new Date(`${to}T23:59:59.999Z`).getTime()) return false;
  return true;
}

/** Assemble the full {@link InitiativeDetail} DTO from a row + its associated children. */
export function buildInitiativeDetail(
  row: InitiativeRow,
  projects: ProjectRow[],
  programs: ProgramRow[],
): z.input<typeof InitiativeDetail> {
  const childHealths: (Health | null)[] = [
    ...projects.map((p) => p.health),
    ...programs.map((p) => p.health),
  ];
  const childCount = projects.length + programs.length;
  const allProjectsTerminal =
    projects.length > 0 && projects.every((p) => TERMINAL_PROJECT_STATUSES.has(p.status));
  return {
    ...toOut(row),
    childMix: { programs: programs.length, projects: projects.length },
    distribution: healthDistribution(childHealths),
    rolledUpHealth: worstHealth(childHealths),
    derivedStatus: childCount > 0 && allProjectsTerminal ? 'completed' : 'active',
  };
}
