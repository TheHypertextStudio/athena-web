/**
 * `@docket/authz` — the `canActor` capability-resolution compatibility bridge.
 *
 * @remarks
 * The DB-backed Identity & Access adapter loads actor, containment, and candidate explicit-grant
 * facts. Authz preserves its caller-facing result shape by mapping adapter denials and delegating
 * ready facts to the pure explicit-allow evaluator. Delivery policy such as visibility baselines,
 * guest access, batching, and archive filtering remains outside this bridge.
 */
import type { Database } from '@docket/db';
import {
  loadExplicitAuthorizationFacts,
  loadExplicitAuthorizationFactsBatch,
  type ResourceRef,
} from '@docket/db/identity-access';
import { evaluateExplicitAllow } from '@docket/identity-access/authorization';
import type { Capability } from '@docket/identity-access/capabilities';

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
 * Resolves whether `actorId` holds `required` through explicit allow grants on `target`.
 *
 * @param actorId - The acting Actor id.
 * @param required - The capability the operation needs.
 * @param target - The resource being acted on.
 * @param db - The database client.
 * @returns the {@link ResolveResult} compatibility result.
 */
export async function canActor(
  actorId: string,
  required: Capability,
  target: ResourceRef,
  db: Database,
): Promise<ResolveResult> {
  const result = await loadExplicitAuthorizationFacts(actorId, target, db);

  if (result.kind !== 'ready') {
    return { allow: false, reason: result.kind, effectiveCapability: null };
  }

  return evaluateExplicitAllow({ ...result.facts, required, now: new Date() });
}

/**
 * Resolve one capability for many resources through a shared principal and grant hydration.
 *
 * @param actorId - The acting Actor id.
 * @param required - The capability every target requires.
 * @param targets - Resources to resolve in result order.
 * @param db - The database client.
 * @returns one {@link ResolveResult} for each target.
 */
export async function canActorBatch(
  actorId: string,
  required: Capability,
  targets: readonly ResourceRef[],
  db: Database,
): Promise<ResolveResult[]> {
  const results = await loadExplicitAuthorizationFactsBatch(actorId, targets, db);
  const now = new Date();
  return results.map((result) =>
    result.kind === 'ready'
      ? evaluateExplicitAllow({ ...result.facts, required, now })
      : { allow: false, reason: result.kind, effectiveCapability: null },
  );
}
