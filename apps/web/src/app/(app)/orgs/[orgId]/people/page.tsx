'use client';
import type { JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { PeopleList } from '@/components/people/people-list';
/** Show all tracked people, including in personal workspaces. */
export default function PeoplePage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/people');
  return <PeopleList orgId={orgId} />;
}
