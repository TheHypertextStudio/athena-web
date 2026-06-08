/**
 * Behavior tests for {@link useOrgCapability} — the client-side edit-capability gate.
 *
 * @remarks
 * The interactive property panels render their pickers `readOnly` when the actor lacks the
 * capability the mutation requires (a Project/Task/Initiative/Cycle PATCH needs `contribute`; a
 * Program PATCH needs `manage`). This hook mirrors the server's {@link capabilityGuard} contract
 * so the UI fails closed: it resolves the signed-in user's member row → role → the strongest
 * capability that role grants (its `capabilities` list folded with its `baseCapability`), and
 * compares it against the requirement via the rank cascade. The tests pin the load-failing-closed
 * behavior and the rank cascade that a higher-ranked capability satisfies a lower requirement.
 *
 * `useSession` is mocked to a fixed signed-in user so the hook resolves a stable member id.
 */
import type { MemberOut, RoleOut } from '@docket/types';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user_me' } } }),
}));

import { useOrgCapability } from '../src/lib/use-org-capability';

afterEach(cleanup);

/** A member row for the signed-in user bound to a role id. */
function meWithRole(roleId: string | null): MemberOut {
  return {
    actorId: 'actor_me',
    organizationId: 'org_1',
    displayName: 'Me',
    status: 'active',
    roleId,
    userId: 'user_me',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as MemberOut;
}

/** A role granting the given capabilities (and an optional base-capability fallback). */
function role(
  id: string,
  capabilities: RoleOut['capabilities'],
  baseCapability: RoleOut['baseCapability'] = null,
): RoleOut {
  return {
    id,
    organizationId: 'org_1',
    key: id,
    name: id,
    isSystem: false,
    capabilities,
    baseCapability,
    defaultVisibility: 'public',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as RoleOut;
}

describe('useOrgCapability', () => {
  it('fails closed while the roster is still loading (no member/role resolved)', () => {
    const { result } = renderHook(() => useOrgCapability([], [], 'contribute'));
    expect(result.current).toBe(false);
  });

  it('grants edit when the user role meets the required capability exactly', () => {
    const members = [meWithRole('role_member')];
    const roles = [role('role_member', ['contribute'])];
    const { result } = renderHook(() => useOrgCapability(members, roles, 'contribute'));
    expect(result.current).toBe(true);
  });

  it('cascades: a higher-ranked capability satisfies a lower requirement', () => {
    const members = [meWithRole('role_admin')];
    const roles = [role('role_admin', ['manage'])];
    // `manage` (rank 4) satisfies a `contribute` (rank 2) requirement.
    expect(renderHook(() => useOrgCapability(members, roles, 'contribute')).result.current).toBe(
      true,
    );
    // …and a `manage` requirement, too.
    expect(renderHook(() => useOrgCapability(members, roles, 'manage')).result.current).toBe(true);
  });

  it('denies edit when the role ranks below the requirement (e.g. contribute vs manage)', () => {
    const members = [meWithRole('role_member')];
    const roles = [role('role_member', ['contribute'])];
    // A Program PATCH needs `manage`; a `contribute` member must not get the affordance.
    expect(renderHook(() => useOrgCapability(members, roles, 'manage')).result.current).toBe(false);
  });

  it('honors the role baseCapability fallback when the explicit list is empty', () => {
    const members = [meWithRole('role_base')];
    const roles = [role('role_base', [], 'assign')];
    // `assign` (rank 3) via baseCapability satisfies `contribute`.
    expect(renderHook(() => useOrgCapability(members, roles, 'contribute')).result.current).toBe(
      true,
    );
  });

  it('denies edit for a guest with no role bound', () => {
    const members = [meWithRole(null)];
    const { result } = renderHook(() => useOrgCapability(members, [], 'contribute'));
    expect(result.current).toBe(false);
  });
});
