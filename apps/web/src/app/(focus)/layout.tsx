/** Authenticated, query-hydrated route group without the application shell. */
import { HydrationBoundary } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { type JSX, type ReactNode } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';
import { readServerSession } from '@/lib/server-session';

/** Protect and hydrate immersive routes while deliberately omitting `AppShellFrame`. */
export default async function FocusGroupLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const session = await readServerSession();
  const serverPath = (await headers()).get('x-docket-pathname') ?? '/focus';
  if (session.state === 'signed-out') {
    redirect(`/sign-in?${new URLSearchParams({ callbackURL: serverPath }).toString()}`);
  }

  const queryClient = getServerQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: queryKeys.orgs(),
    queryFn: () => unwrap(() => api.v1.orgs.$get(), 'Could not load your organizations.'),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="bg-surface text-on-surface min-h-dvh">{children}</div>
    </HydrationBoundary>
  );
}
