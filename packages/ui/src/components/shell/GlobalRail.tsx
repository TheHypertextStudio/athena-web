'use client';

/**
 * `@docket/ui` — the persistent left-edge org rail.
 *
 * @remarks
 * The {@link GlobalRail} is always visible and, per mvp-plan §7, leads with the caller's
 * cross-org Hub destinations — **Hub (Today) · Inbox · Portfolio · Search** — followed by one
 * {@link RailOrgAvatar} per membership and an {@link AddOrgButton} at the bottom. Selecting
 * the Hub or an org rebinds the active context via {@link useContextState} (which propagates
 * the org accent and density to the rest of the shell); the Inbox/Portfolio entries report
 * Hub-level navigation through {@link GlobalRailProps.onNavigate}, and Search opens the
 * command palette via {@link GlobalRailProps.onOpenSearch}. The Inbox carries an attention
 * badge for the caller's cross-org unread count.
 */
import * as React from 'react';

import { GanttChart, Home, Inbox, Plus, Search } from '../../icons';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives';
import { HUB_CONTEXT, useContextState } from './ContextProvider';
import { RailNavButton } from './RailNavButton';
import { RailOrgAvatar } from './RailOrgAvatar';

/** A single org membership rendered in the {@link GlobalRail}. */
export interface RailOrg {
  /** The org's id. */
  id: string;
  /** The org's display name. */
  name: string;
  /** Optional avatar image URL. */
  avatar?: string | null;
}

/**
 * The Hub-level (cross-org) destinations reachable from the rail's top cluster.
 *
 * @remarks
 * `today` is owned by the context binding (the Hub button), so it is not a navigation key
 * here; `inbox` and `portfolio` are the host-routed Hub destinations, and `search` is not a
 * route but the command-palette opener.
 */
export type HubRailKey = 'inbox' | 'portfolio';

/** Props for {@link AddOrgButton}. */
export interface AddOrgButtonProps {
  /** Invoked when the user requests to add/join an org. */
  onAddOrg?: () => void;
}

/** The "add organization" affordance at the foot of the {@link GlobalRail}. */
export function AddOrgButton({ onAddOrg }: AddOrgButtonProps): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Add organization"
      title="Add organization"
      onClick={onAddOrg}
      className="border-border text-muted-foreground h-9 w-9 rounded-full border border-dashed"
    >
      <Plus aria-hidden="true" />
    </Button>
  );
}

/** Props for {@link GlobalRail}. */
export interface GlobalRailProps {
  /** The orgs the actor belongs to, rendered top-to-bottom. */
  orgs: readonly RailOrg[];
  /** The active Hub destination (highlights Inbox/Portfolio), if any. */
  activeHubKey?: HubRailKey;
  /** The caller's cross-org unread notification count, shown as the Inbox attention badge. */
  unreadCount?: number;
  /** Invoked with a Hub destination key when its rail entry is selected. */
  onNavigate?: (key: HubRailKey) => void;
  /**
   * Invoked with an org id when its avatar is selected, in addition to the context rebind.
   *
   * @remarks
   * The avatar always rebinds the active context (so the org accent applies immediately), and
   * also reports the selection here so the host can navigate to that org imperatively. Routing
   * is driven directly from this selection rather than from a context-watching effect, which is
   * what keeps switching orgs from racing the route-to-context sync.
   */
  onSelectOrg?: (orgId: string) => void;
  /**
   * Invoked when the Hub (Today) button is pressed.
   *
   * @remarks
   * Fires in addition to the context rebind, so pressing Hub from another cross-org surface
   * (Inbox/Portfolio, where the context is already the Hub) still routes back to Today even
   * though the context binding does not change.
   */
  onSelectHome?: () => void;
  /** Invoked when the Search entry is selected (opens the command palette). */
  onOpenSearch?: () => void;
  /** Invoked when the user requests to add/join an org. */
  onAddOrg?: () => void;
}

/**
 * The persistent org rail: Hub destinations, per-org avatars, and the add-org affordance.
 *
 * @remarks
 * The top cluster is the caller's cross-org Hub: the **Hub (Today)** button (active when no
 * org is bound, driven by {@link useContextState}), then **Inbox** (with an unread attention
 * badge), **Portfolio**, and **Search** (opens the command palette). Below a divider sit the
 * per-org {@link RailOrgAvatar}s and the {@link AddOrgButton}; the active org avatar reflects
 * the current binding.
 */
export function GlobalRail({
  orgs,
  activeHubKey,
  unreadCount,
  onNavigate,
  onSelectOrg,
  onSelectHome,
  onOpenSearch,
  onAddOrg,
}: GlobalRailProps): React.JSX.Element {
  const { context, isHub, setContext } = useContextState();

  /** Rebind the active context to the org (instant accent) and report the selection for routing. */
  const onSelectOrgAvatar = React.useCallback(
    (orgId: string): void => {
      setContext(orgId);
      onSelectOrg?.(orgId);
    },
    [setContext, onSelectOrg],
  );

  return (
    <nav
      aria-label="Organizations"
      className="border-border bg-card flex h-full w-16 shrink-0 flex-col items-center gap-2 border-r py-3"
    >
      <Button
        type="button"
        variant={isHub && !activeHubKey ? 'secondary' : 'ghost'}
        size="icon"
        aria-label="Hub — Today"
        aria-current={isHub && !activeHubKey ? 'page' : undefined}
        title="Hub — Today"
        onClick={() => {
          setContext(HUB_CONTEXT);
          onSelectHome?.();
        }}
        className={cn('h-9 w-9 rounded-full', isHub && !activeHubKey && 'text-foreground')}
      >
        <Home aria-hidden="true" />
      </Button>

      <RailNavButton
        icon={Inbox}
        label="Inbox"
        active={isHub && activeHubKey === 'inbox'}
        badge={unreadCount}
        badgeLabel="unread"
        onSelect={() => onNavigate?.('inbox')}
      />
      <RailNavButton
        icon={GanttChart}
        label="Portfolio"
        active={isHub && activeHubKey === 'portfolio'}
        onSelect={() => onNavigate?.('portfolio')}
      />
      <RailNavButton icon={Search} label="Search" onSelect={() => onOpenSearch?.()} />

      <div aria-hidden="true" className="bg-border my-1 h-px w-8 shrink-0" role="presentation" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {orgs.map((org) => (
          <RailOrgAvatar
            key={org.id}
            orgId={org.id}
            name={org.name}
            avatarUrl={org.avatar}
            active={context === org.id}
            onSelect={onSelectOrgAvatar}
          />
        ))}
      </div>

      <AddOrgButton onAddOrg={onAddOrg} />
    </nav>
  );
}
