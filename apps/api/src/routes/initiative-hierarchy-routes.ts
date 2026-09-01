/** Context-owned Initiative hierarchy mutation routes. */
import { db, initiative, initiativeHierarchyLink, organization } from '@docket/db';
import {
  InitiativeHierarchyCandidateQuery,
  InitiativeHierarchyCandidatesOut,
  InitiativeHierarchyLinkCreate,
  InitiativeHierarchyLinkMove,
  InitiativeHierarchyLinkOut,
  InitiativeUnlinked,
} from '@docket/work/initiative-contract';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import {
  accessibleInitiativeHierarchyProjection,
  accessibleInitiativeNodeIds,
  activeInitiativeOrganizationIds,
  validateInitiativeHierarchyChange,
} from './initiative-hierarchy';
import { hierarchyLinkParam } from './initiative-helpers';

function hierarchyOut(row: typeof initiativeHierarchyLink.$inferSelect) {
  return {
    id: row.id,
    contextOrganizationId: row.contextOrganizationId,
    parentInitiativeId: row.parentInitiativeId,
    childInitiativeId: row.childInitiativeId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Initiative hierarchy router, mounted beside the core Initiative routes. */
const initiativeHierarchyRoutes = new Hono<AppEnv>()
  .get(
    '/hierarchy-candidates',
    apiDoc({
      tag: 'Initiatives',
      summary: 'Search Initiative hierarchy candidates',
      description:
        'Returns Initiatives in every workspace the viewer can access, projected through the requested route workspace hierarchy. Parent mode excludes foreign roots that the hierarchy validator would reject.',
      response: InitiativeHierarchyCandidatesOut,
    }),
    zQuery(InitiativeHierarchyCandidateQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { mode, query } = c.req.valid('query');
      const queryOrganizationIds = await activeInitiativeOrganizationIds(orgId, c.get('session'));
      const organizationIds = [...queryOrganizationIds];
      const [candidateRows, links] = await Promise.all([
        db
          .select({
            id: initiative.id,
            organizationId: initiative.organizationId,
            name: initiative.name,
            summary: initiative.summary,
            status: initiative.status,
            health: initiative.health,
          })
          .from(initiative)
          .where(inArray(initiative.organizationId, organizationIds))
          .orderBy(asc(initiative.name), asc(initiative.id)),
        db
          .select()
          .from(initiativeHierarchyLink)
          .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId)),
      ]);
      const accessibleNodeIds = await accessibleInitiativeNodeIds(c.get('session'), candidateRows);
      const rows = candidateRows.filter((row) => accessibleNodeIds.has(row.id));
      const visibleOrganizationIds = [...new Set(rows.map((row) => row.organizationId))];
      const organizations =
        visibleOrganizationIds.length === 0
          ? []
          : await db
              .select({ id: organization.id, name: organization.name })
              .from(organization)
              .where(inArray(organization.id, visibleOrganizationIds));
      const organizationNameById = new Map(
        organizations.map((organizationRow) => [organizationRow.id, organizationRow.name]),
      );
      const projection = accessibleInitiativeHierarchyProjection(orgId, rows, links);
      const parentByChild = new Map(
        projection.links.map((link) => [link.childInitiativeId, link.parentInitiativeId]),
      );
      const parentLinkByChild = new Map(
        projection.links.map((link) => [link.childInitiativeId, link.id]),
      );
      const rawParentByChild = new Set(links.map((link) => link.childInitiativeId));
      const normalizedQuery = query?.toLocaleLowerCase() ?? '';
      const items = rows
        .map((row) => {
          const organizationName = organizationNameById.get(row.organizationId) ?? '';
          const appearsInContext = projection.nodeIds.has(row.id);
          return {
            ...row,
            organizationName,
            crossWorkspace: row.organizationId !== orgId,
            appearsInContext,
            parentInitiativeId: parentByChild.get(row.id) ?? null,
            parentLinkId: parentLinkByChild.get(row.id) ?? null,
          };
        })
        .filter((candidate) =>
          mode === 'parent'
            ? candidate.appearsInContext
            : candidate.appearsInContext || !rawParentByChild.has(candidate.id),
        )
        .filter((candidate) => {
          if (normalizedQuery.length === 0) return true;
          return [candidate.name, candidate.summary, candidate.organizationName].some((value) =>
            value?.toLocaleLowerCase().includes(normalizedQuery),
          );
        });
      return ok(c, InitiativeHierarchyCandidatesOut, { items });
    },
  )
  .post(
    '/hierarchy-links',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Initiatives',
      summary: 'Create an Initiative hierarchy link',
      description:
        'Places an Initiative beneath another Initiative in this workspace context after validating access, configured depth, unique parentage, and cycle safety.',
      capability: 'contribute',
      response: InitiativeHierarchyLinkOut,
    }),
    zJson(InitiativeHierarchyLinkCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const row = await db.transaction(async (tx) => {
        await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, orgId))
          .for('update');
        await validateInitiativeHierarchyChange(
          {
            contextOrganizationId: orgId,
            parentInitiativeId: body.parentInitiativeId,
            childInitiativeId: body.childInitiativeId,
            session: c.get('session'),
          },
          tx,
        );
        const rows = await tx
          .insert(initiativeHierarchyLink)
          .values({
            contextOrganizationId: orgId,
            parentInitiativeId: body.parentInitiativeId,
            childInitiativeId: body.childInitiativeId,
            createdBy: actorId,
          })
          .returning();
        return rows[0];
      });
      /* v8 ignore next -- @preserve defensive: insert always returns one row */
      if (!row) throw new Error('Initiative hierarchy insert returned no row');
      return created(c, InitiativeHierarchyLinkOut, hierarchyOut(row));
    },
  )
  .patch(
    '/hierarchy-links/:linkId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Move an Initiative hierarchy link',
      description:
        'Moves an existing child Initiative beneath a different parent in this workspace context while preserving access, depth, unique-parent, and cycle invariants.',
      capability: 'contribute',
      response: InitiativeHierarchyLinkOut,
    }),
    zParam(hierarchyLinkParam),
    zJson(InitiativeHierarchyLinkMove),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { linkId } = c.req.valid('param');
      const body = c.req.valid('json');
      const row = await db.transaction(async (tx) => {
        await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, orgId))
          .for('update');
        const current = await tx
          .select()
          .from(initiativeHierarchyLink)
          .where(
            and(
              eq(initiativeHierarchyLink.id, linkId),
              eq(initiativeHierarchyLink.contextOrganizationId, orgId),
            ),
          )
          .limit(1);
        const link = current[0];
        if (!link) throw new NotFoundError('Initiative hierarchy link not found');
        await validateInitiativeHierarchyChange(
          {
            contextOrganizationId: orgId,
            parentInitiativeId: body.parentInitiativeId,
            childInitiativeId: link.childInitiativeId,
            session: c.get('session'),
            excludeLinkId: link.id,
          },
          tx,
        );
        const rows = await tx
          .update(initiativeHierarchyLink)
          .set({ parentInitiativeId: body.parentInitiativeId })
          .where(eq(initiativeHierarchyLink.id, link.id))
          .returning();
        return rows[0];
      });
      /* v8 ignore next -- @preserve defensive: the link was loaded above */
      if (!row) throw new Error('Initiative hierarchy update returned no row');
      return ok(c, InitiativeHierarchyLinkOut, hierarchyOut(row));
    },
  )
  .delete(
    '/hierarchy-links/:linkId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Remove an Initiative hierarchy link',
      description:
        'Removes a workspace-context hierarchy link without deleting either Initiative or changing the hierarchies that may reference them in other workspaces.',
      capability: 'contribute',
      response: InitiativeUnlinked,
    }),
    zParam(hierarchyLinkParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { linkId } = c.req.valid('param');
      await db.transaction(async (tx) => {
        await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, orgId))
          .for('update');
        const edges = await tx
          .select()
          .from(initiativeHierarchyLink)
          .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId));
        const link = edges.find((edge) => edge.id === linkId);
        if (!link) throw new NotFoundError('Initiative hierarchy link not found');
        const graphNodeIds = [
          ...new Set(edges.flatMap((edge) => [edge.parentInitiativeId, edge.childInitiativeId])),
        ];
        const graphNodes = await tx
          .select({ id: initiative.id, organizationId: initiative.organizationId })
          .from(initiative)
          .where(inArray(initiative.id, graphNodeIds));
        const nodesById = new Map(graphNodes.map((node) => [node.id, node]));
        const child = nodesById.get(link.childInitiativeId);
        if (!child) throw new NotFoundError('Initiative not found');
        const removedEdges = (() => {
          if (child.organizationId === orgId) return [link];
          const descendants = new Set([link.childInitiativeId]);
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
          return edges.filter(
            (edge) => edge.id === linkId || descendants.has(edge.parentInitiativeId),
          );
        })();
        const accessibleNodeIds = await accessibleInitiativeNodeIds(
          c.get('session'),
          graphNodes,
          tx,
        );
        const projection = accessibleInitiativeHierarchyProjection(
          orgId,
          graphNodes.filter((node) => accessibleNodeIds.has(node.id)),
          edges,
        );
        const visibleLinkIds = new Set(projection.links.map((edge) => edge.id));
        const removalIsVisible = removedEdges.every(
          (edge) =>
            visibleLinkIds.has(edge.id) &&
            accessibleNodeIds.has(edge.parentInitiativeId) &&
            accessibleNodeIds.has(edge.childInitiativeId),
        );
        if (!removalIsVisible) {
          throw new NotFoundError('Initiative hierarchy link not found');
        }
        await tx.delete(initiativeHierarchyLink).where(
          inArray(
            initiativeHierarchyLink.id,
            removedEdges.map((edge) => edge.id),
          ),
        );
      });
      return ok(c, InitiativeUnlinked, { unlinked: true });
    },
  );

export default initiativeHierarchyRoutes;
