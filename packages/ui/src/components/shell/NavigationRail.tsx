'use client';

import * as React from 'react';

import { ChevronRight } from '../../icons';
import { cn } from '../../lib/utils';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '../../primitives';
import { IdentityGlyph } from '../atoms/IdentityGlyph';
import type { HomeNavKey, Workspace, WorkspaceNavKey } from './workspaces';
import { type ResolvedNavigationDestination, selectRailDestinations } from './navigation-catalog';
import {
  NAVIGATION_WORKSPACE_TRANSITION_NAME,
  navigationDestinationTransitionName,
} from './navigation-transition';
import { tabLabel, TYPE_ICON, type OpenTab } from './tab-types';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/** Props for the shell's compact, labeled Material 3 navigation rail. */
export interface NavigationRailProps {
  readonly workspaces: readonly Workspace[];
  readonly catalog: readonly ResolvedNavigationDestination[];
  readonly activeOrgId: string | null;
  readonly unreadCount?: number | undefined;
  readonly recentDocuments: readonly OpenTab[];
  readonly activeDocumentKey?: string | undefined;
  /** Render a document's product-owned identity, including its tonal background. */
  readonly renderRecentDocumentIcon?: ((document: OpenTab) => React.ReactNode) | undefined;
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
  | 'workspaces'
  | 'catalog'
  | 'recentDocuments'
  | 'activeDocumentKey'
  | 'renderRecentDocumentIcon'
  | 'onSelectWorkspace'
  | 'onCreateWorkspace'
  | 'onToggle'
  | 'footer'
> & {
  readonly destination: ResolvedNavigationDestination;
}): React.JSX.Element {
  const href = destinationHref(destination, activeOrgId, hrefForHome, hrefForWorkspace);
  const Icon = destination.icon;
  const label = destinationLabel(destination, unreadCount ?? 0);
  const className = cn(
    'group text-label-medium mx-auto flex min-h-14 w-16 flex-col items-center justify-center gap-1 rounded-none px-1 text-center hover:bg-transparent focus-visible:ring-0 focus-visible:outline-none',
  );
  const content = (
    <>
      <span
        data-slot="navigation-rail-active-indicator"
        className={cn(
          'group-focus-visible:outline-secondary relative flex h-8 w-14 shrink-0 items-center justify-center rounded-full transition-colors duration-(--dur-fast) ease-(--ease-out) group-focus-visible:outline-3 group-focus-visible:outline-offset-2',
          destination.active
            ? 'bg-secondary-container text-on-secondary-container'
            : 'text-on-surface-variant',
        )}
      >
        <span
          data-slot="navigation-rail-state-layer"
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full transition-opacity duration-(--dur-fast) ease-(--ease-out)',
            destination.active
              ? 'bg-primary opacity-0 group-hover:opacity-4 group-focus-visible:opacity-12 group-hover:group-focus-visible:opacity-16 group-active:opacity-8'
              : 'bg-on-surface opacity-0 group-hover:opacity-4 group-focus-visible:opacity-12 group-hover:group-focus-visible:opacity-16 group-active:opacity-8',
          )}
        />
        <Icon aria-hidden="true" className="relative size-6" />
      </span>
      <span
        data-slot="navigation-rail-label"
        className={cn(
          'max-w-full truncate',
          destination.active ? 'text-secondary' : 'text-on-surface-variant',
        )}
      >
        {destination.label}
      </span>
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

/** A persistent rail that exposes daily navigation and expands to the complete destination list. */
export function NavigationRail({
  workspaces,
  catalog,
  activeOrgId,
  unreadCount = 0,
  recentDocuments,
  activeDocumentKey,
  renderRecentDocumentIcon,
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

  return (
    <aside
      aria-label="Navigation"
      className="text-on-surface flex h-full w-full shrink-0 flex-col items-center px-0 py-2 motion-reduce:transition-none lg:w-16 lg:transition-[width] lg:duration-200 lg:ease-out"
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
          controlSize="xl"
          aria-label="Expand navigation"
          aria-pressed
          data-shell-sidebar-toggle="true"
          onClick={onToggle}
          className="text-on-surface-variant hover:text-on-surface hidden shrink-0 lg:inline-flex"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <div
        data-slot="navigation-rail-scroll-region"
        className="-mx-px min-h-0 w-16.5 flex-1 overflow-y-auto pt-2"
      >
        <nav aria-label="Primary navigation" className="w-full">
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
          </div>
        </nav>

        {recentDocuments.length > 0 ? (
          <nav
            aria-label="Recent"
            className="border-outline-variant mx-2 mt-2 flex flex-col items-center gap-1 border-t pt-2"
          >
            {recentDocuments.slice(0, 3).map((document) => {
              const Icon = TYPE_ICON[document.type];
              const renderedIdentity = renderRecentDocumentIcon?.(document);
              const label = tabLabel(document);
              const active = document.key === activeDocumentKey;
              return (
                <Tooltip key={document.key}>
                  <TooltipTrigger asChild>
                    <Button
                      asChild
                      variant="ghost"
                      iconOnly
                      controlSize="xl"
                      aria-label={`Recent: ${label}`}
                      aria-current={active ? 'page' : undefined}
                      data-slot="recent-navigation-item"
                      className={cn(
                        'shrink-0 rounded-lg',
                        active
                          ? 'bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80'
                          : 'text-on-surface-variant hover:text-on-surface',
                      )}
                    >
                      {renderLink(
                        document.href,
                        renderedIdentity ?? (
                          <IdentityGlyph size={32} className="[&_svg]:size-4!">
                            <Icon aria-hidden="true" />
                          </IdentityGlyph>
                        ),
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        ) : null}
      </div>

      {footer ? <div className="w-full shrink-0 pt-2">{footer}</div> : null}
    </aside>
  );
}
