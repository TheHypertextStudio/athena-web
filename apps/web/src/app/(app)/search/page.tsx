import type { JSX } from 'react';

import { SearchClient } from '@/components/search/search-client';

/** Cross-workspace authenticated search. */
export default function SearchPage(): JSX.Element {
  return <SearchClient scope="hub" />;
}
