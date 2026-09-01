'use client';

/**
 * The org's roster and roles, read on their own fast path.
 *
 * @remarks
 * Capabilities decide whether a detail page renders affordances or calm read-only text, and
 * {@link useOrgCapability} fails closed — it answers `false` until both lists resolve. That is
 * correct behavior for a guest and dangerous behavior for a page that simply has not finished
 * loading, because the two are indistinguishable on screen: every picker is inert, the title is
 * not editable, and the inline composer is absent, with nothing saying why.
 *
 * Detail pages used to take these lists from their composite read, which made the distinction
 * moot — the page did not render at all until the composite landed. Now that identity can arrive
 * first, capabilities need a source that resolves on its own, and a `pending` flag so a page can
 * tell "not permitted" from "not known yet".
 *
 * These are the canonical org-wide keys (`STALE.static`), already read by every roster page and
 * SSR-prefetched by the list entries, so on any navigation from inside the app they are warm and
 * this costs no request at all.
 */
import type { MemberOut } from '@docket/identity-access/member-contract';
import type { RoleOut } from './contracts/role';

import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** The org's roster and roles, plus whether they are still resolving. */
export interface OrgMembership {
  /** The org's members (each carries `userId` + `roleId`). */
  readonly members: readonly MemberOut[];
  /** The org's roles (each carries a capability bundle). */
  readonly roles: readonly RoleOut[];
  /**
   * Whether either list is still loading.
   *
   * @remarks
   * The flag that lets a page hold its capability-gated chrome back rather than render it
   * disabled. An empty roster and an unloaded one look identical to {@link useOrgCapability}.
   */
  readonly pending: boolean;
}

/**
 * Typed definition for the org's member roster.
 *
 * @param orgId - The org to read.
 * @returns The shared members query definition.
 */
export function orgMembersDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.members(orgId),
    () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
    'Could not load members.',
    { staleTime: STALE.static },
  );
}

/**
 * Typed definition for the org's roles.
 *
 * @param orgId - The org to read.
 * @returns The shared roles query definition.
 */
export function orgRolesDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.roles(orgId),
    () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    'Could not load roles.',
    { staleTime: STALE.static },
  );
}

/**
 * Read the org's roster and roles for capability checks.
 *
 * @param orgId - The org whose capabilities are being resolved.
 * @returns The {@link OrgMembership} slices plus a `pending` flag.
 *
 * @example
 * ```ts
 * const membership = useOrgMembership(orgId);
 * const canEdit = useOrgCapability(membership.members, membership.roles, 'contribute');
 * ```
 */
export function useOrgMembership(orgId: string): OrgMembership {
  const membersQ = useApiQuery(orgMembersDef(orgId));
  const rolesQ = useApiQuery(orgRolesDef(orgId));
  return {
    members: membersQ.data?.items ?? [],
    roles: rolesQ.data?.items ?? [],
    // Errors do not count as pending: a roster that failed to load is not going to arrive, and
    // holding the page back for it forever would be worse than failing closed.
    pending: membersQ.isPending || rolesQ.isPending,
  };
}
