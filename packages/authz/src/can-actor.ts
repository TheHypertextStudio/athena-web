/**
 * `@docket/authz` — the `canActor` capability-resolution algorithm.
 *
 * @remarks
 * Allow-only resolution (DENY is deferred behind a compile-dead flag): load the actor
 * (cross-org / suspended / unknown → deny), build the containment chain, collect the
 * actor's + its role's non-expired grants attached to any node in the chain, and take
 * the highest-ranked capability. `effectiveCapability` drives the 404-vs-403 decision
 * upstream (null/below-view ⇒ existence-hiding 404; present-but-insufficient ⇒ 403).
 */
import {
  actor as actorTable,
  type Database,
  grant as grantTable,
  role as roleTable,
} from '@docket/db';
import { type Capability, CAPABILITY_RANK, satisfies } from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';

import { ancestorChain, type ResourceRef } from './ancestor-chain';

/** DENY is deferred for MVP; the allow-only fast path ignores `effect='deny'` rows. */
const DENY_ENABLED = false;

/** The result of a capability resolution. */
export interface ResolveResult {
  /** Whether the actor satisfies the required capability on the target. */
  readonly allow: boolean;
  /** A short machine reason (allow | no_grant | insufficient | cross_org | …). */
  readonly reason: string;
  /** The highest capability the actor effectively holds on the target, or null. */
  readonly effectiveCapability: Capability | null;
}

/**
 * Resolve whether `actorId` holds `required` on `target`.
 *
 * @param actorId - The acting Actor id.
 * @param required - The capability the operation needs.
 * @param target - The resource being acted on.
 * @param db - The database client.
 * @returns the {@link ResolveResult}.
 */
export async function canActor(
  actorId: string,
  required: Capability,
  target: ResourceRef,
  db: Database,
): Promise<ResolveResult> {
  const rows = await db
    .select({ actor: actorTable, role: roleTable })
    .from(actorTable)
    .leftJoin(roleTable, eq(actorTable.roleId, roleTable.id))
    .where(eq(actorTable.id, actorId))
    .limit(1);

  const row = rows[0];
  if (!row) return { allow: false, reason: 'actor_not_found', effectiveCapability: null };
  if (row.actor.organizationId !== target.orgId) {
    return { allow: false, reason: 'cross_org', effectiveCapability: null };
  }
  if (row.actor.status !== 'active') {
    return { allow: false, reason: 'actor_suspended', effectiveCapability: null };
  }

  const chain = await ancestorChain(target, db);
  const subjects = [actorId, row.actor.roleId].filter((x): x is string => Boolean(x));
  const resourceIds = chain.map((r) => r.id);

  const grants = await db
    .select()
    .from(grantTable)
    .where(
      and(
        eq(grantTable.organizationId, target.orgId),
        inArray(grantTable.subjectId, subjects),
        inArray(grantTable.resourceId, resourceIds),
      ),
    );

  const now = Date.now();
  let best: Capability | null = null;
  for (const g of grants) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DENY_ENABLED is a forward-compat flag
    if (!DENY_ENABLED && g.effect === 'deny') continue;
    if (g.expiresAt && g.expiresAt.getTime() < now) continue;
    if (!chain.some((r) => r.kind === g.resourceKind && r.id === g.resourceId)) continue;
    for (const cap of g.capabilities) {
      if (best === null || CAPABILITY_RANK[cap] > CAPABILITY_RANK[best]) best = cap;
    }
  }

  const allow = best !== null && satisfies(best, required);
  return {
    allow,
    reason: allow ? 'allow' : best === null ? 'no_grant' : 'insufficient',
    effectiveCapability: best,
  };
}
