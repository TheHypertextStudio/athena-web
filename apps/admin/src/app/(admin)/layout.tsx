import type { JSX, ReactNode } from 'react';

import { AdminShell } from '@/components/admin-shell';

/**
 * Layout for the authenticated operator route group.
 *
 * @remarks
 * Wraps every staff-gated screen in the {@link AdminShell} (sidebar nav, session line, and
 * the persistent "viewing as" banner). The sign-in route lives in the sibling `(auth)`
 * group and renders without the shell. Auth itself is enforced by the API — each
 * `hc<AppType>` call rides the session cookie and the admin routes 403 when the caller is
 * not staff; screens surface that 403 inline.
 */
export default function AdminGroupLayout({ children }: { children: ReactNode }): JSX.Element {
  return <AdminShell>{children}</AdminShell>;
}
