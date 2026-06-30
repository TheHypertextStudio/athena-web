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
    apiDoc({
      tag: 'Roles',
      summary: 'List roles',
      response: pageOf(RoleOut),
      description: `List every role defined in the organization — the four seeded **system roles** (Owner, Admin, Member, Guest; \`isSystem: true\`) plus any custom roles the org has created. A role is a named, org-scoped capability bundle: a flat \`capabilities\` array (resolved by max-rank) plus a \`baseCapability\` that, when non-null, is materialized as a role-grant at the org root and becomes the holder's org-wide baseline (Owner/Admin → \`manage\`, Member → \`contribute\`, Guest → \`null\`, i.e. grant-only).

Requires only org membership to read (no \`manage\`) — members need to see the role catalog to assign roles in invites. Returns the standard \`{ items }\` page envelope of \`RoleOut\`. See \`POST /\` to create custom roles and \`GET /:id\` for a single role.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(role).where(eq(role.organizationId, orgId));
      return ok(c, pageOf(RoleOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Roles',
      summary: 'Create a role',
      capability: 'manage',
      response: RoleOut,
      description: `Create a custom role within the org — a named capability bundle members can be assigned. Requires the \`manage\` capability because a role mints reusable capability. \`organizationId\` is taken from the path, never the body. The new row is always \`isSystem: false\` (only the four seeded roles are system roles); its \`key\` is the stable identifier and must be unique within the org (the DB enforces \`(organization_id, key)\`).

\`capabilities\` defaults to an empty array and \`baseCapability\` to \`null\` when omitted; \`defaultVisibility\` defaults at the DB level when not supplied. Per the self-escalation invariant (permissions §4.3/§4.5), a role should not confer capability greater than the creator's own org-wide capability — a Member (\`contribute\`) cannot mint a \`manage\` role. The five capability values, lowest→highest, are \`view\` < \`comment\` < \`contribute\` < \`assign\` < \`manage\` (higher implies all lower).

Returns the created \`RoleOut\`. Assign the role to members via the invitation \`roleId\` or \`PATCH /members/:actorId\`. See \`PATCH /:id\` to edit and \`DELETE /:id\` to remove (system roles cannot be deleted).`,
    }),
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
    apiDoc({
      tag: 'Roles',
      summary: 'Get a role',
      response: RoleOut,
      description: `Fetch a single role by id within the org, returning its full \`RoleOut\` — key, name, \`isSystem\` flag, capability bundle, \`baseCapability\`, default visibility, and creation time. The lookup is scoped to \`(id, orgId)\`, so a role id from another org returns **404** (existence-hiding) rather than leaking its existence. Requires only org membership to read. See \`GET /\` to list all roles.`,
    }),
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
    apiDoc({
      tag: 'Roles',
      summary: 'Update a role',
      capability: 'manage',
      response: RoleOut,
      description: `Patch a role's \`name\`, \`capabilities\`, \`baseCapability\`, and/or \`defaultVisibility\`. Requires the \`manage\` capability. Every field is optional; only supplied fields change. The role must exist in this org — otherwise **404** (existence-hiding); the lookup and update are both scoped to \`(id, orgId)\`.

Notably the update body has **no \`key\` field**: a role's \`key\` is immutable once created, which keeps it stable for the four system roles (Owner/Admin/Member/Guest) that the permission engine and seeds reference by key. System roles can still have their name/capabilities patched here (subject to the self-escalation invariant — you cannot raise a role above your own effective capability, permissions §4.5), but editing the system role bundles themselves is an Owner-privileged action in the broader model. Setting \`capabilities\` replaces the whole array; setting \`baseCapability: null\` clears the org-wide baseline. Returns the updated \`RoleOut\`.`,
    }),
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
    apiDoc({
      tag: 'Roles',
      summary: 'Delete a role',
      capability: 'manage',
      response: RoleOut,
      description: `Delete a custom role by id. Requires the \`manage\` capability. The role must exist in this org — otherwise **404** (existence-hiding). **System roles cannot be deleted**: if the target's \`isSystem\` is true (Owner/Admin/Member/Guest), the request is rejected with **409**, since the seeded bundles are structural to the permission model and the org's role grants.

This is a hard delete of the \`role\` row. Members currently assigned the role keep their \`actor.roleId\` FK (a bare global FK), so callers should re-point affected members to another role (via \`PATCH /members/:actorId\`) before or after deletion to avoid leaving them without a resolvable org-wide capability. Returns the deleted \`RoleOut\` as a tombstone of what was removed.`,
    }),
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
