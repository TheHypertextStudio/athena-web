'use client';

/**
 * `@docket/ui` — the single integrated navigation sidebar.
 *
 * @remarks
 * Collapses Docket's former two-layer navigation (the left-edge org rail + the org-scoped
 * context sidebar) into one Linear-grade sidebar. Top: the {@link WorkspaceSwitcher} (the
 * current context + a one-click switch between the Hub, every org, and Personal). Below it,
 * two always-useful groups:
 *
 * - **Home** (cross-org): Today · Inbox · Portfolio · Search (opens the command palette).
 * - **Workspace** (the active org): My Work · Triage · Initiatives · Programs · Projects ·
 *   Cycles · Teams · Views · Agents · Settings — entity-noun labels skinned per org via
 *   `useVocabulary`.
 *
 * On the Hub (no org bound) the Workspace group is replaced by a **Workspaces** list so the
 * caller can enter an org, never leaving the sidebar empty or useless. Every row is rendered
 * as a real anchor (via {@link SidebarNavItem} `asChild`) whose `href` comes from the host's
 * {@link SidebarProps.hrefForWorkspace} builder, so navigation is keyboard-accessible and the
 * host's router owns routing; the Search row is a button that opens the palette.
 */
import * as React from 'react';

import {
  FolderKanban,
  GanttChart,
  Home,
  Inbox,
  Layers,
  LayoutGrid,
  type LucideIcon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Target,
  Users,
} from '../../icons';
import { useVocabulary } from '../../hooks/useVocabulary';
import { getOrgAccent } from '../../lib/org-accent';
import { Button } from '../../primitives';
import { useContextState } from './ContextProvider';
import { SidebarNavItem } from './SidebarNavItem';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import type { HomeNavKey, Workspace, WorkspaceNavKey } from './workspaces';

/** Props for {@link Sidebar}. */
export interface SidebarProps {
  /** Every workspace the caller can switch into (drives the switcher + the Hub list). */
  readonly workspaces: readonly Workspace[];
  /** The active Home destination (highlights Today/Inbox/Portfolio), if any. */
  readonly activeHomeKey?: HomeNavKey;
  /** The active Workspace nav key (highlights the org-scoped row), if any. */
  readonly activeWorkspaceKey?: WorkspaceNavKey;
  /** The caller's cross-org unread count, surfaced on the switcher's Hub entry + Inbox row. */
  readonly unreadCount?: number;
  /** Build the href for a cross-org Home destination (Today/Inbox/Portfolio). */
  readonly hrefForHome: (key: Exclude<HomeNavKey, 'search'>) => string;
  /** Build the href for an org-scoped Workspace destination under the active org. */
  readonly hrefForWorkspace: (orgId: string, key: WorkspaceNavKey) => string;
  /** Build the home href for entering a workspace from the Hub list. */
  readonly hrefForOrgHome: (orgId: string) => string;
  /** Render a routing link element around the row content (host's `Link`). */
  readonly renderLink: (href: string, children: React.ReactNode) => React.ReactNode;
  /** Switch the active context: `null` selects the Hub, otherwise an org id. */
  readonly onSelectWorkspace: (orgId: string | null) => void;
  /** Open the command palette (the Search Home row). */
  readonly onOpenSearch: () => void;
  /** Add/join an org (the foot affordance on the Hub). */
  readonly onAddOrg?: () => void;
}

/** A resolved nav row descriptor (label is already vocabulary-resolved). */
interface NavRow<K extends string> {
  /** Stable destination key. */
  readonly key: K;
  /** Display-ready label. */
  readonly label: string;
  /** Leading icon. */
  readonly icon: LucideIcon;
}

/** The section heading above each sidebar group. */
function GroupLabel({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-muted-foreground px-2 pt-3 pb-1 text-xs font-medium tracking-wide">
      {children}
    </p>
  );
}

/**
 * The single integrated navigation sidebar (workspace switcher + Home + Workspace groups).
 *
 * @remarks
 * Must be rendered inside a {@link ContextProvider}; wrap it (or its consumers) in a
 * `VocabularyProvider` so the org-scoped entity rows resolve to the active org's vocabulary.
 */
