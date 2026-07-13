import { Suspense, type JSX, type ReactNode } from 'react';

import { AppShellFrame } from '@/components/app-shell-frame';

/**
 * Layout for the authenticated `(app)` route group.
 *
 * @remarks
 * A thin Server Component that wraps every authenticated page in the client
 * {@link AppShellFrame}, which owns the session gate, the org rail/sidebar shell, and the active
 * context. The Suspense boundary is required because that frame reads the current query string to
 * preserve a protected deep link through sign-in. Keeping the layout itself a Server Component
 * avoids forcing the whole group to render on the client while still sharing one shell across
 * `/today`, `/orgs/[orgId]/my-work`, and the project detail.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="bg-surface text-on-surface-variant text-body flex min-h-screen items-center justify-center">
          Loading your workspace…
        </main>
      }
    >
      <AppShellFrame>{children}</AppShellFrame>
    </Suspense>
  );
}
