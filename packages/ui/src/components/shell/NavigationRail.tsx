'use client';

import * as React from 'react';

import { ChevronRight, Ellipsis } from '../../icons';
import { cn } from '../../lib/utils';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../primitives';
import type { HomeNavKey, Workspace, WorkspaceNavKey } from './workspaces';
import { type ResolvedNavigationDestination, selectRailDestinations } from './navigation-catalog';
import {
  NAVIGATION_WORKSPACE_TRANSITION_NAME,
  navigationDestinationTransitionName,
} from './navigation-transition';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/** Props for the shell's compact, labeled Material 3 navigation rail. */
export interface NavigationRailProps {
  readonly workspaces: readonly Workspace[];
  readonly catalog: readonly ResolvedNavigationDestination[];
  readonly activeOrgId: string | null;
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
  hrefForHome: NavigationRailProps['hrefForHome'],
  hrefForWorkspace: NavigationRailProps['hrefForWorkspace'],
): string | null {
  if (destination.group === 'home') {
    return destination.key === 'search'
      ? null
      : hrefForHome(destination.key as Exclude<HomeNavKey, 'search'>);
  }
  return activeOrgId ? hrefForWorkspace(activeOrgId, destination.key as WorkspaceNavKey) : null;
}

function destinationLabel(destination: ResolvedNavigationDestination, unreadCount: number): string {
  if (destination.id === 'home:inbox' && unreadCount > 0) {
    return `${destination.label}, ${unreadCount} unread`;
  }
  return destination.label;
}

function RailDestination({
  destination,
  activeOrgId,
  unreadCount,
  hrefForHome,
  hrefForWorkspace,
  renderLink,
  onOpenSearch,
  loading,
}: Omit<
  NavigationRailProps,
  'workspaces' | 'catalog' | 'onSelectWorkspace' | 'onCreateWorkspace' | 'onToggle' | 'footer'
> & {
  readonly destination: ResolvedNavigationDestination;
}): React.JSX.Element {
  const href = destinationHref(destination, activeOrgId, hrefForHome, hrefForWorkspace);
  const Icon = destination.icon;
  const label = destinationLabel(destination, unreadCount ?? 0);
  const className = cn(
    'text-label-medium focus-visible:ring-ring flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-5',
    destination.active
      ? 'bg-secondary-container text-on-secondary-container'
      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  );
  const content = (
    <>
      <Icon aria-hidden="true" />
      <span className="max-w-full truncate">{destination.label}</span>
    </>
  );

  if (destination.key === 'search' && destination.group === 'home') {
    return (
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        disabled={loading}
        onClick={onOpenSearch}
        className={className}
      >
        {content}
      </Button>
    );
  }

  if (!href || destination.disabled) {
    return (
      <Button type="button" variant="ghost" aria-label={label} disabled className={className}>
        {content}
      </Button>
    );
  }

  return (
    <Button
      asChild
      variant="ghost"
      aria-current={destination.active ? 'page' : undefined}
      aria-label={label}
      className={className}
    >
      {renderLink(href, content)}
    </Button>
  );
}

