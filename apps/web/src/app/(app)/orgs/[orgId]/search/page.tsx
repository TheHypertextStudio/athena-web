import type { JSX } from 'react';

import OrgSearchClient from './org-search-client';

/** Workspace-scoped authenticated search. */
export default function OrgSearchPage(): JSX.Element {
  return <OrgSearchClient />;
}
