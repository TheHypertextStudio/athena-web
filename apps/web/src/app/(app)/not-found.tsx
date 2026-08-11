import type { JSX } from 'react';

import { AppContentFallback } from '@/components/app-content-fallback';

/**
 * The authenticated app group's explicit not-found boundary.
 *
 * @remarks
 * A page that calls `notFound()` lands here beneath the persistent `(app)` layout rather than in
 * Next's root fallback, keeping navigation available for an out-of-date in-app link.
 */
export default function AppRouteNotFound(): JSX.Element {
  return <AppContentFallback kind="not-found" />;
}
