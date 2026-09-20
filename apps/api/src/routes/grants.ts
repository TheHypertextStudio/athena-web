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
import { GrantOut, GrantUpsert } from '../contracts/grant';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { pageResultById, seekAfterId } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { notifyGrantsChanged } from '../mcp/notify';
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

Results use stable grant-id order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Requires only org membership to read; the list is scoped to this org. The API only writes \`allow\` grants, though \`deny\` remains representable.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await db
        .select()
        .from(grant)
        .where(and(eq(grant.organizationId, orgId), seekAfterId(grant.id, cursor, 'asc')))
        .orderBy(asc(grant.id))
        .limit(limit + 1);
      return ok(c, pageOf(GrantOut), pageResultById(rows.map(toOut), limit));
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Grants',
      summary: 'Grant a capability',
      capability: 'manage',
      status: [200, 201],
      response: GrantOut,
      description: `Create or replace an \`allow\` grant for one subject and resource. The subject may be an Actor or a Role. When the same subject already has an allow grant for the same resource, Docket replaces its \`capabilities\`, \`cascades\`, visibility settings, and \`expiresAt\` instead of creating another grant.

\`cascades\` defaults to true and extends the grant to resources below the selected resource. \`visibilityOverride\` changes effective visibility at that resource. An expired grant no longer provides access. A caller cannot grant a capability above the highest capability they hold; such a request returns 403.

Docket returns 201 with \`Location\` when it creates a grant and 200 when it replaces an existing grant. Use \`DELETE /:grantId\` to remove the grant.`,
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

      // Read before writing so the answer can tell the truth about what happened: `201` only
      // when this tuple was new. The table carries no `updatedAt`, so the upsert's own return
      // value cannot distinguish a fresh grant from an overwritten one, and a caller that
      // retried must not be told it created something it did not.
      const existing = await db
        .select({ id: grant.id })
        .from(grant)
        .where(
          and(
            eq(grant.organizationId, orgId),
            eq(grant.subjectKind, body.subjectKind),
            eq(grant.subjectId, body.subjectId),
            eq(grant.resourceKind, body.resourceKind),
            eq(grant.resourceId, body.resourceId),
            eq(grant.effect, 'allow'),
          ),
        )
        .limit(1);
      const existed = existing.length > 0;

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
      // A grant change is the only thing that can move a live MCP client's tool list, since the
      // surface is principal-aware. Best-effort: a missed frame must not fail the grant write.
      await notifyGrantsChanged(orgId, row.subjectKind, row.subjectId).catch(() => undefined);
      // No `Location`: a grant is listed and deleted by id but never read on its own, so the
      // derived `/grants/{id}` would answer 405 to any client that followed it.
      return existed ? ok(c, GrantOut, toOut(row)) : created(c, GrantOut, toOut(row), null);
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
      description: `Delete an \`allow\` grant and return the deleted \`GrantOut\`. Docket returns 404 when the grant is unavailable, belongs to another organization, or represents a \`deny\` grant that this API cannot change.

Removing a cascading organization-level role grant removes that role's workspace-wide access. Removing a more specific grant restores any capability inherited from a broader grant. To reduce access without removing it, use \`POST /\` with a narrower capability set for the same subject and resource.`,
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
      await notifyGrantsChanged(orgId, row.subjectKind, row.subjectId).catch(() => undefined);
      return ok(c, GrantOut, toOut(row));
    },
  );

export default grants;
