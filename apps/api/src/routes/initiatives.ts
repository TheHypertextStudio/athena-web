/**
 * `@docket/api` — initiatives router (mounted at `/v1/orgs/:orgId/initiatives`).
 *
 * @remarks
 * Initiatives are cross-cutting themes that contain **no work themselves** (data-model
 * §4.1): they associate many-to-many with Projects (`initiative_project`) and Programs
 * (`initiative_program`). Every read therefore enriches the stored row with a roll-up
 * derived purely from its children — `childMix` (counts), a per-health-bucket
 * `distribution`, a `rolledUpHealth` (worst child verdict), and a `derivedStatus`
 * (`completed` iff every associated Project is terminal). Authorization is org-scoped
 * (permissions §6.3: an Initiative is an `organization`-scoped object — `view` to read,
 * `contribute` to link/patch, `manage` to delete); association edges never cascade
 * permission. Every query is scoped by `actorCtx.orgId`.
 */
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
import {
  InitiativeCreate,
  InitiativeDetail,
  InitiativeOut,
  InitiativeProgramLink,
  InitiativeProgramLinked,
  InitiativeProjectLink,
  InitiativeProjectLinked,
  InitiativeTimelineOut,
  InitiativeTimelineQuery,
  InitiativeUnlinked,
  InitiativeUpdate,
  pageOf,
} from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type InitiativeRow = typeof initiative.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type ProgramRow = typeof program.$inferSelect;

/** Project statuses that count as terminal for the `derivedStatus` roll-up. */
const TERMINAL_PROJECT_STATUSES = new Set(['completed', 'canceled']);

/** Health verdicts ordered worst→best so the roll-up can pick the most severe. */
const HEALTH_SEVERITY: readonly Health[] = ['off_track', 'at_risk', 'on_track'];