function MoreDestination({
  destination,
  activeOrgId,
  hrefForHome,
  hrefForWorkspace,
  renderLink,
  onOpenSearch,
}: Pick<
  NavigationRailProps,
  'activeOrgId' | 'hrefForHome' | 'hrefForWorkspace' | 'renderLink' | 'onOpenSearch'
> & {
  readonly destination: ResolvedNavigationDestination;
}): React.JSX.Element {
  const href = destinationHref(destination, activeOrgId, hrefForHome, hrefForWorkspace);
  const Icon = destination.icon;
  if (destination.group === 'home' && destination.key === 'search') {
    return (
      <DropdownMenuItem onSelect={onOpenSearch} selected={destination.active}>
        <Icon aria-hidden="true" className="size-4" />
        {destination.label}
      </DropdownMenuItem>
    );
  }
  if (!href || destination.disabled) {
    return (
      <DropdownMenuItem disabled>
        <Icon aria-hidden="true" className="size-4" />
        {destination.label}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild selected={destination.active}>
      {renderLink(
        href,
        <>
          <Icon aria-hidden="true" className="size-4" />
          {destination.label}
        </>,
      )}
    </DropdownMenuItem>
  );
}

/** A persistent rail that exposes daily navigation and groups all secondary destinations in More. */
export function NavigationRail({
  workspaces,
  catalog,
  activeOrgId,
  unreadCount = 0,
  hrefForHome,
  hrefForWorkspace,
  renderLink,
  onSelectWorkspace,
  onCreateWorkspace,
  onOpenSearch,
  onToggle,
  loading,
  footer,
}: NavigationRailProps): React.JSX.Element {
  const railDestinations = selectRailDestinations(catalog);
  const workspaceMore = catalog.filter(
    (destination) => !destination.rail && destination.moreGroup === 'workspace',
  );
  const manageMore = catalog.filter(
    (destination) => !destination.rail && destination.moreGroup === 'manage',
  );

  return (
    <aside
      aria-label="Navigation"
      className="text-on-surface flex h-full w-full shrink-0 flex-col items-center p-2 motion-reduce:transition-none lg:w-24 lg:transition-[width] lg:duration-200 lg:ease-out"
    >
      <div className="flex w-full shrink-0 flex-col items-center gap-1">
        <WorkspaceSwitcher
          workspaces={workspaces}
          onSelect={onSelectWorkspace}
          onCreate={onCreateWorkspace}
          loading={loading}
          collapsed
          viewTransitionName={NAVIGATION_WORKSPACE_TRANSITION_NAME}
        />
        <Button
          type="button"
          variant="ghost"
          iconOnly
          controlSize="sm"
          aria-label="Expand navigation"
          aria-pressed
          data-shell-sidebar-toggle="true"
          onClick={onToggle}
          className="text-on-surface-variant hover:text-on-surface hidden shrink-0 lg:inline-flex"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <nav aria-label="Primary navigation" className="min-h-0 w-full flex-1 overflow-y-auto pt-2">
        <div className="flex flex-col gap-1">
          {railDestinations.map((destination) => (
            <div
              key={destination.id}
              style={{ viewTransitionName: navigationDestinationTransitionName(destination.id) }}
            >
              <RailDestination
                destination={destination}
                activeOrgId={activeOrgId}
                unreadCount={unreadCount}
                hrefForHome={hrefForHome}
                hrefForWorkspace={hrefForWorkspace}
                renderLink={renderLink}
                onOpenSearch={onOpenSearch}
                loading={loading}
              />
            </div>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="More navigation"
                className="text-label-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-5"
              >
                <Ellipsis aria-hidden="true" />
                <span>More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" width="lg" sections="divider">
              <DropdownMenuLabel>Workspace</DropdownMenuLabel>
              <DropdownMenuGroup aria-label="Workspace">
                {workspaceMore.map((destination) => (
                  <MoreDestination
                    key={destination.id}
                    destination={destination}
                    activeOrgId={activeOrgId}
                    hrefForHome={hrefForHome}
                    hrefForWorkspace={hrefForWorkspace}
                    renderLink={renderLink}
                    onOpenSearch={onOpenSearch}
                  />
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Manage</DropdownMenuLabel>
              <DropdownMenuGroup aria-label="Manage">
                {manageMore.map((destination) => (
                  <MoreDestination
                    key={destination.id}
                    destination={destination}
                    activeOrgId={activeOrgId}
                    hrefForHome={hrefForHome}
                    hrefForWorkspace={hrefForWorkspace}
                    renderLink={renderLink}
                    onOpenSearch={onOpenSearch}
                  />
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      {footer ? <div className="w-full shrink-0 pt-2">{footer}</div> : null}
    </aside>
  );
}
