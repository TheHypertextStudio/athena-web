'use client';

import * as React from 'react';

import { Building, ChevronLeft, type LucideIcon } from '../../icons';
import { Button, Text, Tooltip, TooltipContent, TooltipTrigger } from '../../primitives';
import { useContextState } from './ContextProvider';
import { useShellDrawer } from './ShellDrawerContext';
import { SidebarNavItem } from './SidebarNavItem';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import type { HomeNavKey, Workspace, WorkspaceNavKey } from './workspaces';
import type { ResolvedNavigationDestination } from './navigation-catalog';
import {
  NAVIGATION_WORKSPACE_TRANSITION_NAME,
  navigationDestinationTransitionName,
} from './navigation-transition';

/** Props for the full labeled sidebar presentation. */
export interface ExpandedSidebarProps {
  readonly workspaces: readonly Workspace[];
  readonly catalog: readonly ResolvedNavigationDestination[];
  readonly unreadCount?: number | undefined;
  readonly hrefForHome: (key: Exclude<HomeNavKey, 'search'>) => string;
  readonly hrefForWorkspace: (orgId: string, key: WorkspaceNavKey) => string;
  readonly renderLink: (href: string, children: React.ReactNode) => React.ReactNode;
  readonly onSelectWorkspace: (orgId: string) => void;
  readonly onCreateWorkspace: () => void;
  readonly onOpenSearch: () => void;
  readonly onToggle: () => void;
  readonly loading: boolean;
  readonly footer?: React.ReactNode | undefined;
}

function destinationHref(
  destination: ResolvedNavigationDestination,
  activeOrgId: string | null,
  hrefForHome: ExpandedSidebarProps['hrefForHome'],
  hrefForWorkspace: ExpandedSidebarProps['hrefForWorkspace'],
): string | null {
  if (destination.group === 'home') {
    return destination.key === 'search'
      ? null
      : hrefForHome(destination.key as Exclude<HomeNavKey, 'search'>);
  }
  return activeOrgId ? hrefForWorkspace(activeOrgId, destination.key as WorkspaceNavKey) : null;
}

function RowBody({
  icon: Icon,
  label,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
}): React.JSX.Element {
  return (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
}

/** The settled empty workspace treatment for someone who belongs to no workspace. */
function WorkspaceEmpty(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
      <span
        aria-hidden="true"
        className="bg-surface-container-high text-on-surface-variant flex size-9 items-center justify-center rounded-full"
      >
        <Building className="size-5" />
      </span>
      <Text as="p" token="title-small">
        No workspace yet
      </Text>
      <Text as="p" token="body-small" tone="muted">
        Switch into a workspace to see its projects and tasks here.
      </Text>
    </div>
  );
}

/** The browse-oriented sidebar shown on desktop and inside the mobile drawer. */
export function ExpandedSidebar({
  workspaces,
  catalog,
  unreadCount,
  hrefForHome,
  hrefForWorkspace,
  renderLink,
  onSelectWorkspace,
  onCreateWorkspace,
  onOpenSearch,
  onToggle,
  loading,
  footer,
}: ExpandedSidebarProps): React.JSX.Element {
  const { activeOrgId } = useContextState();
  const dismissDrawer = useShellDrawer();
  const homeDestinations = catalog.filter((destination) => destination.group === 'home');
  const workspaceDestinations = catalog.filter((destination) => destination.group === 'workspace');
  const handleNavActivate = React.useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      if (dismissDrawer && (event.target as HTMLElement).closest('a,button')) dismissDrawer();
    },
    [dismissDrawer],
  );

  return (
    <aside
      aria-label="Navigation"
      className="text-on-surface flex h-full w-full shrink-0 flex-col p-2 motion-reduce:transition-none lg:w-60 lg:transition-[width] lg:duration-200 lg:ease-out"
    >
      <div className="flex shrink-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher
            workspaces={workspaces}
            onSelect={onSelectWorkspace}
            onCreate={onCreateWorkspace}
            loading={loading}
            viewTransitionName={NAVIGATION_WORKSPACE_TRANSITION_NAME}
          />
        </div>
        {dismissDrawer === null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                iconOnly
                controlSize="xl"
                aria-label="Collapse navigation"
                aria-pressed={false}
                data-shell-sidebar-toggle="true"
                onClick={onToggle}
                className="text-on-surface-variant hover:text-on-surface hidden shrink-0 lg:inline-flex"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse navigation</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div data-testid="sidebar-scroll-region" className="min-h-0 flex-1 overflow-y-auto">
        <nav
          aria-label="Home"
          className="flex flex-col space-y-0.5 pt-2"
          onClick={handleNavActivate}
        >
          {homeDestinations.map((destination) => {
            const href = destinationHref(destination, activeOrgId, hrefForHome, hrefForWorkspace);
            if (destination.group === 'home' && destination.key === 'search') {
              return (
                <div
                  key={destination.id}
                  style={{
                    viewTransitionName: navigationDestinationTransitionName(destination.id),
                  }}
                >
                  <SidebarNavItem
                    label={destination.label}
                    icon={destination.icon}
                    onSelect={onOpenSearch}
                    disabled={loading}
                  />
                </div>
              );
            }
            if (!href) return null;
            return (
              <div
                key={destination.id}
                style={{ viewTransitionName: navigationDestinationTransitionName(destination.id) }}
              >
                <SidebarNavItem
                  label={destination.label}
                  icon={destination.icon}
                  active={destination.active}
                  badge={destination.id === 'home:inbox' ? unreadCount : undefined}
                  badgeLabel="unread"
                  asChild
                >
                  {renderLink(href, <RowBody icon={destination.icon} label={destination.label} />)}
                </SidebarNavItem>
              </div>
            );
          })}
        </nav>

        <Text as="p" token="title-small" tone="muted" className="mt-4 mb-1 px-3">
          Workspace
        </Text>
        {activeOrgId ? (
          <nav
            aria-label="Workspace"
            className="flex flex-col space-y-0.5"
            onClick={handleNavActivate}
          >
            {workspaceDestinations.map((destination) => {
              const href = destinationHref(destination, activeOrgId, hrefForHome, hrefForWorkspace);
              if (!href) return null;
              const item = (
                <SidebarNavItem
                  key={destination.id}
                  label={destination.label}
                  icon={destination.icon}
                  active={destination.active}
                  asChild
                >
                  {renderLink(href, <RowBody icon={destination.icon} label={destination.label} />)}
                </SidebarNavItem>
              );
              return destination.rail ? (
                <div
                  key={destination.id}
                  style={{
                    viewTransitionName: navigationDestinationTransitionName(destination.id),
                  }}
                >
                  {item}
                </div>
              ) : (
                item
              );
            })}
          </nav>
        ) : loading || workspaces.length > 0 ? (
          <nav aria-label="Workspace" className="flex flex-col space-y-0.5">
            {workspaceDestinations.map((destination) => (
              <SidebarNavItem
                key={destination.id}
                label={destination.label}
                icon={destination.icon}
                disabled
              />
            ))}
          </nav>
        ) : (
          <WorkspaceEmpty />
        )}

        {dismissDrawer !== null && footer ? <div className="pt-2">{footer}</div> : null}
      </div>

      {dismissDrawer === null && footer ? <div className="shrink-0 pt-2">{footer}</div> : null}
    </aside>
  );
}
