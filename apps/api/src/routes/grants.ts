/**
 * `@docket/api` — grants router (mounted at `/v1/orgs/:orgId/grants`).
 *
 * @remarks
 * Org-scoped management of capability {@link grant}s. Only `allow` grants are written
 * (the `deny` effect is gated off); the PUT endpoint upserts by the
 * `(subjectKind, subjectId, resourceKind, resourceId, effect)` unique key. Every write
 * runs {@link noSelfEscalation} using the writer's max held capability so no one grants
 * above their own rank. `manage` is required to mutate.
 */
import {
  type Capability,
  CAPABILITY_RANK,
  noSelfEscalation,
  SelfEscalationError,
} from '@docket/authz';
import { db, grant } from '@docket/db';
import { GrantOut, GrantUpsert, pageOf } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type GrantRow = typeof grant.$inferSelect;

function toOut(g: GrantRow): z.input<typeof GrantOut> {
  return {
    id: g.id,
    organizationId: g.organizationId,
    subjectKind: g.subjectKind,
    subjectId: g.subjectId,
    resourceKind: g.resourceKind,
    resourceId: g.resourceId,
    capabilities: g.capabilities,
    effect: g.effect,
    cascades: g.cascades,
    visibilityOverride: g.visibilityOverride,
    visibility: g.visibility,
    expiresAt: g.expiresAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
  };
}

/** The highest-ranked capability in a set, or `view` for the empty set. */
function maxCapability(caps: readonly Capability[]): Capability {
  let best: Capability = 'view';
  for (const cap of caps) {
    if (CAPABILITY_RANK[cap] > CAPABILITY_RANK[best]) best = cap;
  }
  return best;
}

const grantIdParam = z.object({ grantId: z.string() });

/** Grants router: list + upsert (allow-only, self-escalation-guarded) + delete. */
const grants = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Grants',
      summary: 'List grants',
      response: pageOf(GrantOut),
      description: `List every capability \`grant\` in the organization. A grant binds a **subject** — an Actor or a Role — to a **resource node** in the containment tree (\`organization\` › \`team\`/\`program\`/\`project\` › \`task\`, etc.) and confers a flat capability set there. Grants are the storage form of both role baselines (the four seeded role bundles attach their org-root grant here) and individual actor overrides. By default a grant **cascades** to the resource's whole subtree, overridable by a more-specific grant lower down (permissions §3/§4.4).

Requires only org membership to read; the list is scoped to this org. Returns the standard \`{ items }\` page envelope of \`GrantOut\`, including each grant's effect (\`allow\`/\`deny\`), \`cascades\` flag, visibility override, and optional \`expiresAt\`. Note the API only ever writes \`allow\` grants (see \`PUT /\`), though the \`deny\` effect exists in the schema. See \`PUT /\` to upsert and \`DELETE /:grantId\` to remove.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(grant).where(eq(grant.organizationId, orgId));
      return ok(c, pageOf(GrantOut), { items: rows.map(toOut) });
    },
  )
  .put(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Grants',
      summary: 'Upsert a grant',
      capability: 'manage',
      response: GrantOut,
      description: `Create or update a capability grant. Requires the \`manage\` capability because a grant confers access. This is an **upsert** keyed on the unique tuple \`(organizationId, subjectKind, subjectId, resourceKind, resourceId, effect)\`: a write for an existing tuple overwrites its \`capabilities\`, \`cascades\`, \`visibilityOverride\`/\`visibility\`, and \`expiresAt\` rather than creating a duplicate (idempotent per subject+resource). \`organizationId\` and \`createdBy\` come from the actor context, never the body.

**Allow-only:** the handler hard-codes \`effect: 'allow'\` — the \`deny\` effect is gated off at this endpoint even though the schema models it. **No self-escalation:** before writing, the granted capability is compared against the writer's own max held capability via \`noSelfEscalation\` — you cannot grant above your own rank (permissions §4.5); a violation returns a capability error (**403**). In practice \`manage\` is the top rank, so a manager rarely trips this, but the guard is enforced unconditionally.

Semantics that flow into the resolver: \`cascades\` (default true) makes the grant apply to the resource AND its whole containment subtree, overridable lower; \`visibilityOverride\` flips a resource's effective visibility (public/private) at that node; \`expiresAt\` time-boxes the grant — once \`< now\` it is inert (filtered out by the resolver), powering temporary guest access. Returns the upserted \`GrantOut\`. See \`DELETE /:grantId\` to remove and \`GET /\` to list.`,
    }),
    zJson(GrantUpsert),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const body = c.req.valid('json');

      const writerCapability = maxCapability(capabilities as Capability[]);
      const grantedCapability = maxCapability(body.capabilities);
      try {
        noSelfEscalation(writerCapability, grantedCapability);
        /* v8 ignore start -- @preserve unreachable: capabilityGuard('manage') caps the writer at the top rank, so no grant can exceed it */
      } catch (err) {
        if (err instanceof SelfEscalationError) throw new CapabilityError(err.message);
        throw err;
      }
      /* v8 ignore stop */

      const upserted = await db
        .insert(grant)
        .values({
          organizationId: orgId,
          subjectKind: body.subjectKind,
          subjectId: body.subjectId,
          resourceKind: body.resourceKind,
          resourceId: body.resourceId,
          capabilities: body.capabilities,
          effect: 'allow',
          cascades: body.cascades ?? true,
          visibilityOverride: body.visibilityOverride ?? null,
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          createdBy: actorId,
        })
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
            capabilities: body.capabilities,
            cascades: body.cascades ?? true,
            visibilityOverride: body.visibilityOverride ?? null,
            ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          },
        })
        .returning();
      const row = upserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('grant upsert returned no row');
      return ok(c, GrantOut, toOut(row));
    },
  )
  .delete(
    '/:grantId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Grants',
      summary: 'Remove a grant',
      capability: 'manage',
      response: GrantOut,
      description: `Delete a capability grant by id, revoking the access it conferred. Requires the \`manage\` capability. The delete is scoped to \`(grantId, orgId, effect = 'allow')\` — only an \`allow\` grant in THIS org can be removed here, mirroring the allow-only write path and enforcing tenant isolation. A grant id that is unknown, in another org, or a (non-writable) \`deny\` grant returns **404**.

Removing a cascading org-root role grant strips that role's org-wide baseline, and removing a subtree grant re-exposes the inherited capability from higher in the chain (per the resolver's cascade-with-override walk). Returns the deleted \`GrantOut\` as a tombstone. To lower rather than revoke access, \`PUT /\` a narrower capability set on the same subject+resource instead.`,
    }),
    zParam(grantIdParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { grantId } = c.req.valid('param');
      const deleted = await db
        .delete(grant)
        .where(
          and(eq(grant.id, grantId), eq(grant.organizationId, orgId), eq(grant.effect, 'allow')),
        )
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Grant not found');
      return ok(c, GrantOut, toOut(row));
    },
  );

export default grants;
