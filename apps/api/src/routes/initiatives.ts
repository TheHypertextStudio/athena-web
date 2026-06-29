/**
 * `@docket/api` — initiatives router (mounted at `/v1/orgs/:orgId/initiatives`).
 *
 * @remarks
 * Initiatives are cross-cutting themes that associate many-to-many with Projects and
 * Programs via org-scoped edges. `view` reads; `contribute` mutates + links; `manage`
 * deletes. Detail and timeline reads derive health/status from associated children.
 */
import { db, initiative, initiativeProgram, initiativeProject, program, project } from '@docket/db';
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
  CursorQuery,
  pageOf,
} from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

import {
  assertOwnerInOrg,
  associatedPrograms,
  associatedProjects,
  buildInitiativeDetail,
  idParam,
  loadInitiative,
  programLinkParam,
  projectLinkParam,
  projectOverlapsWindow,
  toOut,
} from './initiative-helpers';

/** Initiatives router: org-scoped CRUD + child associations + roadmap roll-up. */
const initiatives = new Hono<AppEnv>()
  .get('/', zQuery(CursorQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { cursor, limit } = c.req.valid('query');
    // Keyset-paginate newest-first (createdAt, id tiebreak). `limit` is optional: omitted returns
    // the full list as before; supplied returns a bounded page + `nextCursor`.
    const base = db
      .select()
      .from(initiative)
      .where(
        and(
          eq(initiative.organizationId, orgId),
          seekAfter(initiative.createdAt, initiative.id, cursor),
        ),
      )
      .orderBy(desc(initiative.createdAt), desc(initiative.id));
    const rows = await (limit === undefined ? base : base.limit(limit + 1));
    const { items, nextCursor } = pageResult(rows, limit, (r) => r.createdAt);
    return ok(c, pageOf(InitiativeOut), { items: items.map(toOut), nextCursor });
  })
  .post('/', capabilityGuard('contribute'), zJson(InitiativeCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');
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
    const projects = await associatedProjects(orgId, id);
    const programs = await associatedPrograms(orgId, id);
    return ok(c, InitiativeDetail, buildInitiativeDetail(row, projects, programs));
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
      programs: programs.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        health: p.health,
      })),
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
