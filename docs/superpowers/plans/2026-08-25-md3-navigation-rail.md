# Material 3 navigation rail implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the collapsed icon dictionary with a persistent, labeled Material 3 navigation
rail while preserving the full desktop sidebar and the mobile navigation drawer.

**Architecture:** A single resolved destination catalog will hold every destination's identity,
route altitude, label, icon, availability, expanded grouping, rail priority, and More grouping.
`Sidebar` will become a small shell adapter that resolves vocabulary and selects either an expanded
sidebar or a labeled rail renderer. `AppShell` will own a reduced-motion-aware View Transition when
it changes density. Only stable navigation elements participate in the shared-element transition.

**Tech Stack:** React 19, TypeScript, Radix Dropdown Menu, Tailwind CSS 4, browser View Transitions,
Vitest, Testing Library, and the existing authenticated Playwright design-review harness.

**Spec:** `docs/superpowers/specs/2026-08-25-md3-navigation-rail-design.md`

---

## Global constraints

- Keep the 1024px shell breakpoint. Below it, render the full existing drawer regardless of the
  stored desktop density preference.
- Keep the full expanded Home and Workspace sidebar. Do not change routes, active-key resolution,
  workspace switching, vocabulary, unread data, account behavior, or the right-side utility rail.
- The desktop rail has exactly Today, My Work, Calendar, Inbox, Search, Athena, and More. More
  contains every eligible destination that is not one of those six routes.
- Give every rail item a visible label. Do not make tooltips the only way to identify a destination.
- Keep a single rendered navigation presentation during a density transition. A document state must
  never contain duplicate `view-transition-name` values.
- Use 200ms layout motion for the left column and main canvas. Skip the View Transition and CSS
  motion when `prefers-reduced-motion: reduce` matches.
- Do not add personalization, reordering, favorites, storage keys, API work, or a new breakpoint.
- Use `--maxWorkers=1` for focused Vitest commands and `--concurrency=2` for repository commands.

## File structure

- Create `packages/ui/src/components/shell/navigation-catalog.tsx`. It resolves the complete
  destination catalog from vocabulary labels and presentation state. It exports the typed record,
  stable transition-name helpers, and pure selectors for expanded groups, rail items, and More
  groups.
- Create `packages/ui/src/components/shell/ExpandedSidebar.tsx`. It owns the labeled desktop and
  drawer presentation, including unresolved-workspace and empty-workspace behavior.
- Create `packages/ui/src/components/shell/NavigationRail.tsx`. It owns the desktop-only labeled
  rail, its workspace switcher, primary items, More menu, footer density, and collapse control.
- Create `packages/ui/src/components/shell/navigation-transition.ts`. It wraps a synchronous shell
  state update in `document.startViewTransition` only when the browser supports it and reduced
  motion is off.
- Modify `packages/ui/src/components/shell/Sidebar.tsx`. It remains the public shell API and
  adapter. It resolves vocabulary once, builds the catalog once, and chooses the drawer, expanded,
  or rail presentation without retaining destination arrays or layout branches.
- Modify `packages/ui/src/components/shell/AppShell.tsx`. It uses `startNavigationTransition` for
  the desktop density preference and updates the public geometry constants to the real rail width.
- Modify `packages/ui/src/components/index.ts`. It exports no new public implementation detail
  unless a host-facing type requires it; it continues to export `Sidebar` and its public props.
- Modify `packages/ui/src/styles/globals.css`. It adds the scoped shared-element pseudo-element
  rules that disable the root snapshot and set the rail transition timing.
- Create `packages/ui/tests/components/shell/navigation-catalog.test.tsx`. It pins catalog identity,
  grouping, personal-workspace exclusions, availability, and route-altitude decisions.
- Create `packages/ui/tests/components/shell/navigation-rail.test.tsx`. It pins visible labels,
  selection, More behavior, unread semantics, workspace switching, and mobile exclusion.
- Modify `packages/ui/tests/components/shell/shell-full.test.tsx`. It pins View Transition use,
  reduced-motion fallback, unique shared names, focus retention, and the unchanged mobile drawer.
- Modify `packages/ui/tests/components/shell/shell-layout-contract.test.tsx`. It reads the new rail
  width from the rendered rail and proves the main-content floor for every desktop width.
- Create `docs/design/audits/2026-08-25-md3-navigation-rail.md` and captures below
  `docs/design/audits/screenshots/2026-08-25-md3-navigation-rail/`. They record the final
  authenticated visual review and transition evidence.
- Modify `docs/WORKLOG.md`. It records implementation, validation, visual review, known limits,
  and the completion retrospective.

