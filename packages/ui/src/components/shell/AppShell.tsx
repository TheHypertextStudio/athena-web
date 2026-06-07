'use client';

/**
 * `@docket/ui` — the top-level app shell layout.
 *
 * @remarks
 * Composes the three persistent shell regions — the {@link GlobalRail} (org switcher), the
 * {@link ContextSidebar} (org-scoped nav), and the main content area — and applies the
 * active org's accent on every context rebind. The accent (from `getOrgAccent`, surfaced by
 * {@link useContextState}) is set inline as the `--org-accent` CSS variable, and the current
 * layout density is reflected via the `data-density` attribute, so descendants can theme to
 * the active org and density without prop drilling.
 *
 * {@link AppShell} reads context state and so must be rendered inside a `ContextProvider`;
 * to skin entity nouns, also wrap it (or its consumers) in a `VocabularyProvider`.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { ContextSidebar, type SidebarNavKey } from './ContextSidebar';
import { useContextState } from './ContextProvider';
import { GlobalRail, type HubRailKey, type RailOrg } from './GlobalRail';

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** The orgs to render in the {@link GlobalRail}. */
  orgs: readonly RailOrg[];
  /** The currently-active sidebar nav key. */
  activeNavKey?: SidebarNavKey;
  /** The active Hub rail destination (highlights Inbox/Portfolio in the rail). */
  activeHubKey?: HubRailKey;
  /** The caller's cross-org unread count, surfaced as the rail's Inbox badge. */
  unreadCount?: number;
  /** Invoked when a {@link ContextSidebar} row is selected. */
  onNavigate?: (key: SidebarNavKey) => void;
  /** Invoked when a Hub destination (Inbox/Portfolio) is selected from the rail. */
  onNavigateHub?: (key: HubRailKey) => void;
  /** Invoked when an org avatar is selected from the rail (host navigates to that org). */
  onSelectOrg?: (orgId: string) => void;
  /** Invoked when the rail's Hub (Today) button is pressed. */
  onSelectHome?: () => void;
  /** Invoked when the rail's Search entry is selected (opens the command palette). */
  onOpenSearch?: () => void;
  /** Invoked when the user requests to add/join an org from the rail. */
  onAddOrg?: () => void;
  /** Extra class names for the root shell element. */
  className?: string;
  /** The main-area content. */
  children: React.ReactNode;
}

/**
 * The Docket app shell: GlobalRail + ContextSidebar + main, with org-accent rebinding.
 *
 * @remarks
 * On context rebind the active org's accent is applied as `--org-accent` on the shell root
 * and `data-density` reflects the current density, so the bound org is visually
 * unambiguous throughout the subtree.
 */
export function AppShell({
  orgs,
  activeNavKey,
  activeHubKey,
  unreadCount,
  onNavigate,
  onNavigateHub,
  onSelectOrg,
  onSelectHome,
  onOpenSearch,
  onAddOrg,
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
      <GlobalRail
        orgs={orgs}
        activeHubKey={activeHubKey}
        unreadCount={unreadCount}
        onNavigate={onNavigateHub}
        onSelectOrg={onSelectOrg}
        onSelectHome={onSelectHome}
        onOpenSearch={onOpenSearch}
        onAddOrg={onAddOrg}
      />
      <ContextSidebar activeKey={activeNavKey} onNavigate={onNavigate} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
