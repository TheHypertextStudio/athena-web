import { z } from 'zod';

import type { Capability } from './capabilities';

/** The kind of principal to which an explicit grant belongs. */
export const GrantSubjectKind = z
  .enum(['actor', 'role'])
  .describe('An actor or role grant subject.');

/** A grant subject kind. */
export type GrantSubjectKind = z.infer<typeof GrantSubjectKind>;

/** The resource kinds that an explicit grant may target. */
export const GrantResourceKind = z
  .enum(['organization', 'team', 'initiative', 'program', 'project', 'cycle', 'task'])
  .describe('A resource kind within a normalized authorization chain.');

/** An explicit grant resource kind. */
export type GrantResourceKind = z.infer<typeof GrantResourceKind>;

/** The effect recorded on an explicit grant. */
export type GrantEffect = 'allow' | 'deny';

/** Facts about the actor and role considered for an authorization decision. */
export interface GrantPrincipal {
  /** The organization that contains the principal. */
  readonly organizationId: string;
  /** The actor being authorized. */
  readonly actorId: string;
  /** The actor's role, if it has one. */
  readonly roleId: string | null;
}

/** A normalized resource fact supplied by the application-specific chain resolver. */
export interface GrantResource {
  /** The resource kind. */
  readonly kind: GrantResourceKind;
  /** The resource identifier. */
  readonly id: string;
}

/**
 * A target-first containment chain supplied to pure grant evaluation.
 *
 * @remarks
 * This domain evaluates the supplied facts but does not discover parent links or decide which
 * topology is valid for a product resource.
 */
export interface GrantResourceChain {
  /** The organization shared by every resource in the chain. */
  readonly organizationId: string;
  /** The target at index zero, followed by its ancestors. */
  readonly resources: readonly GrantResource[];
}

/** A normalized explicit grant fact. */
export interface ExplicitGrant {
  /** The organization that owns the grant. */
  readonly organizationId: string;
  /** Whether the grant applies to an actor or a role. */
  readonly subjectKind: GrantSubjectKind;
  /** The actor or role identifier selected by {@link subjectKind}. */
  readonly subjectId: string;
  /** The kind of resource named by the grant. */
  readonly resourceKind: GrantResourceKind;
  /** The resource identifier named by the grant. */
  readonly resourceId: string;
  /** The capabilities conferred by this grant. */
  readonly capabilities: readonly Capability[];
  /** Whether the grant is an allow or a deferred deny fact. */
  readonly effect: GrantEffect;
  /** Whether the grant applies below its named resource. */
  readonly cascades: boolean;
  /** The instant after which this grant no longer applies, if any. */
  readonly expiresAt: Date | null;
}

/**
 * Determines whether an explicit grant belongs to a principal.
 *
 * @param grant - The grant under consideration.
 * @param principal - The actor and role facts for the authorization decision.
 * @returns Whether the grant's subject selects that principal.
 */
export function matchesGrantPrincipal(grant: ExplicitGrant, principal: GrantPrincipal): boolean {
  if (grant.subjectKind === 'actor') return grant.subjectId === principal.actorId;

  return principal.roleId !== null && grant.subjectId === principal.roleId;
}

/**
 * Determines whether an explicit grant applies to a target-first resource chain.
 *
 * @param grant - The grant under consideration.
 * @param principal - The actor and role facts for the authorization decision.
 * @param chain - The target-first containment facts supplied by the caller.
 * @param now - The time at which expiry is evaluated.
 * @returns Whether the grant applies to the target resource.
 */
export function grantAppliesToChain(
  grant: ExplicitGrant,
  principal: GrantPrincipal,
  chain: GrantResourceChain,
  now: Date = new Date(),
): boolean {
  if (
    grant.organizationId !== principal.organizationId ||
    chain.organizationId !== principal.organizationId ||
    !matchesGrantPrincipal(grant, principal) ||
    (grant.expiresAt !== null && grant.expiresAt.getTime() < now.getTime())
  ) {
    return false;
  }

  const resourceIndex = chain.resources.findIndex(
    (resource) => resource.kind === grant.resourceKind && resource.id === grant.resourceId,
  );

  return resourceIndex === 0 || (resourceIndex > 0 && grant.cascades);
}