### Task 1: Define and prove the navigation catalog

**Files:**

- Create: `packages/ui/src/components/shell/navigation-catalog.tsx`
- Create: `packages/ui/tests/components/shell/navigation-catalog.test.tsx`
- Modify: `packages/ui/src/components/shell/workspaces.ts`

**Interfaces:**

- Consumes: `HomeNavKey`, `WorkspaceNavKey`, resolved vocabulary strings, `personalWorkspace`, an
  active workspace id, and the shell's active Home and Workspace keys.
- Produces: `ResolvedNavigationDestination[]`, primary rail destinations, and grouped More records.

- [ ] **Step 1: Write failing catalog tests for the primary rail and More partition**

Add a catalog fixture with resolved entity labels. Assert the primary identifiers and labels are
exactly the daily rail set. Assert that `tasks`, `time`, `stream`, `portfolio`, `triage`, Library,
the hierarchy, People, Views, Graph, and Settings appear once in More and never in the rail.

```tsx
expect(rail.map((item) => item.id)).toEqual([
  'home:today',
  'workspace:my-work',
  'home:calendar',
  'home:inbox',
  'home:search',
  'home:athena',
]);
expect(more.workspace.map((item) => item.id)).toContain('workspace:projects');
expect(more.manage.map((item) => item.id)).toEqual([
  'workspace:people',
  'workspace:views',
  'workspace:graph',
  'workspace:settings',
]);
```

Also prove that a personal workspace removes Teams and People from every selector, that all static
labels survive unresolved workspace context, and that the selected workspace row is distinct from
the cross-workspace Home task and Stream rows.

- [ ] **Step 2: Run the new test and verify red state**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-catalog.test.tsx --maxWorkers=1
```

Expected: FAIL because `navigation-catalog.tsx` and its selectors do not exist.

- [ ] **Step 3: Add the typed catalog and selectors**

Add route-altitude and presentation fields instead of inferring meaning from a key string:

```tsx
export interface ResolvedNavigationDestination {
  readonly id: `home:${HomeNavKey}` | `workspace:${WorkspaceNavKey}`;
  readonly group: 'home' | 'workspace';
  readonly moreGroup: 'workspace' | 'manage' | null;
  readonly rail: boolean;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
  readonly disabled: boolean;
}

export function navigationTransitionName(id: ResolvedNavigationDestination['id']): string {
  return `navigation-${id.replace(':', '-')}`;
}
```

`resolveNavigationCatalog` takes the five vocabulary strings as arguments. It produces `my-work`
as the one workspace primary item, keeps workspace-only records disabled when `activeOrgId` is null,
and returns an explicit `moreGroup` for every non-primary record. Do not place `More` in the
catalog. It is a rail affordance, not a route.

- [ ] **Step 4: Run the focused catalog test and verify green state**

Run the command from Step 2. Expected: PASS with the exact primary order, complete More partition,
personal-workspace omissions, stable labels, and no duplicate ids.

- [ ] **Step 5: Commit the catalog slice**

Stage only the catalog, key/type change, and catalog test. Commit with `feat(ui): Define shell
navigation catalog`, a substantive body, and the Codex co-author trailer.

### Task 2: Replace the icon dictionary with a labeled rail

**Files:**

- Create: `packages/ui/src/components/shell/NavigationRail.tsx`
- Create: `packages/ui/src/components/shell/ExpandedSidebar.tsx`
- Modify: `packages/ui/src/components/shell/Sidebar.tsx`
- Create: `packages/ui/tests/components/shell/navigation-rail.test.tsx`
- Modify: `packages/ui/tests/components/shell/shell-full.test.tsx`

**Interfaces:**

- Consumes: `SidebarProps`, the resolved catalog, the existing `WorkspaceSwitcher`, host-owned
  `renderLink`, the drawer dismissal context, and the sidebar collapse context.
- Produces: one desktop rail with labeled primary destinations and More, one full expanded sidebar,
  and the unchanged full mobile drawer.

- [ ] **Step 1: Write failing rail interaction tests**

Render the Sidebar with `ShellSidebarProvider` collapsed. Assert the rail has the six primary links
or buttons plus a More button, and that every rail item has visible text content. Assert Inbox keeps
`Inbox, 3 unread` as its accessible name. Open More and assert the two labeled groups and a linked
Projects item. Open the workspace avatar menu, select another workspace, and assert the existing
callback receives that id.

```tsx
expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toHaveTextContent(
  'TodayMy WorkCalendarInboxSearchAthenaMore',
);
await user.click(screen.getByRole('button', { name: 'More navigation' }));
expect(screen.getByRole('group', { name: 'Workspace' })).toBeInTheDocument();
expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute(
  'href',
  `/orgs/${ACME.id}/projects`,
);
```

Add a drawer test with a collapsed provider and a non-null drawer dismissal. It must show the
expanded sidebar, no rail-only More button, and no desktop density toggle.

- [ ] **Step 2: Run the new rail test and verify red state**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-rail.test.tsx --maxWorkers=1
```

