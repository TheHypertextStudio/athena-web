import type { JSX, ReactNode } from 'react';

import { AppShellFrame } from '@/components/app-shell-frame';

/**
 * Layout for the authenticated `(app)` route group.
 *
 * @remarks
 * A thin Server Component that wraps every authenticated page in the client
 * {@link AppShellFrame}, which owns the session gate, the org rail/sidebar shell, and the
 * active context. Keeping the layout itself a Server Component (the frame carries the
 * `'use client'` boundary) avoids forcing the whole group to render on the client at the
 * layout level while still sharing one shell across `/today`, `/orgs/[orgId]/my-work`, and
 * the project detail.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }): JSX.Element {
  return <AppShellFrame>{children}</AppShellFrame>;
}
