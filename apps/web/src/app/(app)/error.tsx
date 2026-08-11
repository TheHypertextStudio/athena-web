'use client';

import type { JSX } from 'react';

import { AppContentFallback } from '@/components/app-content-fallback';

/**
 * The authenticated app group's uncaught-route error boundary.
 *
 * @remarks
 * Next renders this inside `(app)`'s layout, so {@link AppContentFallback} replaces only the
 * failed page beneath `AppShellFrame`. The error object is intentionally not read, logged, or
 * rendered: it can carry server or provider detail, while the recovery copy must stay owned by
 * Docket.
 */
export default function AppRouteError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}): JSX.Element {
  return <AppContentFallback kind="error" onRetry={reset} />;
}