Expected: FAIL because the current collapsed Sidebar removes all labels and has no More menu.

- [ ] **Step 3: Extract the full presentation without changing its contract**

Move the current labeled header, Home and Workspace rows, unresolved workspace handling,
`WorkspaceEmpty`, pinned footer, and drawer click dismissal into `ExpandedSidebar`. Render records
from the resolved catalog. Retain `aria-label="Home"` and `aria-label="Workspace"`. Keep the
public `SidebarProps` unchanged so `AppShellFrame` and every test host remain untouched.

- [ ] **Step 4: Build the rail and anchored More menu**

Use `DropdownMenu` with a `Button` trigger for More. Give the rail a single semantic navigation
landmark and visible labels below each 40px icon target. Keep the workspace switcher at the top and
the caller's footer at the bottom. Use `DropdownMenuLabel`, `DropdownMenuGroup`, and one separator
between Workspace and Manage.

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button type="button" aria-label="More navigation" variant="ghost">
      <MoreHorizontal aria-hidden="true" />
      <span>More</span>
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent side="right" align="start" width="lg" sections="divider">
    <DropdownMenuLabel>Workspace</DropdownMenuLabel>
    <DropdownMenuGroup>{workspaceItems}</DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuLabel>Manage</DropdownMenuLabel>
    <DropdownMenuGroup>{manageItems}</DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>
```

The rail must not render the recovery nudge or update card because those are prose cards with no
compact equivalent. It must retain the account trigger as an icon-only controlled form of the
existing `AccountMenu`.

- [ ] **Step 5: Convert Sidebar into the adapter**

Resolve vocabulary once in `Sidebar`. Resolve the catalog once with `useMemo`. Render
`ExpandedSidebar` when the drawer is active or the desktop preference is expanded. Render
`NavigationRail` only when the desktop preference is collapsed. Do not use CSS to hide a duplicate
render tree. Keep a single `TooltipProvider` around whichever presentation is mounted.

- [ ] **Step 6: Run focused UI tests and verify green state**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/navigation-catalog.test.tsx tests/components/shell/navigation-rail.test.tsx tests/components/shell/sidebar-static-nav.test.tsx tests/components/shell/shell-full.test.tsx --maxWorkers=1
```

Expected: PASS. The old assertions that expect an icon-only 56px sidebar must be replaced with
assertions for the labeled rail while preserving drawer and expanded-sidebar contracts.

- [ ] **Step 7: Commit the navigation presentations**

Stage only the rail, expanded renderer, Sidebar adapter, and focused UI tests. Commit with
`feat(ui): Add a labeled navigation rail`, a substantive body, and the Codex co-author trailer.

### Task 3: Add shared-element collapse motion and protect shell geometry

**Files:**

- Create: `packages/ui/src/components/shell/navigation-transition.ts`
- Modify: `packages/ui/src/components/shell/AppShell.tsx`
- Modify: `packages/ui/src/styles/globals.css`
- Modify: `packages/ui/tests/components/shell/shell-full.test.tsx`
- Modify: `packages/ui/tests/components/shell/shell-layout-contract.test.tsx`

**Interfaces:**

- Consumes: the desktop `sidebarCollapsed` state, browser `document.startViewTransition`,
  `matchMedia('(prefers-reduced-motion: reduce)')`, and rail transition names.
- Produces: an animated density change on supporting browsers, immediate reduced-motion and
  unsupported-browser changes, focus continuity, and exact main-width geometry.

- [ ] **Step 1: Write failing motion and geometry tests**

Stub `document.startViewTransition` and verify `toggleSidebar` calls it once. Stub reduced motion
and verify the same update occurs without the browser API. Focus the collapse control before a
toggle and assert focus remains on the renamed control afterward. Assert that the desktop
navigation column has a named element for workspace identity and each primary destination, but no
state renders duplicate `view-transition-name` values.

Update the geometry test to read the rail's actual desktop width class. Assert the collapsed column
does not use `lg:w-14`, `SHELL_DESKTOP_CHROME_COLLAPSED_PX` matches the measured column plus fixed
shell chrome, and `shellMainInlineSize` still agrees with the DOM-derived arithmetic at every width
from 320px through 3840px.

