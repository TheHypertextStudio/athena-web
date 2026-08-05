'use client';

import { useAppParams } from '@/lib/app-location';

/**
 * `/orgs/[orgId]/people/[actorId]` — one person's workspace profile.
 *
 * @remarks
 * The destination every People row leads to, for every person the workspace tracks. A thin route
 * wrapper around {@link PersonProfileView}, which owns the read; the only thing resolved here is
 * whether the caller may edit the workspace's people, which decides whether the name is editable.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { JSX } from 'react';

import { PersonProfileView } from '@/components/people/person-profile';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';

/**
 * The person profile page.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns the rendered profile.
 */
export default function PersonProfilePage(): JSX.Element {
  const { orgId, actorId } = useAppParams<{ orgId: string; actorId: string }>();
  const { canManage } = useCanManageOrg(orgId);
  return <PersonProfileView orgId={orgId} actorId={actorId} canManage={canManage} />;
}