function toOut(i: InitiativeRow): z.input<typeof InitiativeOut> {
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

const idParam = z.object({ id: z.string() });
const projectLinkParam = z.object({ id: z.string(), projectId: z.string() });
const programLinkParam = z.object({ id: z.string(), programId: z.string() });

/** Load a single Initiative scoped to the org, or throw {@link NotFoundError}. */
async function loadInitiative(orgId: string, id: string): Promise<InitiativeRow> {
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
 * `initiative.owner_id → actor.id` is a bare FK against the actor's *global* PK with no
 * `organization_id` constraint baked in (data-model §0.2: tenant isolation lives in the
 * data-access layer, never the bare FK), so the database alone would accept an `ownerId`
 * pointing at another tenant's actor. This is the same FK-class hardening `POST`/`PATCH`
 * on tasks and projects already apply: before writing the reference we re-read the actor
 * scoped by `eq(actor.organizationId, orgId)` and 404 (existence-hiding) when it is absent.
 * A `null`/`undefined` `ownerId` is a no-op (clearing or leaving the owner untouched).
 *
 * @param orgId - The tenant the owner must belong to.
 * @param ownerId - The candidate owner actor id (a no-op when `null`/`undefined`).
 * @throws {NotFoundError} When the owner is missing or owned by another org.
 */
async function assertOwnerInOrg(orgId: string, ownerId: string | null | undefined): Promise<void> {
  if (ownerId === null || ownerId === undefined) return;
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(and(eq(actor.id, ownerId), eq(actor.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Owner not found');
}

/**
 * Reduce a set of child health verdicts to the single worst one (severity order
 * `off_track ≻ at_risk ≻ on_track`), or `null` when no child carries a verdict.
 *
 * @param healths - The (possibly null) health values of the associated children.
 * @returns the most severe non-null health, or null when all are unset.
 */
function worstHealth(healths: readonly (Health | null)[]): Health | null {
  for (const candidate of HEALTH_SEVERITY) {
    if (healths.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the per-health-bucket distribution across a set of children.
 *
 * @param healths - The (possibly null) health values of the associated children.
 * @returns the counts per `Health` bucket plus an `unknown` count for null verdicts.
 */
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
async function associatedProjects(orgId: string, initiativeId: string): Promise<ProjectRow[]> {
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
async function associatedPrograms(orgId: string, initiativeId: string): Promise<ProgramRow[]> {
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
 * Whether a dated Project overlaps a `[from, to]` window. A Project with no dates always
 * overlaps (it is unscheduled and must remain visible); otherwise its `[startDate,
 * targetDate]` interval must intersect the window. Either bound of the window may be open.
 *
 * @param proj - The candidate Project.
 * @param from - The window lower bound (ISO date), or undefined for open-start.
 * @param to - The window upper bound (ISO date), or undefined for open-end.
 * @returns true when the Project should appear in the windowed timeline.
 */
function projectOverlapsWindow(proj: ProjectRow, from?: string, to?: string): boolean {
  if (from === undefined && to === undefined) return true;
  // Treat a missing endpoint as the same instant as the present one (a point interval);
  // a fully undated Project (both null) always overlaps and stays visible.
  const startEdge = proj.startDate ?? proj.targetDate;
  const endEdge = proj.targetDate ?? proj.startDate;
  if (startEdge === null || endEdge === null) return true;
  const start = startEdge.getTime();
  const end = endEdge.getTime();
  if (from !== undefined && end < new Date(from).getTime()) return false;
  if (to !== undefined && start > new Date(`${to}T23:59:59.999Z`).getTime()) return false;
  return true;
}

/**
 * Initiatives router: org-scoped CRUD + child associations + roadmap roll-up.
 *
 * @remarks
 * `view` reads; `contribute` mutates the Initiative + its association edges; `manage`
 * deletes. The detail/timeline reads derive their status/health from the associated
 * children rather than trusting the stored columns.
 */
const initiatives = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(initiative)
      .where(eq(initiative.organizationId, orgId))
      .orderBy(desc(initiative.createdAt));
    return ok(c, pageOf(InitiativeOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('contribute'), zJson(InitiativeCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    // Tenant isolation: a body-provided owner must be an actor in the caller's org. The
    // bare FK references the actor's global PK, so without this a CREATE could attach
    // another tenant's actor as the initiative owner.
    await assertOwnerInOrg(orgId, body.ownerId);

    const inserted = await db
      .insert(initiative)
      .values({
        organizationId: orgId,
        name: body.name,
        description: body.description,
        ownerId: body.ownerId,
        status: body.status ?? 'active',
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
        health: body.health,
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('initiative insert returned no row');
    return ok(c, InitiativeOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadInitiative(orgId, id);

    // The roll-up is derived purely from the associated children (an Initiative holds no
    // work of its own): health/distribution span both Projects and Programs, while the
    // derived status keys off Project terminality (Programs are ongoing — no end state).
    const projects = await associatedProjects(orgId, id);
    const programs = await associatedPrograms(orgId, id);
    const childHealths: (Health | null)[] = [
      ...projects.map((p) => p.health),
      ...programs.map((p) => p.health),
    ];

    const childCount = projects.length + programs.length;
    const allProjectsTerminal =
      projects.length > 0 && projects.every((p) => TERMINAL_PROJECT_STATUSES.has(p.status));

    const detail: z.input<typeof InitiativeDetail> = {
      ...toOut(row),
      childMix: { programs: programs.length, projects: projects.length },
      distribution: healthDistribution(childHealths),
      rolledUpHealth: worstHealth(childHealths),
      derivedStatus: childCount > 0 && allProjectsTerminal ? 'completed' : 'active',
    };
    return ok(c, InitiativeDetail, detail);
  })
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(InitiativeUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // Tenant isolation: a re-pointed owner must be an actor in the caller's org. The
      // bare FK references the actor's global PK, so without this a PATCH could attach
      // another tenant's actor as the initiative owner. Omitting `ownerId` is a no-op.
      await assertOwnerInOrg(orgId, body.ownerId);

      const updated = await db
        .update(initiative)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.targetDate !== undefined
            ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
            : {}),
          ...(body.health !== undefined ? { health: body.health } : {}),
        })
        .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Initiative not found');
      return ok(c, InitiativeOut, toOut(row));
    },
  )
  .delete('/:id', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(initiative)
      .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Initiative not found');
    return ok(c, InitiativeOut, toOut(row));
  })
  .post(
    '/:id/projects',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(InitiativeProjectLink),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { projectId } = c.req.valid('json');

      // Both endpoints must exist in this org (tenant isolation + existence-hiding).
      await loadInitiative(orgId, id);
      const proj = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, projectId), eq(project.organizationId, orgId)))
        .limit(1);
      if (!proj[0]) throw new NotFoundError('Project not found');

      const existing = await db
        .select()
        .from(initiativeProject)
        .where(
          and(
            eq(initiativeProject.initiativeId, id),
            eq(initiativeProject.projectId, projectId),
            eq(initiativeProject.organizationId, orgId),
          ),
        )
        .limit(1);
      if (existing[0]) throw new ConflictError('Project already linked to this initiative');

      await db
        .insert(initiativeProject)
        .values({ initiativeId: id, projectId, organizationId: orgId });
      return ok(c, InitiativeProjectLinked, { initiativeId: id, projectId, linked: true });
    },
  )
  .delete(
    '/:id/projects/:projectId',
    capabilityGuard('contribute'),
    zParam(projectLinkParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, projectId } = c.req.valid('param');
      await loadInitiative(orgId, id);

      const deleted = await db
        .delete(initiativeProject)
        .where(
          and(
            eq(initiativeProject.initiativeId, id),
            eq(initiativeProject.projectId, projectId),
            eq(initiativeProject.organizationId, orgId),
          ),
        )
        .returning();
      if (!deleted[0]) throw new NotFoundError('Project link not found');
      return ok(c, InitiativeUnlinked, { unlinked: true });
    },
  )
  .post(
    '/:id/programs',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(InitiativeProgramLink),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { programId } = c.req.valid('json');

      await loadInitiative(orgId, id);
      const prog = await db
        .select({ id: program.id })
        .from(program)
        .where(and(eq(program.id, programId), eq(program.organizationId, orgId)))
        .limit(1);
      if (!prog[0]) throw new NotFoundError('Program not found');

      const existing = await db
        .select()
        .from(initiativeProgram)
        .where(
          and(
            eq(initiativeProgram.initiativeId, id),
            eq(initiativeProgram.programId, programId),
            eq(initiativeProgram.organizationId, orgId),
          ),
        )
        .limit(1);
      if (existing[0]) throw new ConflictError('Program already linked to this initiative');

      await db
        .insert(initiativeProgram)
        .values({ initiativeId: id, programId, organizationId: orgId });
      return ok(c, InitiativeProgramLinked, { initiativeId: id, programId, linked: true });
    },
  )
  .delete(
    '/:id/programs/:programId',
    capabilityGuard('contribute'),
    zParam(programLinkParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, programId } = c.req.valid('param');
      await loadInitiative(orgId, id);

      const deleted = await db
        .delete(initiativeProgram)
        .where(
          and(
            eq(initiativeProgram.initiativeId, id),
            eq(initiativeProgram.programId, programId),
            eq(initiativeProgram.organizationId, orgId),
          ),
        )
        .returning();
      if (!deleted[0]) throw new NotFoundError('Program link not found');
      return ok(c, InitiativeUnlinked, { unlinked: true });
    },
  )
  .get('/:id/timeline', zParam(idParam), zQuery(InitiativeTimelineQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('query');
    await loadInitiative(orgId, id);

    const projects = await associatedProjects(orgId, id);
    const programs = await associatedPrograms(orgId, id);

    const payload: z.input<typeof InitiativeTimelineOut> = {
      // Programs are ongoing/undated lanes — always returned regardless of the window.
      programs: programs.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        health: p.health,
      })),
      // Project bars are filtered to those overlapping the requested window.
      projects: projects
        .filter((p) => projectOverlapsWindow(p, from, to))
        .map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          health: p.health,
          startDate: p.startDate?.toISOString() ?? null,
          targetDate: p.targetDate?.toISOString() ?? null,
        })),
    };
    return ok(c, InitiativeTimelineOut, payload);
  });

export default initiatives;
