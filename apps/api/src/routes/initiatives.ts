/**
 * `@docket/api` — initiatives router (mounted at `/v1/orgs/:orgId/initiatives`).
 *
 * @remarks
 * Initiatives are cross-cutting themes that associate many-to-many with Projects and
 * Programs via org-scoped edges. `view` reads; `contribute` mutates + links; `manage`
 * deletes. Detail and timeline reads derive health/status from associated children.
 */
import {
  db,
  entityDisplay,
  initiative,
  initiativeHierarchyLink,
  initiativeLabel,
  initiativeProgram,
  initiativeProject,
  organization,
  program,
  project,
} from '@docket/db';
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
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import { ok } from '../lib/ok';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

import {
  assertInitiativeLabels,
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
import { emitEvent } from './event-emit';
import initiativeAggregates from './initiative-aggregates';
import initiativeHierarchyRoutes from './initiative-hierarchy-routes';
import { accessibleInitiativeOrganizationIds } from './initiative-hierarchy';
import initiativeResources from './initiative-resources';

/** Initiatives router: org-scoped CRUD + child associations + roadmap roll-up. */
const initiatives = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Initiatives',
      summary: 'List initiatives',
      response: pageOf(InitiativeOut),
      description: `List the organization's initiatives — the cross-cutting themes that span many Programs and Projects (an Initiative contains no work of its own; it associates with work via many-to-many edges). Results are keyset-paginated newest-first, ordered by \`createdAt\` with \`id\` as the tiebreak. The \`limit\` query param is optional: omit it to receive the full list (legacy behavior), or supply it to receive a bounded page plus a \`nextCursor\` for the next page; pass that opaque cursor back as \`cursor\` to continue. Each item is the flat {@link InitiativeOut} (no rolled-up child mix or health) — fetch a single initiative via \`GET /:id\` for the derived roll-up. Reads require only org membership (the implicit \`view\` capability supplied by the org-context middleware); no capability guard gates this route. Scoped strictly to the caller's organization, so initiatives owned by other tenants are never returned.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
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
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Create an initiative',
      capability: 'contribute',
      response: InitiativeOut,
      description: `Create a new initiative (theme) within the organization. The \`organizationId\` is always taken from the path, never the body — initiatives cannot be created cross-tenant. \`status\` defaults to \`active\` when omitted; \`targetDate\` (an ISO date) is parsed to a timestamp; \`ownerId\`, \`description\`, and \`health\` are optional. When \`ownerId\` is supplied it MUST reference an Actor in the caller's org — the bare \`owner_id → actor.id\` foreign key targets the actor's global primary key with no tenant constraint, so the handler re-reads the owner scoped to the org and returns 404 (\`Owner not found\`, existence-hiding) when it belongs to another tenant. Side effect: emits a \`created\` observation whose subject is the new initiative, feeding activity streams and the daily digest. Requires \`contribute\` because creating a theme is structural authoring, not a mere comment. Returns the created {@link InitiativeOut}. See \`POST /:id/projects\` and \`POST /:id/programs\` to associate work afterward.`,
    }),
    zJson(InitiativeCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      await assertOwnerInOrg(orgId, body.ownerId);
      const labelIds = await assertInitiativeLabels(orgId, body.labelIds);
      const row = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(initiative)
          .values({
            organizationId: orgId,
            name: body.name,
            summary: body.summary,
            description: body.description,
            ownerId: body.ownerId,
            status: body.status ?? 'active',
            priority: body.priority ?? 'none',
            updateCadence: body.updateCadence ?? 'monthly',
            targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
            health: body.health,
            createdBy: actorId,
          })
          .returning();
        const created = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert always returns one row */
        if (!created) throw new Error('initiative insert returned no row');
        if (labelIds.length > 0) {
          await tx.insert(initiativeLabel).values(
            labelIds.map((labelId) => ({
              initiativeId: created.id,
              labelId,
              organizationId: orgId,
            })),
          );
        }
        return created;
      });
      await emitEvent({
        organizationId: orgId,
        kind: 'created',
        actorId,
        title: row.name,
        subject: { type: 'initiative', id: row.id, title: row.name },
      });
      await enqueueSearchUpsert(orgId, 'initiative', row.id);
      return ok(c, InitiativeOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Get initiative detail',
      response: InitiativeDetail,
      description: `Fetch a single initiative enriched with the roll-up derived from its directly connected work. The response includes the canonical Initiative status, child mix, health distribution, and connected-work health without overwriting the independently writable Initiative health.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadInitiative(orgId, id);
      const [hierarchyLinks, accessibleIds] = await Promise.all([
        db
          .select()
          .from(initiativeHierarchyLink)
          .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId)),
        accessibleInitiativeOrganizationIds(orgId, c.get('session')),
      ]);
      const childrenByParent = new Map<string, string[]>();
      for (const link of hierarchyLinks) {
        const children = childrenByParent.get(link.parentInitiativeId) ?? [];
        children.push(link.childInitiativeId);
        childrenByParent.set(link.parentInitiativeId, children);
      }
      const rollupIds = [id];
      const visit = (parentId: string): void => {
        for (const childId of childrenByParent.get(parentId) ?? []) {
          if (rollupIds.includes(childId)) continue;
          rollupIds.push(childId);
          visit(childId);
        }
      };
      visit(id);
      const initiativeRows = await db
        .select({ id: initiative.id, organizationId: initiative.organizationId })
        .from(initiative)
        .where(inArray(initiative.id, rollupIds));
      const visibleNodes = initiativeRows.filter((row) => accessibleIds.has(row.organizationId));
      const associated = await Promise.all(
        visibleNodes.map(async (node) => ({
          projects: await associatedProjects(node.organizationId, node.id),
          programs: await associatedPrograms(node.organizationId, node.id),
        })),
      );
      const projects = [
        ...new Map(
          associated.flatMap((entry) => entry.projects).map((row) => [row.id, row]),
        ).values(),
      ];
      const programs = [
        ...new Map(
          associated.flatMap((entry) => entry.programs).map((row) => [row.id, row]),
        ).values(),
      ];
      return ok(c, InitiativeDetail, buildInitiativeDetail(row, projects, programs));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Update an initiative',
      capability: 'contribute',
      response: InitiativeOut,
      description: `Partially update an Initiative's stored properties. Health and status writes emit the corresponding audit observations; connected-work health remains a separate live roll-up.`,
    }),
    zParam(idParam),
    zJson(InitiativeUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await assertOwnerInOrg(orgId, body.ownerId);
      const labelIds = await assertInitiativeLabels(orgId, body.labelIds);
      const row = await db.transaction(async (tx) => {
        const values: Partial<typeof initiative.$inferInsert> = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...clearableTextPatch('summary', body.summary),
          ...clearableTextPatch('description', body.description),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.updateCadence !== undefined ? { updateCadence: body.updateCadence } : {}),
          ...(body.targetDate !== undefined
            ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
            : {}),
          ...(body.health !== undefined ? { health: body.health } : {}),
        };
        const updated =
          Object.keys(values).length > 0
            ? await tx
                .update(initiative)
                .set(values)
                .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
                .returning()
            : await tx
                .select()
                .from(initiative)
                .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
                .limit(1);
        const changed = updated[0];
        if (!changed) return undefined;
        if (body.labelIds !== undefined) {
          await tx.delete(initiativeLabel).where(eq(initiativeLabel.initiativeId, id));
          if (labelIds.length > 0) {
            await tx
              .insert(initiativeLabel)
              .values(
                labelIds.map((labelId) => ({ initiativeId: id, labelId, organizationId: orgId })),
              );
          }
        }
        return changed;
      });
      if (!row) throw new NotFoundError('Initiative not found');
      if (body.status !== undefined) {
        await emitEvent({
          organizationId: orgId,
          kind: 'status_change',
          actorId,
          title: row.name,
          subject: { type: 'initiative', id: row.id, title: row.name },
          detail: { schema: 'docket.state_change', fromState: null, toState: row.status },
        });
      }
      if (body.health !== undefined) {
        await emitEvent({
          organizationId: orgId,
          kind: 'status_change',
          actorId,
          title: `${row.name} health changed`,
          subject: { type: 'initiative', id: row.id, title: row.name },
          detail: {
            schema: 'docket.state_change',
            fromState: null,
            toState: row.health ?? 'unset',
          },
        });
      }
      await enqueueSearchUpsert(orgId, 'initiative', row.id);
      return ok(c, InitiativeOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Delete an initiative',
      capability: 'manage',
      response: InitiativeOut,
      description: `Permanently delete an initiative. Scoped to the caller's org: 404 (\`Initiative not found\`) when the id is absent or cross-tenant. This removes only the theme itself — the associated \`initiative_project\`/\`initiative_program\` edges are cascaded away by the database, but the Programs and Projects themselves are NOT deleted (an initiative owns no work, so there is nothing to cascade into the work hierarchy). Requires \`manage\` (the highest capability) rather than \`contribute\` because deletion is irreversible structural teardown that affects how the whole portfolio rolls up, so it is restricted to administrators. Returns the deleted {@link InitiativeOut} as a tombstone. To merely retire an initiative without losing it, PATCH its \`status\` to \`completed\` instead.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await db.transaction(async (tx) => {
        const candidates = await tx
          .select()
          .from(initiative)
          .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
          .limit(1)
          .for('update');
        const candidate = candidates[0];
        if (!candidate) return undefined;

        const outgoing = await tx
          .select()
          .from(initiativeHierarchyLink)
          .where(eq(initiativeHierarchyLink.parentInitiativeId, id));
        const contextIds = [...new Set(outgoing.map((edge) => edge.contextOrganizationId))].sort();
        for (const contextId of contextIds) {
          await tx
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.id, contextId))
            .for('update');
          const edges = await tx
            .select()
            .from(initiativeHierarchyLink)
            .where(eq(initiativeHierarchyLink.contextOrganizationId, contextId));
          const directChildren = edges.filter((edge) => edge.parentInitiativeId === id);
          if (directChildren.length === 0) continue;
          const childIds = directChildren.map((edge) => edge.childInitiativeId);
          const childRows = await tx
            .select({ id: initiative.id, organizationId: initiative.organizationId })
            .from(initiative)
            .where(inArray(initiative.id, childIds));
          const childOrganizations = new Map(
            childRows.map((child) => [child.id, child.organizationId]),
          );
          const removedIds = new Set<string>();
          for (const directChild of directChildren) {
            if (childOrganizations.get(directChild.childInitiativeId) === contextId) continue;
            const descendants = new Set([directChild.childInitiativeId]);
            let changed = true;
            while (changed) {
              changed = false;
              for (const edge of edges) {
                if (
                  descendants.has(edge.parentInitiativeId) &&
                  !descendants.has(edge.childInitiativeId)
                ) {
                  descendants.add(edge.childInitiativeId);
                  changed = true;
                }
              }
            }
            removedIds.add(directChild.id);
            for (const edge of edges) {
              if (descendants.has(edge.parentInitiativeId)) removedIds.add(edge.id);
            }
          }
          if (removedIds.size > 0) {
            await tx
              .delete(initiativeHierarchyLink)
              .where(inArray(initiativeHierarchyLink.id, [...removedIds]));
          }
        }

        await tx
          .delete(entityDisplay)
          .where(
            and(
              eq(entityDisplay.organizationId, orgId),
              eq(entityDisplay.subjectType, 'initiative'),
              eq(entityDisplay.subjectId, id),
            ),
          );
        const deleted = await tx.delete(initiative).where(eq(initiative.id, id)).returning();
        return deleted[0];
      });
      if (!row) throw new NotFoundError('Initiative not found');
      await enqueueSearchDelete(orgId, 'initiative', row.id);
      return ok(c, InitiativeOut, toOut(row));
    },
  )
  .post(
    '/:id/projects',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Link a project to an initiative',
      capability: 'contribute',
      response: InitiativeProjectLinked,
      description: `Associate a Project with this Initiative. The Project contributes to connected-work roll-ups and the Initiative timeline while the Initiative's own status and health remain independent.`,
    }),
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
    apiDoc({
      tag: 'Initiatives',
      summary: 'Unlink a project from an initiative',
      capability: 'contribute',
      response: InitiativeUnlinked,
      description: `Remove the \`initiative_project\` edge between this initiative and the named Project. The initiative is first confirmed to live in the caller's org (404 \`Initiative not found\`); the join row is then deleted scoped to the initiative, project, and org. 404 (\`Project link not found\`) when no such edge exists. Deletes only the association — the Project itself is untouched and remains in the org. Side effect: the Project stops contributing to this initiative's derived roll-up and timeline. Requires \`contribute\`. Returns {@link InitiativeUnlinked} \`{ unlinked: true }\`.`,
    }),
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
    apiDoc({
      tag: 'Initiatives',
      summary: 'Link a program to an initiative',
      capability: 'contribute',
      response: InitiativeProgramLinked,
      description: `Associate a Program with this Initiative. The Program contributes to connected-work roll-ups and the Initiative timeline while the Initiative's own status and health remain independent.`,
    }),
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
    apiDoc({
      tag: 'Initiatives',
      summary: 'Unlink a program from an initiative',
      capability: 'contribute',
      response: InitiativeUnlinked,
      description: `Remove the \`initiative_program\` edge between this initiative and the named Program. The initiative is confirmed in the caller's org (404 \`Initiative not found\`); the join row is then deleted scoped to initiative, program, and org. 404 (\`Program link not found\`) when no such edge exists. Deletes only the association — the Program is untouched. Side effect: the Program drops off this initiative's timeline lanes and its health stops feeding the roll-up. Requires \`contribute\`. Returns {@link InitiativeUnlinked} \`{ unlinked: true }\`.`,
    }),
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
  .get(
    '/:id/timeline',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Get initiative timeline',
      response: InitiativeTimelineOut,
      description: `The roadmap-first roll-up for an initiative: its associated Programs returned as ongoing, undated lanes and its associated Projects returned as dated bars (each with current \`status\`/\`health\` and ISO \`startDate\`/\`targetDate\`, either of which may be null when unscheduled). The optional \`from\`/\`to\` query bounds (ISO dates, either side open) filter ONLY the Project bars to those overlapping the window — a Project overlaps when it has no dates at all (unscheduled projects always remain visible) or its \`[startDate, targetDate]\` intersects \`[from, to]\`. Program lanes are always returned in full, since they are ongoing and carry no end date. The initiative must exist in the caller's org (404 \`Initiative not found\`). Read-only; org membership suffices. Returns {@link InitiativeTimelineOut}. See \`GET /:id\` for the numeric health/status roll-up over the same children.`,
    }),
    zParam(idParam),
    zQuery(InitiativeTimelineQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { from, to } = c.req.valid('query');
      await loadInitiative(orgId, id);

      const [links, accessibleOrganizationIds] = await Promise.all([
        db
          .select()
          .from(initiativeHierarchyLink)
          .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId)),
        accessibleInitiativeOrganizationIds(orgId, c.get('session')),
      ]);
      const linkedIds = [
        ...new Set(links.flatMap((link) => [link.parentInitiativeId, link.childInitiativeId])),
      ];
      const linkedInitiatives =
        linkedIds.length === 0
          ? []
          : await db
              .select({ id: initiative.id, organizationId: initiative.organizationId })
              .from(initiative)
              .where(inArray(initiative.id, linkedIds));
      const visibleIds = new Set(
        linkedInitiatives
          .filter((row) => accessibleOrganizationIds.has(row.organizationId))
          .map((row) => row.id),
      );
      visibleIds.add(id);
      const childrenByParent = new Map<string, string[]>();
      for (const link of links) {
        if (!visibleIds.has(link.parentInitiativeId) || !visibleIds.has(link.childInitiativeId)) {
          continue;
        }
        const children = childrenByParent.get(link.parentInitiativeId) ?? [];
        children.push(link.childInitiativeId);
        childrenByParent.set(link.parentInitiativeId, children);
      }
      const rollupIds = [id];
      for (const parentId of rollupIds) {
        for (const childId of childrenByParent.get(parentId) ?? []) {
          if (!rollupIds.includes(childId)) rollupIds.push(childId);
        }
      }
      const [projectRows, programRows] = await Promise.all([
        db
          .select({ row: project })
          .from(initiativeProject)
          .innerJoin(project, eq(project.id, initiativeProject.projectId))
          .where(inArray(initiativeProject.initiativeId, rollupIds)),
        db
          .select({ row: program })
          .from(initiativeProgram)
          .innerJoin(program, eq(program.id, initiativeProgram.programId))
          .where(inArray(initiativeProgram.initiativeId, rollupIds)),
      ]);
      const projects = [
        ...new Map(
          projectRows
            .filter(({ row }) => accessibleOrganizationIds.has(row.organizationId))
            .map(({ row }) => [row.id, row]),
        ).values(),
      ];
      const programs = [
        ...new Map(
          programRows
            .filter(({ row }) => accessibleOrganizationIds.has(row.organizationId))
            .map(({ row }) => [row.id, row]),
        ).values(),
      ];

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
    },
  );

export default new Hono<AppEnv>()
  .route('/', initiativeAggregates)
  .route('/', initiativeHierarchyRoutes)
  .route('/', initiativeResources)
  .route('/', initiatives);
