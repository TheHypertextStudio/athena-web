'use client';

/**
 * `@docket/ui` — the top-level app shell layout.
 *
 * @remarks
 * Composes the persistent shell regions — the single integrated {@link Sidebar}, an optional
 * multi-document {@link TabBar} above the content, and the main content area — and applies the
 * active org's accent on every context rebind. The accent (from `getOrgAccent`, surfaced by
 * {@link useContextState}) is set inline as the `--org-accent` CSS variable, and the current
 * layout density is reflected via the `data-density` attribute, so descendants can theme to
 * the active org and density without prop drilling.
 *
 * The shell takes the sidebar and tab-bar as nodes rather than rebuilding them, so the host
 * app owns the routing/store wiring while the shell owns the layout and the accent rebinding.
 * {@link AppShell} reads context state and so must be rendered inside a `ContextProvider`.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { useContextState } from './ContextProvider';

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** The single integrated navigation {@link Sidebar} (host-wired). */
  sidebar: React.ReactNode;
  /** The optional multi-document {@link TabBar}, rendered above the content. */
  tabBar?: React.ReactNode;
  /** Extra class names for the root shell element. */
  className?: string;
  /** The main-area content. */
  children: React.ReactNode;
}

/**
 * The Docket app shell: Sidebar + TabBar + main, with org-accent rebinding.
 *
 * @remarks
 * On context rebind the active org's accent is applied as `--org-accent` on the shell root
 * and `data-density` reflects the current density, so the bound org is visually unambiguous
 * throughout the subtree.
 */
export function AppShell({
  sidebar,
  tabBar,
  className,
  children,
}: AppShellProps): React.JSX.Element {
  const { orgAccent, density } = useContextState();

  return (
    <div
      data-density={density}
      style={orgAccent ? ({ '--org-accent': orgAccent } as React.CSSProperties) : undefined}
      className={cn(
        'bg-background text-foreground flex h-screen w-full overflow-hidden',
        className,
      )}
    >
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {tabBar}
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
