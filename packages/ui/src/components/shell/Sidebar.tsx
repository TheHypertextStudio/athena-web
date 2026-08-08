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
 * panel). It keeps its own padding and width. Only the nav rows scroll — the
 * {@link WorkspaceSwitcher} is fixed at the top and the {@link SidebarProps.footer} (recovery
 * nudge, update prompt, account row) is fixed at the bottom, so both stay reachable regardless of
 * how many Workspace rows are above the fold. Below the switcher, two sections shown on every
 * route:
 *
 * - **Home** (cross-org, no header): Today · Inbox · Portfolio · Search (opens the command
 *   palette). These route to `/today`, `/inbox`, `/portfolio` regardless of the active org.
 * - **Workspace** (the active org): My Work · Triage · Tasks · Stream · Initiatives · Programs ·
 *   Projects · Cycles · Teams · Views · Graph · Settings — entity-noun labels skinned per org via
 *   `useVocabulary`, linking to `/orgs/<activeOrgId>/…`.
 *
 * **Tasks appears in both sections, and that is the point.** The Home row is cross-org ("what is
 * assigned to me anywhere"); the Workspace row is this workspace's task roster, and it sits beside
 * Projects and Initiatives because a workspace's tasks are a peer destination to them, not
 * something reachable only by first opening a project. `Stream` already spans both sections the
 * same way, so this is the established two-altitude pattern rather than a duplicate row.
 *
 * The Workspace section always reflects the active org (route org ?? last-selected ?? personal),
 * so the sidebar is stable on every route and never empties or mode-swaps. Every row is a real
 * anchor (via {@link SidebarNavItem} `asChild`) whose `href` comes from the host's builders, so
 * navigation is keyboard-accessible and the host's router owns routing; the Search row is a
 * button that opens the palette.
 *
 * **The sidebar never renders a placeholder in place of a label it already has.** Every nav label
 * in both sections is a compile-time constant, so the only thing a fetch can change is a row's
 * `href` — and an un-navigable row carrying its real text and icon tells the reader strictly more
 * than a grey bar of the same height. The single unknown-until-fetch value in this component is
 * the active workspace's *name* (and the switcher's list of workspaces to choose from), which is
 * why `loading` reaches {@link WorkspaceSwitcher} and nothing else.
 */
import * as React from 'react';

import {
  Activity,
  Building,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  GanttChart,
  Home,
  Inbox,
  Layers,
  LayoutGrid,
  Library,
  ListChecks,
  type LucideIcon,
  RefreshCw,
  Search,
  Settings,
  Target,
  User,
  Users,
  Workflow,
} from '../../icons';
import { cn } from '../../lib/utils';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../primitives';
import { useVocabulary } from '../../hooks/useVocabulary';
import { useContextState } from './ContextProvider';
import { useShellDrawer } from './ShellDrawerContext';
import { useShellSidebar } from './ShellSidebarContext';
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
  /** Open the host application's shared-workspace creation flow. */
  readonly onCreateWorkspace: () => void;
  /** Open the command palette (the Search Home row). */
  readonly onOpenSearch: () => void;
  /**
   * Whether the caller's workspace list is still unknown.
   *
   * @remarks
   * Narrow by design: it gates only the things that genuinely cannot be known before the fetch
   * resolves — the switcher's workspace *name* and its list, and whether a Workspace row can be
   * given an `href`. It never withholds a label. The Workspace rows' text and icons are
   * compile-time constants, so they render at `loading` too, merely non-navigable until an active
   * workspace exists.
   */
  readonly loading?: boolean;
  /**
   * Whether the active workspace is the caller's personal space.
   *
   * @remarks
   * A personal workspace is the user's own space, not an organization with members or teams, so
   * when `true` the Workspace section omits the **Teams** row (there are no other members to
   * organize into teams). This is a *presentation* gate only — the workspace still has its hidden
   * default team under the hood; this prop simply doesn't surface team-management chrome. Every
   * other row (My Work, Triage, Initiatives, Programs, Projects, Cycles, Views, Settings)
   * stays, as each is meaningful for a single person. Defaults to `false` (a shared org), so
   * existing consumers are unaffected.
   */
  readonly personalWorkspace?: boolean;
  /**
   * Optional content pinned to the bottom of the sidebar, below the nav (e.g. the account menu with
   * sign-out). Rendered as a fixed sibling after the scrolling nav region, so it stays pinned to
   * the foot of the rail regardless of how much the Workspace section scrolls above it.
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
 * A plain `text-body-medium font-medium` title — no `tracking-wide` pseudo-uppercase eyebrow. The section
 * is separated from the group above it by `mt-4`, and the heading sits `mb-1` above its first row
 * (rows then start flush beneath it), matching the section-spacing rhythm.
 */
