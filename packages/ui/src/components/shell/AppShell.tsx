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
 *
 * @remarks Visual model — an MD3 tonal surface system. The shell root is the tinted **canvas**
 * (`surface-container`); the {@link Sidebar} and the `<main>` content are **floating rounded
 * surface panels** (`surface`) inset from the window edges by a uniform gutter applied here
 * (so spacing stays consistent — panels never set their own outer margins). The optional
 * {@link TabBar} sits in its **own bar on the canvas** above the main panel — its active tab
 * shares the panel's tone so the two read as one continuous surface.
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
        // The tinted MD3 canvas: the whole app sits on `surface-container`, with a uniform
        // gutter (p-2) so the sidebar + content panels float inset from the window edges.
        'bg-surface-container text-on-surface flex h-screen w-full gap-2 overflow-hidden p-2',
        className,
      )}
    >
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {tabBar}
        <main className="bg-surface border-outline-variant min-h-0 flex-1 overflow-auto rounded-xl border shadow-sm">
          {children}
        </main>
      </div>
    </div>
  );
}
