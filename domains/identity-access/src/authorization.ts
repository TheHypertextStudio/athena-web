import { satisfies, strongestCapability, type Capability } from './capabilities';
import {
  grantAppliesToChain,
  type ExplicitGrant,
  type GrantPrincipal,
  type GrantResourceChain,
} from './grants';

/** A stable explanation for an explicit-allow authorization result. */
export type ExplicitAuthorizationReason = 'allow' | 'no_grant' | 'insufficient';

/** The pure facts needed to evaluate explicit allow grants. */
export interface ExplicitAuthorizationInput {
  /** The actor and role facts for the decision. */
  readonly principal: GrantPrincipal;
  /** The target-first resource chain for the decision. */
  readonly resourceChain: GrantResourceChain;
  /** Explicit grants loaded by an outer persistence adapter. */
  readonly grants: readonly ExplicitGrant[];
  /** The capability required by the requested operation. */
  readonly required: Capability;
  /** The instant at which expiry is evaluated. */
  readonly now?: Date;
}

/** The result of evaluating explicit allow grants. */
export interface ExplicitAuthorizationResult {
  /** Whether the effective capability satisfies the required capability. */
  readonly allow: boolean;
  /** The strongest applicable allow capability, if any. */
  readonly effectiveCapability: Capability | null;
  /** A stable reason for the result. */
  readonly reason: ExplicitAuthorizationReason;
}

/**
 * Evaluates the maximum applicable explicit allow capability.
 *
 * @remarks
 * This is deliberately only explicit-grant policy: it has no visibility baseline, persistence
 * access, deny precedence, or resource-topology traversal.
 *
 * @param input - Normalized principal, chain, grant, and required-capability facts.
 * @returns The effective allow decision and its stable reason.
 */
export function evaluateExplicitAllow(
  input: ExplicitAuthorizationInput,
): ExplicitAuthorizationResult {
  const applicableCapabilities: Capability[] = [];
  const now = input.now ?? new Date();

  for (const grant of input.grants) {
    if (grant.effect !== 'allow') continue;
    if (!grantAppliesToChain(grant, input.principal, input.resourceChain, now)) continue;
    applicableCapabilities.push(...grant.capabilities);
  }

  const effectiveCapability = strongestCapability(applicableCapabilities);
  const allow = effectiveCapability !== null && satisfies(effectiveCapability, input.required);

  return {
    allow,
    effectiveCapability,
    reason: allow ? 'allow' : effectiveCapability === null ? 'no_grant' : 'insufficient',
  };
}
