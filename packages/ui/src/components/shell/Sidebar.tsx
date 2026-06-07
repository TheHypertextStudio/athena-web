'use client';

/**
 * `@docket/ui` — the single integrated navigation sidebar.
 *
 * @remarks
 * Collapses Docket's former two-layer navigation (the left-edge org rail + the org-scoped
 * context sidebar) into one Linear-grade sidebar with sections that are *always* visible —
 * there is no separate "Hub" mode that swaps the sidebar's contents. Pinned at the top is the
 * {@link WorkspaceSwitcher} (the active workspace + a one-click switch between every org the
 * caller belongs to). Below it, two sections shown on every route:
 *
 * - **Home** (cross-org, no header): Today · Inbox · Portfolio · Search (opens the command
 *   palette). These route to `/today`, `/inbox`, `/portfolio` regardless of the active org.
 * - **Workspace** (the active org): My Work · Triage · Initiatives · Programs · Projects ·
 *   Cycles · Teams · Views · Agents · Settings — entity-noun labels skinned per org via
 *   `useVocabulary`, linking to `/orgs/<activeOrgId>/…`.
 *
 * The Workspace section always reflects the active org (route org ?? last-selected ?? personal),
 * so the sidebar is stable on every route and never empties or mode-swaps. Every row is a real
 * anchor (via {@link SidebarNavItem} `asChild`) whose `href` comes from the host's builders, so
 * navigation is keyboard-accessible and the host's router owns routing; the Search row is a
 * button that opens the palette.
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
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Target,
  Users,
} from '../../icons';
import { useVocabulary } from '../../hooks/useVocabulary';
import { useContextState } from './ContextProvider';
import { SidebarNavItem } from './SidebarNavItem';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import type { HomeNavKey, Workspace, WorkspaceNavKey } from './workspaces';

/** Props for {@link Sidebar}. */
export interface SidebarProps {
  /** Every workspace the caller can switch into (drives the switcher). */
  readonly workspaces: readonly Workspace[];
  /** The active Home destination (highlights Today/Inbox/Portfolio), if any. */
  readonly activeHomeKey?: HomeNavKey;
  /** The active Workspace nav key (highlights the org-scoped row), if any. */
  readonly activeWorkspaceKey?: WorkspaceNavKey;
  /** The caller's cross-org unread count, surfaced on the Inbox row. */
  readonly unreadCount?: number;
  /** Build the href for a cross-org Home destination (Today/Inbox/Portfolio). */
  readonly hrefForHome: (key: Exclude<HomeNavKey, 'search'>) => string;
  /** Build the href for an org-scoped Workspace destination under the active org. */
  readonly hrefForWorkspace: (orgId: string, key: WorkspaceNavKey) => string;
  /** Render a routing link element around the row content (host's `Link`). */
  readonly renderLink: (href: string, children: React.ReactNode) => React.ReactNode;
  /** Switch the active workspace to an org id. */
  readonly onSelectWorkspace: (orgId: string) => void;
  /** Open the command palette (the Search Home row). */
  readonly onOpenSearch: () => void;
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

/** The section heading above a sidebar group. */
function GroupLabel({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-muted-foreground px-2 pt-3 pb-1 text-xs font-medium tracking-wide">
      {children}
    </p>
  );
}

/**
 * The single integrated navigation sidebar (workspace switcher + Home + Workspace sections).
 *
 * @remarks
 * Must be rendered inside a {@link ContextProvider}; wrap it (or its consumers) in a
 * `VocabularyProvider` so the org-scoped entity rows resolve to the active org's vocabulary.
 * Both sections are always present: the Home section is cross-org, and the Workspace section
 * reflects the active org (which the host resolves to route ?? last-selected ?? personal).
 */
export function Sidebar({
  workspaces,
  activeHomeKey,
  activeWorkspaceKey,
  unreadCount,
  hrefForHome,
  hrefForWorkspace,
  renderLink,
  onSelectWorkspace,
  onOpenSearch,
}: SidebarProps): React.JSX.Element {
  const { activeOrgId } = useContextState();

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
      <WorkspaceSwitcher workspaces={workspaces} onSelect={onSelectWorkspace} />

      <nav aria-label="Home" className="flex flex-col gap-0.5 pt-2">
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

      <GroupLabel>Workspace</GroupLabel>
      {activeOrgId ? (
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
      ) : (
        <p className="text-muted-foreground px-2 py-1.5 text-sm">No workspace yet.</p>
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
