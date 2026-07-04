'use client';

/**
 * `@docket/ui` — the single integrated navigation sidebar.
 *
 * @remarks
 * Collapses Docket's former two-layer navigation (the left-edge org rail + the org-scoped
 * context sidebar) into one Linear-grade sidebar with sections that are *always* visible —
 * there is no separate "Hub" mode that swaps the sidebar's contents. The nav **blends into the
 * shell canvas**: it carries no panel chrome of its own — no `surface` fill, border, rounding,
 * or elevation — so it reads as part of the tinted `surface-container` background rather than a
 * separate floating container (only the `<main>` content stays a distinct rounded surface
 * panel). It keeps its own padding, width, and scroll. Pinned at the top is the
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
  Activity,
  Building,
  FolderKanban,
  GanttChart,
  Home,
  Inbox,
  Layers,
  LayoutGrid,
  ListChecks,
  type LucideIcon,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Target,
  Users,
  Workflow,
} from '../../icons';
import { useVocabulary } from '../../hooks/useVocabulary';
import { useContextState } from './ContextProvider';
import { useShellDrawer } from './ShellDrawerContext';
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
  /**
   * Whether the active workspace is the caller's personal space.
   *
   * @remarks
   * A personal workspace is the user's own space, not an organization with members or teams, so
   * when `true` the Workspace section omits the **Teams** row (there are no other members to
   * organize into teams). This is a *presentation* gate only — the workspace still has its hidden
   * default team under the hood; this prop simply doesn't surface team-management chrome. Every
   * other row (My Work, Triage, Initiatives, Programs, Projects, Cycles, Views, Agents, Settings)
   * stays, as each is meaningful for a single person. Defaults to `false` (a shared org), so
   * existing consumers are unaffected.
   */
  readonly personalWorkspace?: boolean;
  /**
   * Optional content pinned to the bottom of the sidebar, below the nav (e.g. the account menu with
   * sign-out). Separated from the scrolling nav by `mt-auto` so it stays at the foot of the rail.
   */
  readonly footer?: React.ReactNode;
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

/**
 * A calm, real section heading above a sidebar group.
 *
 * @remarks
 * A plain `text-body font-medium` title — no `tracking-wide` pseudo-uppercase eyebrow. The section
 * is separated from the group above it by `mt-4`, and the heading sits `mb-1` above its first row
 * (rows then start flush beneath it), matching the section-spacing rhythm.
 */
function GroupLabel({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <p className="text-on-surface-variant text-body mt-4 mb-1 px-3 font-medium">{children}</p>;
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
  personalWorkspace = false,
  footer,
}: SidebarProps): React.JSX.Element {
  const { activeOrgId } = useContextState();
  const dismissDrawer = useShellDrawer();

  // When rendered inside the mobile off-canvas drawer, a nav selection should close the drawer
  // so the chosen destination is visible. Every nav row is a link or button, so a bubbled click
  // landing on an interactive control means a selection was made; closing then is correct. On
  // the static desktop rail `dismissDrawer` is `null`, so this is a no-op there.
  const handleNavActivate = React.useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      if (!dismissDrawer) return;
      if ((event.target as HTMLElement).closest('a,button')) dismissDrawer();
    },
    [dismissDrawer],
  );

  const initiatives = useVocabulary('initiative', { plural: true });
  const programs = useVocabulary('program', { plural: true });
  const projects = useVocabulary('project', { plural: true });
  const cycles = useVocabulary('cycle', { plural: true });
  const teams = useVocabulary('team', { plural: true });

  /** The cross-org Home rows that route to a real page (Search is rendered separately). */
  const homeRows: readonly NavRow<Exclude<HomeNavKey, 'search'>>[] = [
    { key: 'today', label: 'Today', icon: Home },
    { key: 'tasks', label: 'Tasks', icon: ListChecks },
    { key: 'inbox', label: 'Inbox', icon: Inbox },
    { key: 'stream', label: 'Stream', icon: Activity },
    { key: 'portfolio', label: 'Portfolio', icon: GanttChart },
  ];

  /**
   * The org-scoped Workspace rows, vocabulary-skinned for entity nouns.
   *
   * @remarks
   * In a personal workspace the **Teams** row is dropped — a personal space is the user's own
   * space, not an organization with members to organize into teams. Every other row stays, since
   * each is meaningful for a single person.
   */
  const workspaceRows: readonly NavRow<WorkspaceNavKey>[] = [
    { key: 'my-work', label: 'My Work', icon: Home },
    { key: 'triage', label: 'Triage', icon: Inbox },
    { key: 'stream', label: 'Stream', icon: Activity },
    { key: 'initiatives', label: initiatives, icon: Target },
    { key: 'programs', label: programs, icon: Layers },
    { key: 'projects', label: projects, icon: FolderKanban },
    { key: 'cycles', label: cycles, icon: RefreshCw },
    ...(personalWorkspace ? [] : [{ key: 'teams' as const, label: teams, icon: Users }]),
    { key: 'views', label: 'Views', icon: LayoutGrid },
    { key: 'graph', label: 'Graph', icon: Workflow },
    { key: 'agents', label: 'Agents', icon: Sparkles },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      aria-label="Navigation"
      className="text-on-surface flex h-full w-full shrink-0 flex-col overflow-y-auto p-2 lg:w-60"
    >
      <WorkspaceSwitcher workspaces={workspaces} onSelect={onSelectWorkspace} />

      <nav aria-label="Home" className="flex flex-col space-y-1 pt-2" onClick={handleNavActivate}>
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
        <nav aria-label="Workspace" className="flex flex-col space-y-1" onClick={handleNavActivate}>
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
        <WorkspaceEmpty />
      )}

      {footer ? <div className="mt-auto pt-2">{footer}</div> : null}
    </aside>
  );
}

/**
 * The calm empty treatment shown when no workspace is bound yet.
 *
 * @remarks
 * A sidebar-scaled version of the shared empty-state vocabulary (muted tonal glyph disc + a short
 * title and a one-line `on-surface-variant` subtext) rather than a bare paragraph, so the
 * Workspace section reads as an intentional empty surface instead of broken navigation. The glyph
 * is decorative (`aria-hidden`); the title + body carry the accessible meaning.
 */
function WorkspaceEmpty(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
      <span
        aria-hidden="true"
        className="bg-surface-container-high text-on-surface-variant flex size-9 items-center justify-center rounded-full"
      >
        <Building className="size-5" />
      </span>
      <p className="text-on-surface text-body font-medium">No workspace yet</p>
      <p className="text-on-surface-variant text-xs leading-relaxed">
        Switch into a workspace to see its projects and tasks here.
      </p>
    </div>
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
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
}
