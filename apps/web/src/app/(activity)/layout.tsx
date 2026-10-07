import { HydrationBoundary } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { JSX, ReactNode } from 'react';
import { ActivityProviders } from '@/components/activity-providers';
import { AppProviders } from '@/components/app-providers';
import { AutomaticLocationProvider } from '@/components/work-location/automatic-location-provider';
import { AppLocationProvider } from '@/lib/app-location';
import { unwrap } from '@/lib/query-core';
import { fetchAllOrganizations } from '@/lib/org-collection-pages';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';
import { readServerSession } from '@/lib/server-session';

/** Protect independent activities and hydrate their data without mounting the application shell. */
export default async function ActivityGroupLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  const session = await readServerSession();
  const serverPath = (await headers()).get('x-docket-pathname') ?? '/plan/day';
  if (session.state === 'signed-out')
    redirect(`/sign-in?${new URLSearchParams({ callbackURL: serverPath }).toString()}`);
  const queryClient = getServerQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: queryKeys.orgs(),
    queryFn: () => unwrap(() => fetchAllOrganizations(api), 'Could not load your organizations.'),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AppLocationProvider serverPath={serverPath} navigationContext="activity">
        <AppProviders>
          <AutomaticLocationProvider>
            <ActivityProviders
              initialSession={session.state === 'authenticated' ? session.user : null}
            >
              {children}
            </ActivityProviders>
          </AutomaticLocationProvider>
        </AppProviders>
      </AppLocationProvider>
    </HydrationBoundary>
  );
}
