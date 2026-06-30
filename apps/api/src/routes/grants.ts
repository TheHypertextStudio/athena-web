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
    apiDoc({ tag: 'Grants', summary: 'List grants', response: pageOf(GrantOut) }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(grant).where(eq(grant.organizationId, orgId));
      return ok(c, pageOf(GrantOut), { items: rows.map(toOut) });
    },
  )
  .put(
    '/',
    capabilityGuard('manage'),
    apiDoc({ tag: 'Grants', summary: 'Upsert a grant', capability: 'manage', response: GrantOut }),
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
    apiDoc({ tag: 'Grants', summary: 'Remove a grant', capability: 'manage', response: GrantOut }),
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