export function Sidebar({
  workspaces,
  activeHomeKey,
  activeWorkspaceKey,
  unreadCount,
  hrefForHome,
  hrefForWorkspace,
  hrefForOrgHome,
  renderLink,
  onSelectWorkspace,
  onOpenSearch,
  onAddOrg,
}: SidebarProps): React.JSX.Element {
  const { activeOrgId, isHub } = useContextState();

  const initiatives = useVocabulary('initiative', { plural: true });
  const programs = useVocabulary('program', { plural: true });
  const projects = useVocabulary('project', { plural: true });
  const cycles = useVocabulary('cycle', { plural: true });
  const teams = useVocabulary('team', { plural: true });

  /** The cross-org Home rows that route to a real page (Search is rendered separately). */
  const homeRows: readonly NavRow<Exclude<HomeNavKey, 'search'>>[] = [
    { key: 'today', label: 'Today', icon: Home },
    { key: 'inbox', label: 'Inbox', icon: Inbox },
    { key: 'portfolio', label: 'Portfolio', icon: GanttChart },
  ];

  /** The org-scoped Workspace rows, vocabulary-skinned for entity nouns. */
  const workspaceRows: readonly NavRow<WorkspaceNavKey>[] = [
    { key: 'my-work', label: 'My Work', icon: Home },
    { key: 'triage', label: 'Triage', icon: Inbox },
    { key: 'initiatives', label: initiatives, icon: Target },
    { key: 'programs', label: programs, icon: Layers },
    { key: 'projects', label: projects, icon: FolderKanban },
    { key: 'cycles', label: cycles, icon: RefreshCw },
    { key: 'teams', label: teams, icon: Users },
    { key: 'views', label: 'Views', icon: LayoutGrid },
    { key: 'agents', label: 'Agents', icon: Sparkles },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      aria-label="Navigation"
      className="border-border bg-card flex h-full w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2"
    >
      <WorkspaceSwitcher
        workspaces={workspaces}
        hubBadge={unreadCount}
        onSelect={onSelectWorkspace}
      />

      <GroupLabel>Home</GroupLabel>
      <nav aria-label="Home" className="flex flex-col gap-0.5">
        {homeRows.map((row) => {
          const href = hrefForHome(row.key);
          const active = activeHomeKey === row.key;
          return (
            <SidebarNavItem
              key={row.key}
              label={row.label}
              icon={row.icon}
              active={active}
              badge={row.key === 'inbox' ? unreadCount : undefined}
              badgeLabel="unread"
              asChild
            >
              {renderLink(href, <RowBody icon={row.icon} label={row.label} />)}
            </SidebarNavItem>
          );
        })}
        <SidebarNavItem label="Search" icon={Search} onSelect={onOpenSearch} />
      </nav>

      {isHub || !activeOrgId ? (
        <>
          <GroupLabel>Workspaces</GroupLabel>
          <nav aria-label="Workspaces" className="flex min-h-0 flex-col gap-0.5">
            {workspaces.length === 0 ? (
              <p className="text-muted-foreground px-2 py-1.5 text-sm">No organizations yet.</p>
            ) : (
              workspaces.map((w) => (
                <SidebarNavItem key={w.id} label={w.name} badge={w.attentionCount} asChild>
                  {renderLink(hrefForOrgHome(w.id), <WorkspaceRowBody workspace={w} />)}
                </SidebarNavItem>
              ))
            )}
            {onAddOrg ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAddOrg}
                className="text-muted-foreground hover:text-foreground mt-1 w-full justify-start gap-2 px-2 font-normal"
              >
                <Plus aria-hidden="true" className="size-4" />
                <span>Add organization</span>
              </Button>
            ) : null}
          </nav>
        </>
      ) : (
        <>
          <GroupLabel>Workspace</GroupLabel>
          <nav aria-label="Workspace" className="flex flex-col gap-0.5">
            {workspaceRows.map((row) => {
              const href = hrefForWorkspace(activeOrgId, row.key);
              const active = activeWorkspaceKey === row.key;
              return (
                <SidebarNavItem
                  key={row.key}
                  label={row.label}
                  icon={row.icon}
                  active={active}
                  asChild
                >
                  {renderLink(href, <RowBody icon={row.icon} label={row.label} />)}
                </SidebarNavItem>
              );
            })}
          </nav>
        </>
      )}
    </aside>
  );
}

/** The icon + label content shared by every linked nav row. */
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

/** A workspace entry in the Hub's Workspaces list: an accent-tinted dot + the org name. */
function WorkspaceRowBody({ workspace }: { readonly workspace: Workspace }): React.JSX.Element {
  return (
    <>
      <span
        aria-hidden="true"
        className="size-4 shrink-0 rounded-[5px]"
        style={{ backgroundColor: getOrgAccent(workspace.id) }}
      />
      <span className="truncate">{workspace.name}</span>
    </>
  );
}
