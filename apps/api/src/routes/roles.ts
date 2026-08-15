/**
 * `@docket/api` — roles router (mounted at `/v1/orgs/:orgId/roles`).
 *
 * @remarks
 * Org-scoped CRUD over {@link role} capability bundles. The four seeded system roles
 * (`isSystem = true`) keep an immutable `key` (the update body has no `key` field) and
 * cannot be deleted. Custom roles require `manage` to mutate; patching a system role also
 * requires an Owner membership.
 */
import { actor, db, grant, role } from '@docket/db';
import { pageOf, RoleCreate, RoleOut, RoleUpdate } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { notifyGrantsChanged } from '../mcp/notify';
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

/** The single org-root grant that materializes a role's base capability. */
function roleBaseGrantValues(
  orgId: string,
  roleId: string,
  baseCapability: NonNullable<RoleRow['baseCapability']>,
): typeof grant.$inferInsert {
  return {
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: roleId,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: [baseCapability],
    effect: 'allow',
    cascades: true,
  };
}

/** Match only the org-root grant that represents a role's base capability. */
function roleBaseGrantWhere(orgId: string, roleId: string) {
  return and(
    eq(grant.organizationId, orgId),
    eq(grant.subjectKind, 'role'),
    eq(grant.subjectId, roleId),
    eq(grant.resourceKind, 'organization'),
    eq(grant.resourceId, orgId),
    eq(grant.effect, 'allow'),
  );
}

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
      const row = await db.transaction(async (tx) => {
        const inserted = await tx
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
        const created = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!created) throw new Error('role insert returned no row');

        if (created.baseCapability !== null) {
          await tx
            .insert(grant)
            .values(roleBaseGrantValues(orgId, created.id, created.baseCapability));
        }

        return created;
      });
      // A base grant changes the live MCP surface for every actor assigned this role. Delivery is
      // best-effort, like grant writes: the persisted transaction must not fail on a missed frame.
      await notifyGrantsChanged(orgId, 'role', row.id).catch(() => undefined);
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
      const { orgId, roleId: callerRoleId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const row = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(role)
          .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
          .limit(1);
        const target = existing[0];
        if (!target) throw new NotFoundError('Role not found');
        if (target.isSystem) {
          const callerRole = callerRoleId
            ? await tx
                .select({ key: role.key })
                .from(role)
                .where(and(eq(role.id, callerRoleId), eq(role.organizationId, orgId)))
                .limit(1)
            : [];
          if (callerRole[0]?.key !== 'owner') {
            throw new CapabilityError('Only an owner can modify a system role');
          }
        }

        const updated = await tx
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
        const patched = updated[0];
        /* v8 ignore next -- @preserve defensive: the role was verified to exist above */
        if (!patched) throw new NotFoundError('Role not found');

        if (body.baseCapability === null) {
          await tx.delete(grant).where(roleBaseGrantWhere(orgId, id));
        } else if (body.baseCapability !== undefined) {
          const baseline = roleBaseGrantValues(orgId, id, body.baseCapability);
          await tx
            .insert(grant)
            .values(baseline)
            .onConflictDoUpdate({
              target: [
                grant.organizationId,
                grant.subjectKind,
                grant.subjectId,
                grant.resourceKind,
                grant.resourceId,
                grant.effect,
              ],
              set: {
                capabilities: baseline.capabilities,
                cascades: baseline.cascades,
              },
            });
        }

        return patched;
      });
      if (body.baseCapability !== undefined) {
        await notifyGrantsChanged(orgId, 'role', row.id).catch(() => undefined);
      }
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

This is a hard delete of the \`role\` row and its role-subject grants. The role FK clears affected members' \`actor.roleId\`, so reassign members (via \`PATCH /members/:actorId\`) when they should retain an org-wide baseline. Returns the deleted \`RoleOut\` as a tombstone of what was removed.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');

      const deletedRole = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(role)
          .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
          .limit(1);
        const target = existing[0];
        if (!target) throw new NotFoundError('Role not found');
        if (target.isSystem) throw new ConflictError('Cannot delete a system role');

        // Deleting the role sets these foreign keys to null. Capture the members now so the
        // post-commit invalidation can still address the sessions whose tools just changed.
        const affectedActors = await tx
          .select({ id: actor.id })
          .from(actor)
          .where(and(eq(actor.organizationId, orgId), eq(actor.roleId, id)));

        await tx
          .delete(grant)
          .where(
            and(
              eq(grant.organizationId, orgId),
              eq(grant.subjectKind, 'role'),
              eq(grant.subjectId, id),
            ),
          );

        const deleted = await tx
          .delete(role)
          .where(and(eq(role.id, id), eq(role.organizationId, orgId)))
          .returning();
        const removed = deleted[0];
        /* v8 ignore next -- @preserve defensive: the role was verified to exist above */
        if (!removed) throw new NotFoundError('Role not found');
        return { row: removed, affectedActorIds: affectedActors.map((affected) => affected.id) };
      });
      await Promise.all(
        deletedRole.affectedActorIds.map((actorId) =>
          notifyGrantsChanged(orgId, 'actor', actorId).catch(() => undefined),
        ),
      );
      return ok(c, RoleOut, toOut(deletedRole.row));
    },
  );

export default roles;
