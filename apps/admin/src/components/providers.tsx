'use client';

import type { JSX, ReactNode } from 'react';

import { ImpersonationProvider } from '@/components/impersonation';

/** Props for {@link Providers}. */
export interface ProvidersProps {
  /** The application subtree wrapped by every global client provider. */
  children: ReactNode;
}

/**
 * The composed client-side providers for the Docket service-admin console.
 *
 * @remarks
 * Wraps the tree (outermost to innermost) in:
 *
 * 1. The {@link ImpersonationProvider} — tracks the operator's active "viewing as" session
 *    so the persistent banner can render across every route.
 *
 * Both are Client Components, so this file carries the `'use client'` boundary and is
 * mounted once by the root layout. The admin console deliberately omits the product app's
 * org/vocabulary context — it is operator tooling, not a tenant surface.
 */
export function Providers({ children }: ProvidersProps): JSX.Element {
  return <ImpersonationProvider>{children}</ImpersonationProvider>;
}
