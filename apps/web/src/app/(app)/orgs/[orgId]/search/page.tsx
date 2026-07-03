import { use, type JSX } from 'react';

import { SearchClient } from '@/components/search/search-client';

/** Workspace-scoped authenticated search. */
export default function OrgSearchPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  return <SearchClient scope="org" orgId={orgId} />;
}
