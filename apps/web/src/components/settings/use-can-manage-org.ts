'use client';

/**
 * `settings` — resolve whether the current caller can manage the active org.
 *
 * @remarks
 * The Integrations and Vocabulary sections gate their write affordances on whether the caller
 * holds an org-management role (`owner` / `admin`). Before the Settings area was split into
 * routed sub-pages this was resolved once by the parent screen and threaded down as a prop;
 * now that each section is an independent route, this hook re-derives it locally from a
 * lightweight members + roles read.
 *
 * @remarks
 * The read runs on the shared dynamic-data layer ({@link useApiQuery}), so it is cached per org
 * (keyed by {@link queryKeys.members}/{@link queryKeys.roles}), deduped with any sibling reader,
 * and auto-refetched on focus — a role change elsewhere repairs the gate without a reload. A
 * failed read (or no session) resolves to a safe read-only `false` rather than throwing, so
 * non-managers simply see read-only surfaces.
 *
 * @remarks
 * The Members section deliberately does *not* use this hook — it owns a richer members + roles
 * read (for the member list, role options, and self-detection) and computes `canManage` from
 * that same data, avoiding a redundant fetch.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { MemberOut, RoleOut } from '@docket/types';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** The role keys that confer org-management ability. */
const MANAGER_ROLE_KEYS = new Set(['owner', 'admin']);

/** The resolution state of a {@link useCanManageOrg} read. */
export interface CanManageOrg {
  /** Whether the caller holds an `owner` / `admin` role in the org. */
  readonly canManage: boolean;
  /** Whether the management ability is still being resolved. */
  readonly loading: boolean;
}

/**
 * Resolve whether the signed-in caller can manage the given org.
 *
 * @remarks
 * Reads the org's members and roles (cached + deduped via the dynamic-data layer), finds the
 * caller's row, and maps its role `key` to manage/no-manage. The reads are gated on a known
 * session; with no session it resolves to a safe read-only `false` without issuing a request.
 *
 * @param orgId - The active organization id.
 * @returns the resolved {@link CanManageOrg} state.
 *
 * @example
 * ```tsx
 * const { canManage, loading } = useCanManageOrg(orgId);
 * ```
 */
export function useCanManageOrg(orgId: string): CanManageOrg {
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;
  const enabled = Boolean(userId);

  const membersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
      { enabled, staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
      { enabled, staleTime: STALE.static },
    ),
  );

  if (!enabled) {
    return { canManage: false, loading: false };
  }

  const loading = membersQ.isPending || rolesQ.isPending;
  if (loading || membersQ.isError || rolesQ.isError) {
    return { canManage: false, loading };
  }

  // After the pending/error guard above, both reads are in their success state, so `.data` is
  // defined; read the items directly.
  const members: readonly MemberOut[] = membersQ.data.items;
  const roles: readonly RoleOut[] = rolesQ.data.items;
  const me = members.find((m) => m.userId === userId);
  const myRole = me?.roleId ? roles.find((r) => r.id === me.roleId) : null;
  return { canManage: myRole ? MANAGER_ROLE_KEYS.has(myRole.key) : false, loading: false };
}
