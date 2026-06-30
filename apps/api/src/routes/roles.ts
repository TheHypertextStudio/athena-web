/**
 * `@docket/api` — roles router (mounted at `/v1/orgs/:orgId/roles`).
 *
 * @remarks
 * Org-scoped CRUD over {@link role} capability bundles. The four seeded system roles
 * (`isSystem = true`) keep an immutable `key` (the update body has no `key` field) and
 * cannot be deleted. `manage` is required to mutate.
 */
import { db, role } from '@docket/db';
import { pageOf, RoleCreate, RoleOut, RoleUpdate } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type RoleRow = typeof role.$inferSelect;

function toOut(r: RoleRow): z.input<typeof RoleOut> {
  return {
    id: r.id,
    organizationId: r.organizationId,
    key: r.key,
    name: r.name,
    isSystem: r.isSystem,
    capabilities: r.capabilities,
    baseCapability: r.baseCapability,
    defaultVisibility: r.defaultVisibility,
    createdAt: r.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Roles router: org-scoped CRUD; system roles are immutable-key and non-deletable. */
const roles = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({ tag: 'Roles', summary: 'List roles', response: pageOf(RoleOut) }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(role).where(eq(role.organizationId, orgId));
      return ok(c, pageOf(RoleOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({ tag: 'Roles', summary: 'Create a role', capability: 'manage', response: RoleOut }),
    zJson(RoleCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const inserted = await db
        .insert(role)
        .values({
          organizationId: orgId,
          key: body.key,
          name: body.name,
          isSystem: false,
          capabilities: body.capabilities ?? [],
          baseCapability: body.baseCapability ?? null,
          ...(body.defaultVisibility !== undefined
            ? { defaultVisibility: body.defaultVisibility }
            : {}),
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('role insert returned no row');
      return ok(c, RoleOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({ tag: 'Roles', summary: 'Get a role', response: RoleOut }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(role)
        .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Role not found');
      return ok(c, RoleOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({ tag: 'Roles', summary: 'Update a role', capability: 'manage', response: RoleOut }),
    zParam(idParam),
    zJson(RoleUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const existing = await db
        .select()
        .from(role)
        .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
        .limit(1);
      if (!existing[0]) throw new NotFoundError('Role not found');

      const updated = await db
        .update(role)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.capabilities !== undefined ? { capabilities: body.capabilities } : {}),
          ...(body.baseCapability !== undefined ? { baseCapability: body.baseCapability } : {}),
          ...(body.defaultVisibility !== undefined
            ? { defaultVisibility: body.defaultVisibility }
            : {}),
        })
        .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the role was verified to exist above */
      if (!row) throw new NotFoundError('Role not found');
      return ok(c, RoleOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({ tag: 'Roles', summary: 'Delete a role', capability: 'manage', response: RoleOut }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');

      const existing = await db
        .select()
        .from(role)
        .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
        .limit(1);
      const target = existing[0];
      if (!target) throw new NotFoundError('Role not found');
      if (target.isSystem) throw new ConflictError('Cannot delete a system role');

      const deleted = await db
        .delete(role)
        .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      /* v8 ignore next -- @preserve defensive: the role was verified to exist above */
      if (!row) throw new NotFoundError('Role not found');
      return ok(c, RoleOut, toOut(row));
    },
  );

export default roles;
