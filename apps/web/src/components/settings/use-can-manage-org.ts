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
 * The Members section deliberately does *not* use this hook — it owns a richer members + roles
 * read (for the member list, role options, and self-detection) and computes `canManage` from
 * that same data, avoiding a redundant fetch.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { MemberOut, RoleOut } from '@docket/types';
import { useEffect, useState } from 'react';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';

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
 * Reads the org's members and roles once per `orgId` change, finds the caller's row, and maps
 * its role `key` to manage/no-manage. A failed read (or no session) resolves to a safe
 * read-only `false` rather than throwing — non-managers simply see read-only surfaces.
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

  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const live = { current: true };
    setLoading(true);
    void (async () => {
      if (!userId) {
        if (live.current) {
          setCanManage(false);
          setLoading(false);
        }
        return;
      }
      try {
        const [membersRes, rolesRes] = await Promise.all([
          api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
        ]);
        if (!membersRes.ok || !rolesRes.ok) {
          if (live.current) setCanManage(false);
          return;
        }
        const members: readonly MemberOut[] = (await membersRes.json()).items;
        const roles: readonly RoleOut[] = (await rolesRes.json()).items;
        const me = members.find((m) => m.userId === userId);
        const myRole = me?.roleId ? roles.find((r) => r.id === me.roleId) : null;
        if (live.current) setCanManage(myRole ? MANAGER_ROLE_KEYS.has(myRole.key) : false);
      } catch {
        if (live.current) setCanManage(false);
      } finally {
        if (live.current) setLoading(false);
      }
    })();
    return () => {
      live.current = false;
    };
  }, [orgId, userId]);

  return { canManage, loading };
}
