import { readBlueprintWork } from '../lib/work-template-blueprints/snapshot-rows';
import {
  workspacePlanningCalendar,
  workspaceTargetDatePatch,
} from '../lib/workspace-planning-calendar';
import {
  prepareBlueprintReflow,
  applyBlueprintReflow,
  finishBlueprintReflow,
} from '../lib/work-template-blueprints/reflow';
import { explicitBlueprintDatePatch } from '../lib/work-template-blueprints/date-ownership';
import { serializableTx } from '../lib/serializable-tx';
import { originFor } from '../lib/provenance/context';
import { removeWorkResources } from '../content/resource-removal';
import { createWork } from '../lib/work-creation/service';

import { workTemplateAssignmentRoutes } from './work-template-assignment';
import { workTemplateCaptureRoutes } from './work-template-capture';

/** Initiative routes mounted under an organization. */
import {
  db,
  entityDisplay,
  initiative,
  initiativeHierarchyLink,
  initiativeProgram,
  initiativeProject,
  organization,
  program,
  project,
  team,
} from '@docket/db';
import {
  InitiativeCreate,
  InitiativeDetail,
  InitiativeLabelLink,
  InitiativeLabelLinked,
  InitiativeOut,
  InitiativeProgramLink,
  InitiativeProgramLinked,
  InitiativeProjectLink,
  InitiativeProjectLinked,
  InitiativeTimelineOut,
  InitiativeTimelineQuery,
  InitiativeUnlinked,
  InitiativeUpdate,
} from '@docket/work/initiative-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import {
  attachLabels,
  labelsForSubject,
  replaceLabels,
  resolveAttachedLabels,
  resolveLabelSet,
} from '../lib/labels';
import { created, ok } from '../lib/ok';
import { resolveContainerStatus } from '../lib/work-status';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { resourceAccessKey } from '../permissions/resource-access';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

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
import { emitEvent } from './event-emit';
import initiativeAggregates from './initiative-aggregates';
import initiativeHierarchyRoutes from './initiative-hierarchy-routes';
import {
  accessibleInitiativeHierarchyProjection,
  accessibleInitiativeNodeIds,
  loadAccessibleInitiativeHierarchyGraph,
} from './initiative-hierarchy';
import initiativeResources from './initiative-resources';
import { accessibleInitiativeWorkKeys } from './initiative-work-access';
import {
  recordLabelUpdate,
  recordLink,
  recordRemoval,
  recordUpdate,
} from './container-change-sets';

