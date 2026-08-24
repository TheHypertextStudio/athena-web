import {
  actor,
  db,
  initiative,
  initiativeProgram,
  initiativeProject,
  label,
  program,
  project,
} from '@docket/db';
import type { Health } from '@docket/types';
import type { InitiativeDetail, InitiativeOut } from '@docket/types';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';

/** InitiativeRow is the selected database row shape consumed by these API route serializers. */
export type InitiativeRow = typeof initiative.$inferSelect;
/** ProjectRow is the selected database row shape consumed by these API route serializers. */
export type ProjectRow = typeof project.$inferSelect;
/** ProgramRow is the selected database row shape consumed by these API route serializers. */
export type ProgramRow = typeof program.$inferSelect;

/** Health verdicts ordered worst→best so the roll-up can pick the most severe. */
const HEALTH_SEVERITY: readonly Health[] = ['off_track', 'at_risk', 'on_track'];

/** idParam is the reusable OpenAPI parameter schema for this API route route. */
export const idParam = z.object({ id: z.string() });
/** projectLinkParam is the reusable OpenAPI parameter schema for this API route route. */
export const projectLinkParam = z.object({ id: z.string(), projectId: z.string() });
/** programLinkParam is the reusable OpenAPI parameter schema for this API route route. */
export const programLinkParam = z.object({ id: z.string(), programId: z.string() });
/** hierarchyLinkParam identifies one context-owned Initiative hierarchy edge. */
export const hierarchyLinkParam = z.object({ linkId: z.string() });

/** toOut converts internal API route data into the public API response shape. */
export function toOut(i: InitiativeRow): z.input<typeof InitiativeOut> {
  return {
    id: i.id,
    organizationId: i.organizationId,
    name: i.name,
    summary: i.summary,
    description: i.description,
    ownerId: i.ownerId,
    leadTeamId: i.leadTeamId,
    status: i.status,
    priority: i.priority,
    updateCadence: i.updateCadence,
    targetDate: i.targetDate?.toISOString() ?? null,
    targetDateResolution: i.targetDateResolution,
    targetDateFiscalYearStartMonth: i.targetDateFiscalYearStartMonth,
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

/** Assert every requested Initiative label is organization-global and owned by its workspace. */
export async function assertInitiativeLabels(
  orgId: string,
  labelIds: readonly string[] | undefined,
): Promise<string[]> {
  const uniqueIds = [...new Set(labelIds ?? [])];
  if (uniqueIds.length === 0) return [];
  const rows = await db
    .select({ id: label.id })
    .from(label)
    .where(
      and(eq(label.organizationId, orgId), isNull(label.teamId), inArray(label.id, uniqueIds)),
    );
  if (rows.length !== uniqueIds.length) throw new NotFoundError('Label not found');
  return uniqueIds;
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

/** The bounded child-work rollup used by the local-first Initiative aggregate. */
export interface InitiativeWorkSummary {
  readonly projects: number;
  readonly programs: number;
  readonly onTrack: number;
  readonly atRisk: number;
  readonly offTrack: number;
  readonly unknown: number;
}

/**
 * Count associated work in SQL without returning a child roster.
 *
 * The initial detail route needs only counts and health distribution. Returning every Project and
 * Program made a large Initiative's first paint scale with its entire hierarchy.
 */
export async function associatedWorkSummary(
  orgId: string,
  initiativeId: string,
): Promise<InitiativeWorkSummary> {
  const aggregate = (column: typeof project.health | typeof program.health) => ({
    total: count(),
    onTrack: sql<number>`count(*) filter (where ${column} = 'on_track')`.mapWith(Number),
    atRisk: sql<number>`count(*) filter (where ${column} = 'at_risk')`.mapWith(Number),
    offTrack: sql<number>`count(*) filter (where ${column} = 'off_track')`.mapWith(Number),
    unknown: sql<number>`count(*) filter (where ${column} is null)`.mapWith(Number),
  });
  const [projectRows, programRows] = await Promise.all([
    db
      .select(aggregate(project.health))
      .from(initiativeProject)
      .innerJoin(project, eq(initiativeProject.projectId, project.id))
      .where(
        and(
          eq(initiativeProject.initiativeId, initiativeId),
          eq(initiativeProject.organizationId, orgId),
        ),
      ),
    db
      .select(aggregate(program.health))
      .from(initiativeProgram)
      .innerJoin(program, eq(initiativeProgram.programId, program.id))
      .where(
        and(
          eq(initiativeProgram.initiativeId, initiativeId),
          eq(initiativeProgram.organizationId, orgId),
        ),
      ),
  ]);
  const projectSummary = projectRows[0];
  const programSummary = programRows[0];
  return {
    projects: projectSummary?.total ?? 0,
    programs: programSummary?.total ?? 0,
    onTrack: (projectSummary?.onTrack ?? 0) + (programSummary?.onTrack ?? 0),
    atRisk: (projectSummary?.atRisk ?? 0) + (programSummary?.atRisk ?? 0),
    offTrack: (projectSummary?.offTrack ?? 0) + (programSummary?.offTrack ?? 0),
    unknown: (projectSummary?.unknown ?? 0) + (programSummary?.unknown ?? 0),
  };
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
  if (startEdge === null) return true;
  const start = startEdge.getTime();
  const end = (proj.targetDate ?? startEdge).getTime();
  if (from !== undefined && end < new Date(from).getTime()) return false;
  if (to !== undefined && start > new Date(`${to}T23:59:59.999Z`).getTime()) return false;
  return true;
}

/** Assemble the full {@link InitiativeDetail} DTO from a row + its associated children. */
export function buildInitiativeDetail(
  row: InitiativeRow,
  projects: readonly { readonly health: Health | null }[],
  programs: readonly { readonly health: Health | null }[],
): z.input<typeof InitiativeDetail> {
  const childHealths: (Health | null)[] = [
    ...projects.map((p) => p.health),
    ...programs.map((p) => p.health),
  ];
  return {
    ...toOut(row),
    childMix: { programs: programs.length, projects: projects.length },
    distribution: healthDistribution(childHealths),
    rolledUpHealth: worstHealth(childHealths),
  };
}

/** Build Initiative detail from the bounded SQL summary used during initial reconciliation. */
export function buildInitiativeDetailFromSummary(
  row: InitiativeRow,
  summary: InitiativeWorkSummary,
): z.input<typeof InitiativeDetail> {
  const rolledUpHealth =
    summary.offTrack > 0
      ? 'off_track'
      : summary.atRisk > 0
        ? 'at_risk'
        : summary.onTrack > 0
          ? 'on_track'
          : null;
  return {
    ...toOut(row),
    childMix: { programs: summary.programs, projects: summary.projects },
    distribution: {
      onTrack: summary.onTrack,
      atRisk: summary.atRisk,
      offTrack: summary.offTrack,
      unknown: summary.unknown,
    },
    rolledUpHealth,
  };
}
