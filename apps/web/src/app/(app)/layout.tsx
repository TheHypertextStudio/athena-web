import { type JSX, type ReactNode } from 'react';

import { AppShellFrame } from '@/components/app-shell-frame';

/**
 * Layout for the authenticated `(app)` route group.
 *
 * @remarks
 * A thin Server Component that wraps every authenticated page in the one persistent client
 * {@link AppShellFrame}. Session, workspace, and page loading update regions inside that shared
 * shell; the layout itself is never replaced by a loading or Suspense fallback.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }): JSX.Element {
  return <AppShellFrame>{children}</AppShellFrame>;
}