function GroupLabel({
  children,
  collapsed,
}: {
  readonly children: React.ReactNode;
  readonly collapsed: boolean;
}): React.JSX.Element {
  // Collapsed there is no room for the word, and a truncated heading is worse than none. The
  // grouping itself still has to survive, so it becomes a rule — the section boundary is the
  // information, and the word was only ever naming it.
  if (collapsed) {
    return <hr aria-hidden="true" className="border-outline-variant mx-2 mt-4 mb-1 border-t" />;
  }
  return (
    <p className="text-on-surface-variant text-body-medium mt-4 mb-1 px-3 font-medium">
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
  onCreateWorkspace,
  onOpenSearch,
  loading = false,
  personalWorkspace = false,
  footer,
}: SidebarProps): React.JSX.Element {
  const { activeOrgId } = useContextState();
  const dismissDrawer = useShellDrawer();
  const { collapsed: shellCollapsed, onToggle } = useShellSidebar();
  // Never collapsed inside the off-canvas drawer. There the sidebar IS the surface the viewer
  // opened; shrinking it to glyphs would leave a 56px sheet over an empty screen.
  const collapsed = shellCollapsed && dismissDrawer === null;

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
    { key: 'calendar', label: 'Calendar', icon: Calendar },
    { key: 'inbox', label: 'Inbox', icon: Inbox },
    { key: 'stream', label: 'Stream', icon: Activity },
    { key: 'portfolio', label: 'Portfolio', icon: GanttChart },
  ];

  /**
   * The org-scoped Workspace rows, vocabulary-skinned for entity nouns.
   *
   * @remarks
   * In a personal workspace the **Teams** and **People** rows are dropped — a personal space is
   * the user's own space, not an organization with a roster to keep or teams to organize it into.
   * Every other row stays, since each is meaningful for a single person. **Tasks** in particular
   * sits outside that conditional: a workspace's task roster is exactly as meaningful for one
   * person as for fifty, so it renders for a personal workspace and a shared org alike, beside
   * Projects and Initiatives.
   *
   * **People** is a workspace destination rather than a Settings page because the people a
   * workspace works with are not configuration. It lists everyone the workspace tracks in one
   * name-ordered list — the volunteer who never signs in beside the staffer who does — which is
   * why it sits with the work rows and not behind an admin gate.
   */
  const workspaceRows: readonly NavRow<WorkspaceNavKey>[] = [
    { key: 'my-work', label: 'My Work', icon: Home },
    { key: 'triage', label: 'Triage', icon: Inbox },
    { key: 'tasks', label: 'Tasks', icon: ListChecks },
    { key: 'stream', label: 'Stream', icon: Activity },
    // Above the work hierarchy, not inside it. The run below — initiatives through cycles — is
    // ordered by altitude of work, and slotting the Library into it would read as another rung of
    // that hierarchy rather than the material the whole hierarchy refers to.
    { key: 'library', label: 'Library', icon: Library },
    { key: 'initiatives', label: initiatives, icon: Target },
    { key: 'programs', label: programs, icon: Layers },
    { key: 'projects', label: projects, icon: FolderKanban },
    { key: 'cycles', label: cycles, icon: RefreshCw },
    ...(personalWorkspace
      ? []
      : [
          { key: 'teams' as const, label: teams, icon: Users },
          { key: 'people' as const, label: 'People', icon: User },
        ]),
    { key: 'views', label: 'Views', icon: LayoutGrid },
    { key: 'graph', label: 'Graph', icon: Workflow },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    // Its own provider, because collapsing moves every row's label into a tooltip — a component
    // that cannot render its own labels without one has no business requiring the host to remember.
    // Radix allows nesting, so the app's root provider is unaffected.
    <TooltipProvider>
      <aside
        aria-label="Navigation"
        className={cn(
          'text-on-surface flex h-full w-full shrink-0 flex-col p-2',
          collapsed ? 'lg:w-14 lg:items-center' : 'lg:w-60',
        )}
      >
        {/* The switcher and the collapse control share the header row. The toggle lives here
            rather than at the foot because the foot is a fixed sibling pinned to the bottom
            edge — a control placed after it sits below the fold on a short window, which is
            exactly where somebody looking for "how do I get the labels back" cannot find it. */}
        <div
          className={cn(
            'flex shrink-0 gap-1',
            collapsed ? 'flex-col items-center' : 'flex-row items-center',
          )}
        >
          <div className={collapsed ? undefined : 'min-w-0 flex-1'}>
            <WorkspaceSwitcher
              workspaces={workspaces}
              onSelect={onSelectWorkspace}
              onCreate={onCreateWorkspace}
              loading={loading}
              collapsed={collapsed}
            />
          </div>
          {dismissDrawer === null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  controlSize="sm"
                  aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                  aria-pressed={collapsed}
                  onClick={onToggle}
                  className="text-on-surface-variant hover:text-on-surface hidden shrink-0 lg:inline-flex"
                >
                  {collapsed ? (
                    <ChevronRight aria-hidden="true" />
                  ) : (
                    <ChevronLeft aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? 'Expand navigation' : 'Collapse navigation'}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        {/*
          Everything between the switcher and the footer scrolls as its own region — the switcher
          stays reachable at the top and the footer (recovery nudge, update card, account row) at
          the bottom regardless of how many Workspace rows are above the fold. `min-h-0` is load
          bearing: without it a flex child with `overflow-y-auto` refuses to shrink below its
          content height and the whole `<aside>` scrolls instead, which is the bug this fixes.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <nav
            aria-label="Home"
            className="flex flex-col space-y-0.5 pt-2"
            onClick={handleNavActivate}
          >
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
                  collapsed={collapsed}
                  asChild
                >
                  {renderLink(href, <RowBody icon={row.icon} label={row.label} />)}
                </SidebarNavItem>
              );
            })}
            <SidebarNavItem
              label="Search"
              icon={Search}
              onSelect={onOpenSearch}
              disabled={loading}
              collapsed={collapsed}
            />
          </nav>

          <GroupLabel collapsed={collapsed}>Workspace</GroupLabel>
          {/* Every label in `workspaceRows` is a compile-time constant, so there is nothing here to
          wait for: the rows paint immediately and only their `href` depends on the resolved
          workspace. A grey bar in place of the word "Projects" is strictly less information than
          the word "Projects" — it hides a label we already know in order to reserve the space that
          label would have occupied. While `activeOrgId` is unresolved the same rows render
          non-navigable (same text, same icons, same heights), so the section's rhythm is held by
          real content rather than by a placeholder standing in for it. */}
          {activeOrgId ? (
            <nav
              aria-label="Workspace"
              className="flex flex-col space-y-0.5"
              onClick={handleNavActivate}
            >
              {workspaceRows.map((row) => {
                const href = hrefForWorkspace(activeOrgId, row.key);
                const active = activeWorkspaceKey === row.key;
                return (
                  <SidebarNavItem
                    key={row.key}
                    label={row.label}
                    icon={row.icon}
                    active={active}
                    collapsed={collapsed}
                    asChild
                  >
                    {renderLink(href, <RowBody icon={row.icon} label={row.label} />)}
                  </SidebarNavItem>
                );
              })}
            </nav>
          ) : loading || workspaces.length > 0 ? (
            // `workspaces.length > 0` with no `activeOrgId` is the one-frame gap between the list
            // arriving and the host binding an active workspace to it. Falling through to
            // `WorkspaceEmpty` there would flash "No workspace yet" at someone who plainly has one —
            // the false empty state the old skeleton existed to avoid, which is avoided here by
            // showing the real rows instead of a placeholder.
            <nav aria-label="Workspace" className="flex flex-col space-y-0.5">
              {workspaceRows.map((row) => (
                <SidebarNavItem
                  key={row.key}
                  label={row.label}
                  icon={row.icon}
                  collapsed={collapsed}
                  disabled
                />
              ))}
            </nav>
          ) : collapsed ? null : (
            <WorkspaceEmpty />
          )}
        </div>

        {footer ? (
          <div className={cn('shrink-0 pt-2', collapsed ? 'w-full' : null)}>{footer}</div>
        ) : null}
      </aside>
    </TooltipProvider>
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
      <p className="text-on-surface text-body-medium font-medium">No workspace yet</p>
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
  // The label element is always rendered; `SidebarNavItem` hides it with a descendant selector when
  // collapsed. Dropping it here instead would mean every caller of `renderLink` — which is the host
  // app's router link, not ours — had to be told about the collapse.
  return (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
}
