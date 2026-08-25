# Scalable Utility Panel Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile utility sheet's horizontal panel buttons with one scalable menu and reduce the partial-day work-location track without weakening interaction or collision behavior.

**Architecture:** `AppShell` will delegate mobile panel selection to one shell-owned `MobilePanelSwitcher` that consumes the existing `RailPanel` contract and reports a selected id. Work-location composition will keep the generic scheduling inset seam but reduce its consumer constant to 32px, while visual and gesture geometry share that constant so 40px controls end at the event boundary.

**Tech Stack:** React 19, TypeScript, Radix DropdownMenu through Docket primitives, Tailwind design tokens, Vitest, Testing Library, Next.js App Router.

---

### Task 1: Replace the mobile panel tab row with one named menu

**Files:**

- Create: `packages/ui/src/components/shell/MobilePanelSwitcher.tsx`
- Modify: `packages/ui/src/components/shell/AppShell.tsx`
- Test: `packages/ui/tests/components/shell/shell-full.test.tsx`

- [ ] **Step 1: Replace the existing mobile-tab test with a failing five-panel menu contract**

Build five `RailPanel` fixtures in the test and assert the desired public behavior through
`AppShell`:

```tsx
const panels = [
  TASKS_PANEL,
  AGENDA_PANEL,
  { id: 'focus', label: 'Focus', icon: <Home />, node: <div>Focus body</div> },
  { id: 'athena', label: 'Athena', icon: <Home />, node: <div>Athena body</div> },
  { id: 'inbox', label: 'Inbox', icon: <Home />, node: <div>Inbox body</div> },
];

fireEvent.click(screen.getByRole('button', { name: 'Show Tasks' }));
const overlay = await screen.findByRole('dialog', { name: 'Tasks' });
expect(within(overlay).queryByRole('tablist')).not.toBeInTheDocument();

const trigger = within(overlay).getByRole('button', {
  name: 'Panel: Tasks. Switch panel',
});
fireEvent.click(trigger);
expect(screen.getAllByRole('menuitem')).toHaveLength(5);
fireEvent.click(screen.getByRole('menuitem', { name: 'Agenda' }));
expect(await screen.findByRole('dialog', { name: 'Agenda' })).toBeInTheDocument();
expect(screen.getByText('Agenda body')).toBeInTheDocument();
```

- [ ] **Step 2: Run the test and verify the old horizontal tablist fails the new contract**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/shell-full.test.tsx \
  -t "switches between panels from one mobile sheet menu" --maxWorkers=1
```

Expected: FAIL because the sheet still exposes `role="tablist"` and has no named panel-menu
trigger.

- [ ] **Step 3: Create the focused mobile switcher**

Implement a component with this public contract:

```tsx
export interface MobilePanelSwitcherProps {
  readonly panels: readonly RailPanel[];
  readonly activePanel: RailPanel;
  readonly onSelect: (id: string) => void;
}

