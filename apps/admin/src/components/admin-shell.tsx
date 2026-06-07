'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useState } from 'react';

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
 */
export function AdminShell({ children }: AdminShellProps): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  /** Sign the operator out and return to the sign-in screen. */
  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    await signOut();
    router.push('/sign-in');
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <aside className="border-border bg-card flex w-60 shrink-0 flex-col gap-6 border-r px-4 py-6">
        <div className="px-2">
          <p className="text-sm font-semibold tracking-tight">Docket</p>
          <p className="text-muted-foreground text-xs">Service admin</p>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                isActive(pathname, item.href)
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-1">
          {session?.user.email ? (
            <p className="text-muted-foreground truncate text-xs" title={session.user.email}>
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
      <div className="flex min-w-0 flex-1 flex-col">
        <ViewingAsBanner />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
