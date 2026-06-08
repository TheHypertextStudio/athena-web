'use client';

/**
 * Resolve whether the signed-in user holds a given org-level {@link Capability}.
 *
 * @remarks
 * The detail-surface property panels make every property an interactive picker, but a viewer
 * who lacks edit rights must see the value as calm read-only text rather than an affordance
 * that would fail server-side. The API gates each mutation behind a {@link capabilityGuard}:
 * a Project / Task / Initiative / Cycle PATCH needs `contribute`; a Program PATCH needs
 * `manage`. This hook mirrors that contract on the client so the picker's `readOnly` prop can
 * be wired correctly — the server still enforces the capability regardless, so this is purely
 * a UX gate, never the security boundary.
 *
 * It resolves the signed-in user's member row, then its role, then folds the role's flat
 * capability bundle into the highest capability held (the role's `capabilities` list plus its
 * `baseCapability` fallback), and finally compares that against the required capability via the
 * canonical {@link satisfies} rank cascade. A user with no resolvable member/role — a guest, or
 * before the roster loads — is treated as unable to edit, so the UI fails closed.
 */
import {
  type Capability,
  CAPABILITY_RANK,
  type MemberOut,
  type RoleOut,
  satisfies,
} from '@docket/types';
import { useMemo } from 'react';

import { useSession } from '@/lib/auth-client';

/**
 * The highest {@link Capability} a role grants, or `null` when it grants none.
 *
 * @remarks
 * A role's effective capability is the strongest of its explicit `capabilities` list and its
 * `baseCapability` fallback. Folding to the maximum (by {@link CAPABILITY_RANK}) lets a single
 * `satisfies` check answer any required-capability question.
 *
 * @param role - The role to fold, or `undefined`/`null` when unresolved.
 * @returns the strongest held capability, or `null`.
 */
function highestCapabilityOf(role: RoleOut | undefined | null): Capability | null {
  if (!role) return null;
  const held: Capability[] = [...role.capabilities];
  if (role.baseCapability) held.push(role.baseCapability);
  if (held.length === 0) return null;
  return held.reduce((best, next) => (CAPABILITY_RANK[next] > CAPABILITY_RANK[best] ? next : best));
}

/**
 * Whether the signed-in user can perform an operation requiring `required` in this org.
 *
 * @remarks
 * Pass the org's loaded `members` + `roles` (both already fetched by the detail pages) and the
 * capability the edit requires. Returns `false` until both lists resolve and the user's role is
 * found, so edit affordances stay hidden during load and for users without a role (guests).
 *
 * @param members - The org's members (carries each member's `userId` + `roleId`).
 * @param roles - The org's roles (carries each role's capability bundle).
 * @param required - The capability the operation requires (e.g. `'contribute'`, `'manage'`).
 * @returns true when the user's role satisfies `required`.
 *
 * @example
 * ```ts
 * const canEdit = useOrgCapability(members, roles, 'contribute');
 * ```
 */
export function useOrgCapability(
  members: readonly MemberOut[],
  roles: readonly RoleOut[],
  required: Capability,
): boolean {
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;

  return useMemo(() => {
    if (!userId) return false;
    const me = members.find((member) => member.userId === userId);
    if (!me?.roleId) return false;
    const myRole = roles.find((role) => role.id === me.roleId);
    const held = highestCapabilityOf(myRole);
    return held ? satisfies(held, required) : false;
  }, [members, roles, userId, required]);
}
