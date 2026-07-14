'use client';

import { useActiveOrg } from '@/components/active-org';

/** Resolve the caller's user-owned personal workspace for legacy data surfaces. */
export function usePersonalWorkspaceId(): string | null {
  const { orgs } = useActiveOrg();
  return orgs.find((org) => org.isPersonal)?.id ?? null;
}