/** Initiatives router: org-scoped CRUD + child associations + roadmap roll-up. */
const initiatives = new Hono<AppEnv>()
  .route('/', workTemplateAssignmentRoutes('initiative'))
  .route('/', workTemplateCaptureRoutes('initiative'))
  .get(
    '/',
    apiDoc({
      tag: 'Initiatives',
      summary: 'List initiatives',
      response: pageOf(InitiativeOut),
      description: `List the organization's initiatives, newest first. An initiative is a theme that groups programs and projects; it does not contain tasks directly. Pages default to 50 items and accept at most 100. Copy \`nextCursor\` unchanged into \`cursor\`, and omit the cursor after the final page. Each item contains the initiative itself. Use \`GET /:id\` for its project and program roll-up. Organization membership is required.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await db
        .select()
        .from(initiative)
        .where(
          and(
            eq(initiative.organizationId, orgId),
            seekAfter(initiative.createdAt, initiative.id, cursor),
          ),
        )
        .orderBy(desc(initiative.createdAt), desc(initiative.id))
        .limit(limit + 1);
      const { items, nextCursor } = pageResult(rows, limit, (r) => r.createdAt);
      return ok(c, pageOf(InitiativeOut), { items: items.map(toOut), nextCursor });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Initiatives',
      summary: 'Create an initiative',
      capability: 'contribute',
      response: InitiativeOut,
      description: `Create an initiative in the organization. \`status\` defaults to \`active\`. \`targetDate\` uses an ISO date, and \`ownerId\` must identify an organization member. Docket records the creation in activity and includes it in relevant digests. Requires the \`contribute\` capability and returns the created {@link InitiativeOut}. Use the initiative project and program endpoints to associate work afterward.`,
    }),
    zJson(InitiativeCreate),
    async (c) => {
      const caller = c.get('actorCtx');
      const result = await createWork({
        caller,
        kind: 'initiative',
        body: c.req.valid('json'),
        invocation: { origin: originFor('initiative_create') },
      });
      if (result.root.kind !== 'initiative')
        throw new Error('Work creation returned the wrong kind');
      return created(c, InitiativeOut, toOut(result.root.row));
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
      const graph = await loadAccessibleInitiativeHierarchyGraph(orgId, [id], c.get('session'));
      const childrenByParent = new Map<string, string[]>();
      for (const link of graph.projection.links) {
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
      if (!graph.projection.nodeIds.has(id)) throw new NotFoundError('Initiative not found');
      const rollupIdSet = new Set(rollupIds);
      const visibleNodes = graph.nodes.filter(
        (node) => graph.projection.nodeIds.has(node.id) && rollupIdSet.has(node.id),
      );
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
      const accessibleWorkKeys = await accessibleInitiativeWorkKeys(
        c.get('session'),
        projects,
        programs,
      );
      return ok(
        c,
        InitiativeDetail,
        buildInitiativeDetail(
          row,
          projects.filter((projectRow) =>
            accessibleWorkKeys.has(
              resourceAccessKey({
                organizationId: projectRow.organizationId,
                kind: 'project',
                id: projectRow.id,
              }),
            ),
          ),
          programs.filter((programRow) =>
            accessibleWorkKeys.has(
              resourceAccessKey({
                organizationId: programRow.organizationId,
                kind: 'program',
                id: programRow.id,
              }),
            ),
          ),
        ),
      );
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
      if (body.leadTeamId !== undefined && body.leadTeamId !== null) {
        const rows = await db
          .select({ id: team.id })
          .from(team)
          .where(and(eq(team.id, body.leadTeamId), eq(team.organizationId, orgId)))
          .limit(1);
        if (!rows[0]) throw new NotFoundError('Team not found');
      }
      // Through the shared resolver, so an initiative obeys label-group exclusivity exactly as a
      // task does. Initiatives have no team, so only workspace-wide labels are offerable.
      const labels = await resolveLabelSet(orgId, body.labelIds);
      const nextStatus =
        body.status === undefined
          ? undefined
          : await resolveContainerStatus(orgId, 'initiative', body.status);
      let blueprintResult: Awaited<ReturnType<typeof applyBlueprintReflow>> = {
        changes: [],
        rows: [],
      };
      const row = await serializableTx(async (tx) => {
        const blueprint = await prepareBlueprintReflow(
          tx,
          c.get('actorCtx'),
          { kind: 'initiative', id },
          body,
        );
        const locked = await readBlueprintWork(tx, orgId, { kind: 'initiative', id }, true);
        if (locked.kind !== 'initiative') throw new NotFoundError('Initiative not found');
        const current = locked.row;
        const settings = await workspacePlanningCalendar(tx, orgId);
        const values: Partial<typeof initiative.$inferInsert> = {
          ...explicitBlueprintDatePatch(current, body),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...clearableTextPatch('summary', body.summary),
          ...clearableTextPatch('description', body.description),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(body.leadTeamId !== undefined ? { leadTeamId: body.leadTeamId } : {}),
          ...(nextStatus === undefined
            ? {}
            : { status: nextStatus.status, statusId: nextStatus.statusId }),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.updateCadence !== undefined ? { updateCadence: body.updateCadence } : {}),
          ...workspaceTargetDatePatch(
            { date: body.targetDate, resolution: body.targetDateResolution },
            settings.fiscalYearStartMonth,
          ),
          ...(body.health !== undefined ? { health: body.health } : {}),
        };
        const updated =
          Object.keys(values).length > 0
            ? await tx
                .update(initiative)
                .set(values)
                .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
                .returning()
            : [current];
        const changed = updated[0];
        if (!changed) return undefined;
        if (body.labelIds !== undefined) {
          await replaceLabels(tx, 'initiative', id, orgId, labels);
        }
        blueprintResult = await applyBlueprintReflow(tx, blueprint);
        return recordUpdate(
          { tx, orgId, actorId, derived: blueprintResult.changes },
          'initiative',
          current,
          changed,
          body,
        );
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
      await finishBlueprintReflow(orgId, blueprintResult);
      await enqueueSearchUpsert(orgId, 'initiative', row.id);
      return ok(c, InitiativeOut, toOut(row));
    },
  )
  .post(
    '/:id/labels',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Add a label to an initiative',
      capability: 'contribute',
      response: InitiativeLabelLinked,
      description:
        'Add one workspace-wide Label to an Initiative without replacing existing Labels. Repeating an existing link succeeds without another write.',
    }),
    zParam(idParam),
    zJson(InitiativeLabelLink),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { labelId } = c.req.valid('json');
      const row = await loadInitiative(orgId, id);
      await db.transaction(async (tx) => {
        const refs = await labelsForSubject('initiative', orgId, id, tx);
        if (refs.some((label) => label.id === labelId)) return;
        const [existing, incoming] = await Promise.all([
          resolveAttachedLabels(
            orgId,
            refs.map((label) => label.id),
            tx,
          ),
          resolveLabelSet(orgId, [labelId], { dbh: tx }),
        ]);
        await attachLabels(tx, 'initiative', id, orgId, existing, incoming);
        await recordLabelUpdate({ tx, orgId, actorId }, 'initiative', row);
      });
      await enqueueSearchUpsert(orgId, 'initiative', id);
      return ok(c, InitiativeLabelLinked, { initiativeId: id, labelId, linked: true });
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
      description: `Permanently delete an initiative. Docket also removes the initiative's links to programs and projects, but it does not delete those programs or projects. The request returns 404 when the initiative does not exist or belongs to another organization. This operation requires the \`manage\` capability because deletion cannot be undone. The response contains the deleted {@link InitiativeOut}. To retain the initiative for historical reporting, PATCH its \`status\` to \`completed\` instead.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
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
        await removeWorkResources(tx, { orgId, subjectType: 'initiative', subjectId: id });
        return recordRemoval({ tx, orgId, actorId }, 'initiative', deleted[0]);
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
      status: 201,
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
        .where(
          and(
            eq(project.id, projectId),
            eq(project.organizationId, orgId),
            isNull(project.archivedAt),
          ),
        )
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
      await recordLink(c.get('actorCtx'), 'project_contributes_to', projectId, id, true);
      return created(
        c,
        InitiativeProjectLinked,
        { initiativeId: id, projectId, linked: true },
        null,
      );
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
      description: `Remove a project from an initiative without deleting the project. The project stops contributing to the initiative's roll-up and timeline. The request returns 404 when the initiative or link is not visible in the organization. Requires the \`contribute\` capability and returns {@link InitiativeUnlinked}.`,
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
      await recordLink(c.get('actorCtx'), 'project_contributes_to', projectId, id, false);
      return ok(c, InitiativeUnlinked, { unlinked: true });
    },
  )
  .post(
    '/:id/programs',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
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
      await recordLink(c.get('actorCtx'), 'program_contributes_to', programId, id, true);
      return created(
        c,
        InitiativeProgramLinked,
        { initiativeId: id, programId, linked: true },
        null,
      );
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
      description: `Remove a program from an initiative without deleting the program. The program disappears from the initiative's timeline and no longer contributes to its health roll-up. The request returns 404 when the initiative or link is not visible in the organization. Requires the \`contribute\` capability and returns {@link InitiativeUnlinked}.`,
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
      await recordLink(c.get('actorCtx'), 'program_contributes_to', programId, id, false);
      return ok(c, InitiativeUnlinked, { unlinked: true });
    },
  )
  .get(
    '/:id/timeline',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Get initiative timeline',
      response: InitiativeTimelineOut,
      description: `Return an initiative timeline with associated programs as undated lanes and associated projects as dated bars. Each project includes current \`status\`, \`health\`, \`startDate\`, \`targetDate\`, and the saved date resolution and fiscal basis. Either date may be null. Optional \`from\` and \`to\` ISO dates filter projects to those that overlap the window. Unscheduled projects remain visible, and program lanes are never filtered because they have no end date. An unavailable initiative returns 404. Use \`GET /:id\` for the numeric health and status roll-up over the same children.`,
    }),
    zParam(idParam),
    zQuery(InitiativeTimelineQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { from, to } = c.req.valid('query');
      const target = await loadInitiative(orgId, id);

      const links = await db
        .select()
        .from(initiativeHierarchyLink)
        .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId));
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
      const candidateNodes = [
        ...new Map(
          [{ id: target.id, organizationId: target.organizationId }, ...linkedInitiatives].map(
            (node) => [node.id, node],
          ),
        ).values(),
      ];
      const accessibleNodeIds = await accessibleInitiativeNodeIds(c.get('session'), candidateNodes);
      const projection = accessibleInitiativeHierarchyProjection(
        orgId,
        candidateNodes.filter((node) => accessibleNodeIds.has(node.id)),
        links,
      );
      if (!projection.nodeIds.has(id)) throw new NotFoundError('Initiative not found');
      const childrenByParent = new Map<string, string[]>();
      for (const link of projection.links) {
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
          .where(
            and(inArray(initiativeProject.initiativeId, rollupIds), isNull(project.archivedAt)),
          ),
        db
          .select({ row: program })
          .from(initiativeProgram)
          .innerJoin(program, eq(program.id, initiativeProgram.programId))
          .where(inArray(initiativeProgram.initiativeId, rollupIds)),
      ]);
      const projects = [...new Map(projectRows.map(({ row }) => [row.id, row])).values()];
      const programs = [...new Map(programRows.map(({ row }) => [row.id, row])).values()];
      const accessibleWorkKeys = await accessibleInitiativeWorkKeys(
        c.get('session'),
        projects,
        programs,
      );

      const payload: z.input<typeof InitiativeTimelineOut> = {
        programs: programs
          .filter((programRow) =>
            accessibleWorkKeys.has(
              resourceAccessKey({
                organizationId: programRow.organizationId,
                kind: 'program',
                id: programRow.id,
              }),
            ),
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            health: p.health,
          })),
        projects: projects
          .filter((projectRow) =>
            accessibleWorkKeys.has(
              resourceAccessKey({
                organizationId: projectRow.organizationId,
                kind: 'project',
                id: projectRow.id,
              }),
            ),
          )
          .filter((p) => projectOverlapsWindow(p, from, to))
          .map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            health: p.health,
            startDate: p.startDate?.toISOString() ?? null,
            startDateResolution: p.startDateResolution,
            startDateFiscalYearStartMonth: p.startDateFiscalYearStartMonth,
            targetDate: p.targetDate?.toISOString() ?? null,
            targetDateResolution: p.targetDateResolution,
            targetDateFiscalYearStartMonth: p.targetDateFiscalYearStartMonth,
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
