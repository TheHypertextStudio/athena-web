'use client';

/**
 * `@docket/ui` — the shell navigation adapter.
 *
 * The host supplies routes and workspace actions. This component resolves vocabulary once, builds
 * the shared catalog once, and selects the full browse sidebar or compact Material 3 rail.
 */
import * as React from 'react';

import { TooltipProvider } from '../../primitives';
import { useVocabulary } from '../../hooks/useVocabulary';
import { useContextState } from './ContextProvider';
import { useShellDrawer } from './ShellDrawerContext';
import { useShellSidebar } from './ShellSidebarContext';
import { ExpandedSidebar } from './ExpandedSidebar';
import { NavigationRail } from './NavigationRail';
import { resolveNavigationCatalog } from './navigation-catalog';
import type { HomeNavKey, Workspace, WorkspaceNavKey } from './workspaces';

/** Props supplied by the application shell to every navigation presentation. */
export interface SidebarProps {
  readonly workspaces: readonly Workspace[];
  readonly activeHomeKey?: HomeNavKey | undefined;
  readonly activeWorkspaceKey?: WorkspaceNavKey | undefined;
  readonly unreadCount?: number | undefined;
  readonly hrefForHome: (key: Exclude<HomeNavKey, 'search'>) => string;
  readonly hrefForWorkspace: (orgId: string, key: WorkspaceNavKey) => string;
  readonly renderLink: (href: string, children: React.ReactNode) => React.ReactNode;
  readonly onSelectWorkspace: (orgId: string) => void;
  readonly onCreateWorkspace: () => void;
  readonly onOpenSearch: () => void;
  readonly loading?: boolean | undefined;
  readonly personalWorkspace?: boolean | undefined;
  readonly footer?: React.ReactNode | undefined;
}

/** Select the full browse sidebar or compact rail without duplicating the navigation model. */
export function Sidebar({
  workspaces,
  activeHomeKey,
  activeWorkspaceKey,
  unreadCount,
  hrefForHome,
  hrefForWorkspace,
  renderLink,
  onSelectWorkspace,
  onCreateWorkspace,
  onOpenSearch,
  loading = false,
  personalWorkspace = false,
  footer,
}: SidebarProps): React.JSX.Element {
  const { activeOrgId } = useContextState();
  const dismissDrawer = useShellDrawer();
  const { collapsed: shellCollapsed, onToggle } = useShellSidebar();
  const collapsed = shellCollapsed && dismissDrawer === null;
  const initiatives = useVocabulary('initiative', { plural: true });
  const programs = useVocabulary('program', { plural: true });
  const projects = useVocabulary('project', { plural: true });
  const cycles = useVocabulary('cycle', { plural: true });
  const teams = useVocabulary('team', { plural: true });
  const catalog = React.useMemo(
    () =>
      resolveNavigationCatalog({
        activeHomeKey,
        activeWorkspaceKey,
        activeOrgId,
        personalWorkspace,
        vocabulary: { initiatives, programs, projects, cycles, teams },
      }),
    [
      activeHomeKey,
      activeOrgId,
      activeWorkspaceKey,
      cycles,
      initiatives,
      personalWorkspace,
      programs,
      projects,
      teams,
    ],
  );

  return (
    <TooltipProvider>
      {collapsed ? (
        <NavigationRail
          workspaces={workspaces}
          catalog={catalog}
          activeOrgId={activeOrgId}
          unreadCount={unreadCount}
          hrefForHome={hrefForHome}
          hrefForWorkspace={hrefForWorkspace}
          renderLink={renderLink}
          onSelectWorkspace={onSelectWorkspace}
          onCreateWorkspace={onCreateWorkspace}
          onOpenSearch={onOpenSearch}
          onToggle={onToggle}
          loading={loading}
          footer={footer}
        />
      ) : (
        <ExpandedSidebar
          workspaces={workspaces}
          catalog={catalog}
          unreadCount={unreadCount}
          hrefForHome={hrefForHome}
          hrefForWorkspace={hrefForWorkspace}
          renderLink={renderLink}
          onSelectWorkspace={onSelectWorkspace}
          onCreateWorkspace={onCreateWorkspace}
          onOpenSearch={onOpenSearch}
          onToggle={onToggle}
          loading={loading}
          footer={footer}
        />
      )}
    </TooltipProvider>
  );
}
