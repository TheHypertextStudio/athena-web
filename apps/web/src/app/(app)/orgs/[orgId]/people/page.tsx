'use client';

import { useAppParams } from '@/lib/app-location';

/**
 * `/orgs/[orgId]/people` — the workspace People roster.
 *
 * @remarks
 * A thin route wrapper around {@link PeopleList}, which owns its own data and its own
 * capability gate. The only decision made here is the personal-workspace one: a personal space is
 * an org-of-one, so it has no roster to show and the route redirects to that workspace's Today
 * surface rather than rendering an organizational screen the reader never asked to be in.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useEffect, type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { PeopleList } from '@/components/people/people-list';

/**
 * The People roster page.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns the rendered roster.
 */
export default function PeoplePage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const router = useRouter();
  const { activeOrg } = useActiveOrg();
  const isPersonal = activeOrg?.isPersonal ?? false;

  useEffect(() => {
    if (isPersonal) router.replace(`/orgs/${orgId}/my-work`);
  }, [isPersonal, orgId, router]);

  if (isPersonal) {
    return (
      <p className="text-on-surface-variant text-body-medium p-6" role="status">
        Opening your workspace&hellip;
      </p>
    );
  }

  return <PeopleList orgId={orgId} />;
}
