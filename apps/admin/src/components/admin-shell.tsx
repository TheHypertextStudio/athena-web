'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useEffect, useState } from 'react';

import { ViewingAsBanner } from '@/components/viewing-as-banner';
import { signOut, useSession } from '@/lib/auth-client';

/** A single primary navigation entry in the admin shell. */
interface NavItem {
  /** The route the entry links to. */
  href: string;
  /** The entry's display label. */
  label: string;
}

/** The admin console's primary navigation, in display order. */
const NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/users', label: 'Users' },
  { href: '/orgs', label: 'Organizations' },
  { href: '/lifecycle', label: 'Lifecycle' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/audit', label: 'Audit log' },
];

/** Whether `pathname` is within the section rooted at `href`. */
function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Props for {@link AdminShell}. */
export interface AdminShellProps {
  /** The routed page content rendered in the main column. */
  children: ReactNode;
}

/**
 * The persistent operator shell: a fixed sidebar nav, the active-session banner, and the
 * routed content column.
 *
 * @remarks
 * A Client Component (it reads the reactive session and the current pathname). The
 * sign-in route renders without this shell — it is mounted only by the authenticated
 * route group's layout. The session line shows the signed-in operator's email and a
 * sign-out action that returns to `/sign-in`. The {@link ViewingAsBanner} is pinned above
 * the content so an active impersonation is always visible.
 *
 * @remarks Visual model — the same MD3 tonal surface system the product app uses. The shell root
 * is the tinted `surface-container` canvas; the sidebar blends into it with no hard divider; the
 * routed content sits in a single floating, rounded `surface` panel inset by a uniform gutter.
 *
 * @remarks Auth — when the reactive session resolves to "signed out" the shell redirects to
 * `/sign-in` rather than stranding an unauthenticated visitor on inert chrome. A signed-in but
 * non-staff visitor keeps the shell (they have a session) and the API's 403 surfaces inline on
 * each screen with a recovery action.
 */
export function AdminShell({ children }: AdminShellProps): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  // Redirect to sign-in once the session resolves to "signed out" — an unauthenticated visitor
  // has no usable destination in the shell, so surface the sign-in screen instead of inert chrome.
  useEffect(() => {
    if (!isPending && !session) router.replace('/sign-in');
  }, [isPending, session, router]);

  /** Sign the operator out and return to the sign-in screen. */
  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    await signOut();
    router.push('/sign-in');
  }

  return (
    <div className="bg-surface-container text-on-surface flex min-h-screen gap-2 p-2">
      <aside className="flex w-60 shrink-0 flex-col gap-6 px-2 py-4">
        <div className="px-2">
          <p className="text-on-surface text-body-medium font-semibold tracking-tight">Docket</p>
          <p className="text-on-surface-variant text-xs">Service admin</p>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={`focus-visible:ring-ring text-body-medium rounded-lg px-3 py-2 transition-colors focus-visible:ring-1 focus-visible:outline-none ${
                isActive(pathname, item.href)
                  ? 'bg-surface-container-highest text-on-surface font-medium'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-1">
          {session?.user.email ? (
            <p className="text-on-surface-variant truncate text-xs" title={session.user.email}>
              {session.user.email}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </aside>
      <div className="bg-surface border-outline-variant flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm">
        <ViewingAsBanner />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