export function MobilePanelSwitcher({
  panels,
  activePanel,
  onSelect,
}: MobilePanelSwitcherProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Panel: ${activePanel.label}. Switch panel`}
          className="focus-visible:ring-ring flex h-10 max-w-full min-w-0 items-center gap-2 rounded-lg px-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="shrink-0 [&_svg]:size-4">{activePanel.icon}</span>
          <span className="min-w-0 flex-1 truncate text-left">{activePanel.label}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="lg">
        {panels.map((panel) => (
          <DropdownMenuItem
            key={panel.id}
            selected={panel.id === activePanel.id}
            supporting={panel.status?.label}
            onSelect={() => {
              onSelect(panel.id);
            }}
          >
            <span aria-hidden="true" className="shrink-0 [&_svg]:size-4">
              {panel.icon}
            </span>
            <span className="truncate">{panel.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Use the shared `DropdownMenu` primitives and `ChevronDown` icon. Do not create a second menu style.

- [ ] **Step 4: Replace the `AppShell` tablist with the switcher**

Render the switcher as the sheet's single shrink-free header control. Selection must use the
existing persistence key without invoking desktop collapse behavior:

```tsx
<MobilePanelSwitcher
  panels={panels}
  activePanel={activePanel}
  onSelect={(panelId) => {
    setRail((current) => ({ ...current, activeId: panelId }));
    writeRailState(RAIL_ACTIVE_KEY, panelId);
  }}
/>
```

Keep `SheetTitle` synchronized with `activePanel.label`. Remove the horizontal `role="tablist"`
branch completely.

- [ ] **Step 5: Run the focused shell test and verify it passes**

Run the Step 2 command. Expected: PASS with no React, Radix, or accessibility warnings.

- [ ] **Step 6: Add status, persistence, long-label, and keyboard coverage**

Add focused assertions that:

```tsx
expect(screen.getByRole('menuitem', { name: /Focus.*tracking Deep work/ })).toBeInTheDocument();
expect(window.localStorage.getItem('docket.rail.active')).toBe('agenda');
expect(trigger.querySelector('.truncate')).toHaveTextContent(longPanelName);
await user.keyboard('{ArrowDown}{End}{Enter}');
expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeInTheDocument();
```

The long name must remain one line and truncate. The menu must retain Radix Home, End, arrow, Enter,
and Escape behavior instead of reimplementing keyboard handling.

- [ ] **Step 7: Run the complete shell suite**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/shell-full.test.tsx \
  tests/components/shell/shell-layout-contract.test.tsx --maxWorkers=1
```

Expected: both files pass. Desktop activity-bar collapse and switching assertions remain green.

- [ ] **Step 8: Commit the shell slice**

Stage only the new switcher, `AppShell`, and shell tests. Commit with `git commit -F -` using a
substantive `fix(web): Scale utility panel switching` message and the Codex co-author trailer.

---

### Task 2: Narrow the work-location track without shrinking controls

**Files:**

- Modify: `apps/web/src/components/work-location/work-location-calendar-components.tsx`
- Test: `apps/web/tests/work-location/work-location-calendar-components.test.tsx`
- Test: `apps/web/tests/work-location/use-work-location-calendar-composition.test.tsx`
- Test: `apps/web/tests/agenda/agenda-canvas-interactions.test.tsx`

- [ ] **Step 1: Change the consumer geometry assertions before production code**

Update only work-location-specific expectations. Generic scheduling tests may continue using 40px
as an arbitrary inset value.

```tsx
expect(
  resolveWorkLocationTimedLeadingInset({
    regions,
    lane: firstLane,
    bounds: { startMinutes: 480, endMinutes: 600 },
    displayTimezone: 'UTC',
  }),
).toBe(32);

expect(screen.getByTestId('work-location-band')).toHaveClass('left-1.5', 'w-3');
expect(screen.getByTestId('work-location-rail')).toHaveClass('left-[11px]', 'w-0.5');
expect(move).toHaveClass('-left-2', 'size-10');
expect(resizeStart).toHaveStyle({ left: '-8px', width: '40px', height: '40px' });
```

Assert that every 40px move or resize box ends at `32px`, which is the same coordinate where an
intersecting event begins.

- [ ] **Step 2: Run the work-location tests and verify the 40px implementation fails**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/work-location/work-location-calendar-components.test.tsx \
  tests/work-location/use-work-location-calendar-composition.test.tsx \
  tests/agenda/agenda-canvas-interactions.test.tsx --maxWorkers=1
```

Expected: FAIL on the 40px inset, 28px band, and zero-offset gesture targets.

- [ ] **Step 3: Make the track constant and every visual share the new geometry**

Change the work-location consumer constant and classes:

```tsx
export const WORK_LOCATION_TIMED_TRACK_WIDTH_PX = 32;

const TIMED_CONTROL_LEFT_PX = WORK_LOCATION_TIMED_TRACK_WIDTH_PX - 40;
```

Use `left-1.5 w-3` for the tint, `left-[11px] w-0.5` for the rail, `left-0` for the 24px preview
marker, and `-left-2` for the 40px move target. Set both resize controls to
`left: TIMED_CONTROL_LEFT_PX`. Apply the same tint, line, and marker coordinates to previews.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the Step 2 command. Expected: all three files pass with no warnings.

- [ ] **Step 5: Run scheduling geometry and dense-overflow regression tests**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/scheduling/scheduling-composition-seams.test.tsx \
  tests/scheduling/scheduling-dense-overflow.test.ts \
  tests/scheduling/scheduling-dense-overflow-ui.test.tsx \
  tests/scheduling/scheduling-item-presentation.test.tsx --maxWorkers=1
```

Expected: all resting, preview, boundary-crossing, and overflow geometry tests pass. The generic
inset seam stays consumer-defined.

- [ ] **Step 6: Commit the location slice**

Stage only the work-location implementation and directly affected tests. Commit with
`git commit -F -` using a substantive `fix(web): Narrow work location tracks` message and the Codex
co-author trailer.

---

### Task 3: Verify the complete interaction contract

**Files:**

- Modify: `docs/WORKLOG.md`
- Create: `docs/design/audits/2026-08-25-scalable-utility-panel-switcher.md`
- Create: `docs/design/audits/screenshots/2026-08-25-scalable-utility-panel-switcher/*`

- [ ] **Step 1: Run focused typecheck, lint, formatting, and tests**

Run with bounded concurrency:

```bash
pnpm --filter @docket/ui typecheck
pnpm --filter @docket/web typecheck
pnpm --filter @docket/ui exec eslint src/components/shell/AppShell.tsx \
  src/components/shell/MobilePanelSwitcher.tsx tests/components/shell/shell-full.test.tsx
pnpm --filter @docket/web exec eslint \
  src/components/work-location/work-location-calendar-components.tsx \
  tests/work-location/work-location-calendar-components.test.tsx
pnpm exec prettier --check \
  packages/ui/src/components/shell/MobilePanelSwitcher.tsx \
  packages/ui/src/components/shell/AppShell.tsx \
  packages/ui/tests/components/shell/shell-full.test.tsx \
  apps/web/src/components/work-location/work-location-calendar-components.tsx \
  apps/web/tests/work-location/work-location-calendar-components.test.tsx
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Run the focused shell, Agenda, scheduling, and work-location slice**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/shell-full.test.tsx \
  tests/components/shell/shell-layout-contract.test.tsx --maxWorkers=1
pnpm --filter @docket/web exec vitest run \
  tests/agenda tests/scheduling tests/work-location/work-location-calendar-components.test.tsx \
  tests/work-location/use-work-location-calendar-composition.test.tsx --maxWorkers=1
```

Expected: every selected file passes.

- [ ] **Step 3: Run repository gates with bounded concurrency**

Check `~/.claude/resource-limits/agentctl status` first. Then run `pnpm typecheck`, `pnpm lint`,
`pnpm test`, and `pnpm build` with Turbo concurrency 2 or each package's two-worker option. If a
2GB Node process exits 137 or exhausts its heap, do not repeat it unchanged. Use the repository's
documented package-scoped 4GB heap only for that package.

- [ ] **Step 4: Capture visual proof without opening another browser**

Reuse one existing authenticated Chrome tab. Capture 390 by 844 and 320 by 844 in light and dark.
For the five-choice stress state, apply a temporary uncommitted patch to `railAsideFor` that appends
`Documents` and `Inbox` fixture panels with static local nodes to the real Agenda, Focus, and Athena
panels. Capture the open menu in the authenticated shell, remove that exact patch with `apply_patch`,
and verify that `apps/web/src/components/app-shell-frame.tsx` has no remaining diff. Then capture the
real three-panel shell and populated partial-day overlap with the menu closed. Measure document
`clientWidth === scrollWidth`, the 32px event inset, 12px tint, 40px gesture targets, focus
visibility, native schedule scrolling, and absent scrollbar chrome. Label the stress capture as a
temporary visual fixture in the scorecard so it cannot be mistaken for shipped panel inventory.

- [ ] **Step 5: Write the scorecard and close the work log**

Record the exact screenshots, measurements, test counts, gate outcomes, any command-scoped resource
exception, and removal of temporary authenticated fixtures. Move `UTILITY-PANEL-SCALE-001` from
Active Tasks to Completed Tasks only after every required gate and capture passes.

- [ ] **Step 6: Commit evidence and documentation**

Stage only the scorecard, screenshots, and worklog. Commit with `git commit -F -` using a substantive
`chore(design): Record scalable utility panel navigation` message and the Codex co-author trailer.

---

### Task 4: Integrate the completed work locally

**Files:**

- Verify only; no new source file is required.

- [ ] **Step 1: Run the completion audit against the approved design**

For every decision, accessibility rule, failure boundary, test, and visual requirement in
`docs/superpowers/specs/2026-08-25-scalable-utility-panel-switcher-design.md`, cite current code,
test output, or screenshot evidence. Treat missing or indirect evidence as incomplete.

- [ ] **Step 2: Verify clean linear history**

Run:

```bash
git status --short --branch
git rev-list --merges --count main..HEAD
git log --oneline main..HEAD
```

Expected: the feature worktree is clean and the merge count is zero.

- [ ] **Step 3: Fast-forward local main without losing concurrent work**

Inspect `/Users/williecubed/.codex/worktrees/2110/athena-web` first. Preserve any exact uncommitted
change in a named stash, run `git merge --ff-only codex/agenda-rail-polish`, and reapply the change.
Verify the semantic diff after reapplication. Do not create a PR, push, pull, or open a browser.

- [ ] **Step 4: Verify the integrated state**

Confirm local `main` and the feature branch resolve to the same SHA, the integration added zero
merge commits, and any pre-existing main-worktree diff remains present. Mark the goal complete only
after this evidence proves every design requirement.
