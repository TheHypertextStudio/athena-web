'use client';

import { AppShell, ContextProvider, InlineBanner, PageScrollProvider } from '@docket/ui/components';
import { usePathname, useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useCallback, useEffect, useState } from 'react';

import { AdminSidebar } from '@/components/admin-sidebar';
import { ViewingAsBanner } from '@/components/viewing-as-banner';
import { signOut, useSession } from '@/lib/auth-client';
import { useAdminQueues } from '@/lib/use-admin-queues';
import { useOperator } from '@/lib/use-operator';

/** Props for {@link AdminShell}. */
export interface AdminShellProps {
  /** The routed page content rendered in the main column. */
  children: ReactNode;
}

/**
 * The persistent operator shell.
 *
 * @remarks
 * Built on the product app's {@link AppShell} rather than a bespoke layout, so the console inherits
 * one implementation of everything a shell has to get right: the MD3 tonal model (a tinted canvas,
 * a canvas-blended sidebar, and the routed content as the single floating rounded surface panel),
 * the responsive frame (a static sidebar at `lg` and up; below that a slim top bar whose hamburger
 * opens the *same* sidebar as a focus-trapped off-canvas drawer), the container-query context that
 * lets pages lay out against the panel's real width rather than the viewport's, and the guaranteed
 * minimum share of the window that `<main>` is entitled to.
 *
 * `AppShell` takes its sidebar as a node, so the console supplies {@link AdminSidebar} while the
 * shell owns the layout. The product's own `Sidebar` is not reusable here — it is built around
 * workspaces, org vocabulary, and tenant nav keys, none of which an operator console has.
 *
 * `AppShell` reads context state for the org accent and density, so it is mounted inside a
 * {@link ContextProvider}. The console binds no org: it is service-wide tooling, so there is no
 * tenant accent to apply and the shell renders in the neutral palette.
 *
 * @remarks Auth — when the reactive session resolves to "signed out" the shell redirects to
 * `/sign-in` rather than stranding an unauthenticated visitor on inert chrome. A signed-in but
 * non-staff visitor keeps the shell (they have a session) and the API's 403 surfaces inline on each
 * screen with a recovery action.
 */
export function AdminShell({ children }: AdminShellProps): JSX.Element {
  return (
    <ContextProvider>
      <PageScrollProvider>
        <AdminShellFrame>{children}</AdminShellFrame>
      </PageScrollProvider>
    </ContextProvider>
  );
}

/** The shell's wiring, split out so it can read the shell contexts its parent establishes. */
function AdminShellFrame({ children }: AdminShellProps): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const queues = useAdminQueues();
  const { tierLabel } = useOperator();

  // Redirect to sign-in once the session resolves to "signed out" — an unauthenticated visitor has
  // no usable destination in the shell, so surface the sign-in screen instead of inert chrome.
  useEffect(() => {
    if (!isPending && !session) router.replace('/sign-in');
  }, [isPending, session, router]);

  const handleSignOut = useCallback((): void => {
    if (!session || signingOut) return;
    setSignOutError(null);
    setSigningOut(true);
    void (async () => {
      try {
        await signOut(session.user.id);
        router.push('/sign-in');
      } catch {
        // A sign-out that failed leaves the operator signed in. Saying so is the point: silently
        // resetting the button would read as success and leave a live session on a shared machine.
        setSignOutError('Could not sign out. Check your connection and try again.');
      } finally {
        setSigningOut(false);
      }
    })();
  }, [session, signingOut, router]);

  return (
    <AppShell
      sidebar={
        <AdminSidebar
          pathname={pathname}
          queues={queues}
          email={session?.user.email ?? null}
          tier={tierLabel}
          signingOut={signingOut}
          onSignOut={handleSignOut}
        />
      }
      banner={
        <>
          <ViewingAsBanner />
          {signOutError ? (
            // The shell's banner slot, not the sidebar: a collapsed rail is too narrow to carry a
            // sentence, and a failure the operator cannot see reads exactly like success.
            <InlineBanner
              tone="critical"
              title="Sign-out failed"
              action={{ label: 'Try again', onSelect: handleSignOut }}
            >
              {signOutError}
            </InlineBanner>
          ) : null}
        </>
      }
      mobileBrand="Docket service admin"
    >
      {children}
    </AppShell>
  );
}
