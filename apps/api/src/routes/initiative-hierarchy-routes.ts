/** Context-owned Initiative hierarchy mutation routes. */
import { db, initiativeHierarchyLink } from '@docket/db';
import {
  InitiativeHierarchyLinkCreate,
  InitiativeHierarchyLinkMove,
  InitiativeHierarchyLinkOut,
  InitiativeUnlinked,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { validateInitiativeHierarchyChange } from './initiative-hierarchy';
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
  .post(
    '/hierarchy-links',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Create an Initiative hierarchy link',
      capability: 'contribute',
      response: InitiativeHierarchyLinkOut,
    }),
    zJson(InitiativeHierarchyLinkCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      await validateInitiativeHierarchyChange({
        contextOrganizationId: orgId,
        parentInitiativeId: body.parentInitiativeId,
        childInitiativeId: body.childInitiativeId,
        session: c.get('session'),
      });
      const rows = await db
        .insert(initiativeHierarchyLink)
        .values({
          contextOrganizationId: orgId,
          parentInitiativeId: body.parentInitiativeId,
          childInitiativeId: body.childInitiativeId,
          createdBy: actorId,
        })
        .returning();
      const row = rows[0];
      /* v8 ignore next -- @preserve defensive: insert always returns one row */
      if (!row) throw new Error('Initiative hierarchy insert returned no row');
      return ok(c, InitiativeHierarchyLinkOut, hierarchyOut(row));
    },
  )
  .patch(
    '/hierarchy-links/:linkId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Move an Initiative hierarchy link',
      capability: 'contribute',
      response: InitiativeHierarchyLinkOut,
    }),
    zParam(hierarchyLinkParam),
    zJson(InitiativeHierarchyLinkMove),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { linkId } = c.req.valid('param');
      const body = c.req.valid('json');
      const current = await db
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
      await validateInitiativeHierarchyChange({
        contextOrganizationId: orgId,
        parentInitiativeId: body.parentInitiativeId,
        childInitiativeId: link.childInitiativeId,
        session: c.get('session'),
        excludeLinkId: link.id,
      });
      const rows = await db
        .update(initiativeHierarchyLink)
        .set({ parentInitiativeId: body.parentInitiativeId })
        .where(eq(initiativeHierarchyLink.id, link.id))
        .returning();
      const row = rows[0];
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
      capability: 'contribute',
      response: InitiativeUnlinked,
    }),
    zParam(hierarchyLinkParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { linkId } = c.req.valid('param');
      const rows = await db
        .delete(initiativeHierarchyLink)
        .where(
          and(
            eq(initiativeHierarchyLink.id, linkId),
            eq(initiativeHierarchyLink.contextOrganizationId, orgId),
          ),
        )
        .returning({ id: initiativeHierarchyLink.id });
      if (!rows[0]) throw new NotFoundError('Initiative hierarchy link not found');
      return ok(c, InitiativeUnlinked, { unlinked: true });
    },
  );

export default initiativeHierarchyRoutes;
