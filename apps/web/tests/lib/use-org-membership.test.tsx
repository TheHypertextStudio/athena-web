/**
 * Where a detail page's capabilities come from, and why not from its composite read.
 *
 * @remarks
 * `useOrgCapability` fails closed — it answers `false` until the roster resolves. That is right
 * for a guest and wrong for a page that has merely not finished loading, and on screen the two
 * are the same page: every picker inert, the title not editable, the inline composer absent,
 * nothing saying why.
 *
 * Detail pages used to take the roster from their composite, which hid the distinction because
 * the page did not render until the composite landed. Now that identity can arrive first, these
 * pin the replacement: capabilities resolve on their own shared keys, and `pending` exists so a
 * page can tell "not permitted" from "not known yet".
 */
import type { MemberOut, RoleOut } from '@docket/types';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { orgMembersDef, orgRolesDef, useOrgMembership } from '../../src/lib/use-org-membership';
import { queryKeys } from '../../src/lib/query-keys';
import { makeQueryWrapper } from '../support/query';

const ORG = 'org_1';
const MEMBERS = [
  { actorId: 'actor_1', userId: 'user_1', roleId: 'role_1' },
] as unknown as MemberOut[];
const ROLES = [{ id: 'role_1', capabilities: ['contribute'] }] as unknown as RoleOut[];

describe('useOrgMembership', () => {
  it('reads the shared org roster keys, so a warm cache costs no request', async () => {
    const { client, wrapper } = makeQueryWrapper();
    // Exactly what a list page (or the detail route's server prefetch) leaves behind.
    client.setQueryData(orgMembersDef(ORG).queryKey, { items: MEMBERS });
    client.setQueryData(orgRolesDef(ORG).queryKey, { items: ROLES });

    const { result } = renderHook(() => useOrgMembership(ORG), { wrapper });

    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(result.current.members).toEqual(MEMBERS);
    expect(result.current.roles).toEqual(ROLES);
  });

  it('reports pending while the roster is unknown, rather than reporting an empty one', async () => {
    const { wrapper } = makeQueryWrapper();

    const { result } = renderHook(() => useOrgMembership(ORG), { wrapper });

    // An empty roster and an unloaded one are indistinguishable to a capability check, so the
    // flag is the only thing that lets a page hold its controls back instead of disabling them.
    expect(result.current.pending).toBe(true);
    expect(result.current.members).toEqual([]);
  });

  it('uses the same keys every roster surface already shares', () => {
    // The point of reading these rather than the composite: they are org-wide, `STALE.static`,
    // and prefetched by the list entries, so arriving from anywhere in the app they are warm.
    expect(orgMembersDef(ORG).queryKey).toEqual(queryKeys.members(ORG));
    expect(orgRolesDef(ORG).queryKey).toEqual(queryKeys.roles(ORG));
  });
});
