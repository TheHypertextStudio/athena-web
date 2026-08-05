import type { JSX } from 'react';

import HubSearchClient from './hub-search-client';

/** Cross-workspace authenticated search. */
export default function SearchPage(): JSX.Element {
  return <HubSearchClient />;
}