- [ ] **Step 2: Run the motion and geometry tests and verify red state**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/shell-full.test.tsx tests/components/shell/shell-layout-contract.test.tsx --maxWorkers=1
```

Expected: FAIL because `toggleSidebar` uses a direct state update and the rendered collapsed column
still exposes `lg:w-14`.

- [ ] **Step 3: Add the transition wrapper and use it in AppShell**

Implement the shell-local helper with a synchronous update and a reduced-motion guard:

```tsx
import { flushSync } from 'react-dom';

export function startNavigationTransition(update: () => void): void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced || typeof document === 'undefined' || !('startViewTransition' in document)) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
```

Call it around `setSidebarCollapsed`. Keep the persisted `docket.sidebar.collapsed` value and its
hydration effect. Do not move the state into the Sidebar.

- [ ] **Step 4: Add scoped transition styles and continuous layout motion**

Give named navigation elements an inline `viewTransitionName` only while their presentation is
mounted. Add a navigation-specific active transition selector that sets `:root` to `none` and
animates only `navigation-*` groups. Use `transition-[width] duration-200 ease-(--ease-out)` on
the desktop navigation column and `motion-reduce:transition-none` on that column and its label
opacity changes. Keep the main panel live in normal flex layout rather than a root snapshot.

- [ ] **Step 5: Run the focused motion and geometry tests and verify green state**

Run the command from Step 2. Expected: PASS with View Transition use, reduced-motion fallback,
one named element per state, focus retention, the new rail width, and unchanged main-width floor.

- [ ] **Step 6: Commit the motion and geometry slice**

Stage only the transition helper, shell/style updates, and shell tests. Commit with
`feat(ui): Animate navigation density changes`, a substantive body, and the Codex co-author trailer.

### Task 4: Run complete validation and capture the craft audit

**Files:**

- Create: `docs/design/audits/2026-08-25-md3-navigation-rail.md`
- Create: `docs/design/audits/screenshots/2026-08-25-md3-navigation-rail/*.png`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Consumes: the authenticated Web app, the completed desktop navigation rail, light and dark themes,
  and the existing design-review evidence conventions.
- Produces: test evidence, visual evidence, measurements, cleanup records, and a completed task.

- [ ] **Step 1: Run bounded repository validation**

Run focused UI tests first. Then run UI typecheck, UI lint, UI test, root typecheck, root lint, and
the production build with at most two workers. Run `~/.claude/resource-limits/agentctl status`
before the complete checks. If that helper remains absent, record its missing path and do not bypass
resource limits. If a command exits 137, reduce the affected command's scope or worker count before
trying again.

- [ ] **Step 2: Capture the authenticated desktop audit**

Reuse the existing authenticated Chrome session. Capture 1024 by 900 and 1440 by 900 in light and
dark themes. At each width, capture expanded navigation, collapsed rail, More open, active Inbox
with unread state, visible keyboard focus, and settled collapse and expansion endpoints. Measure
document width, rail width, active indicator bounds, label clipping, menu collision, and main-panel
width before and after collapse.

- [ ] **Step 3: Write the audit and update the work log**

Score the eight Craft Rubric dimensions against the captures. Record exact viewport dimensions,
theme parity, motion behavior, keyboard focus, overflow results, validation commands, known
browser fallbacks, and cleanup. Move `SHELL-NAV-RAIL-001` to Completed only after all required
validation and visual checks pass.

- [ ] **Step 4: Commit evidence and documentation**

Stage only the audit, screenshots, and work-log update. Commit with `chore(design): Record
navigation rail evidence`, a substantive body, and the Codex co-author trailer.

## Plan self-review

- **Spec coverage:** Task 1 establishes one catalog. Task 2 implements the expanded sidebar, rail,
  workspace switcher, More menu, static labels, loading behavior, and mobile drawer boundary. Task
  3 implements shared elements, normal layout motion, reduced motion, focus, and geometry. Task 4
  covers desktop themes, widths, menu, badges, keyboard focus, validation, and documentation.
- **Scope:** Personal reordering, favorites, and saved visibility remain out of scope. The plan does
  not add storage, routes, server data, or a new responsive breakpoint.
- **Consistency:** `ResolvedNavigationDestination`, `navigationTransitionName`,
  `startNavigationTransition`, and `SHELL-NAV-RAIL-001` keep the same names in every task. The
  six route destinations plus More remain the seven rendered rail items throughout the plan.
