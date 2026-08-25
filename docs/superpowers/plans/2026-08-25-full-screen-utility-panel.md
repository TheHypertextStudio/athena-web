# Full-Screen Compact Utility Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agenda, Focus, and Athena occupy the entire compact or medium viewport while keeping
the existing docked desktop rail.

**Architecture:** `AppShell` will keep one panel model and one breakpoint. Its compact Radix Sheet
will receive full-window geometry and an explicit app bar close action, while the generic Sheet
primitive and desktop `ShellAside` remain unchanged. Focus, dismissal, persistence, and panel-local
content continue through the existing controlled Sheet state.

**Tech Stack:** React 19, TypeScript, Radix Dialog/Sheet, Tailwind CSS 4, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-full-screen-utility-panel-design.md`

## Global Constraints

- Use one full-window utility pane for every viewport below 1024px.
- Keep the docked rail and vertical activity bar unchanged at 1024px and wider.
- Do not change Agenda, Focus, Athena, API, database, or persistence contracts.
- Keep the active-panel menu, Escape dismissal, focus trapping, opener focus restoration, safe-area
  handling, and panel-local state.
- Reuse the existing Chrome tab for visual verification. Do not open another browser instance.
- Do not create a pull request, push, or pull.

---

### Task 1: Pin the compact pane contract in shell tests

**Files:**

- Modify: `packages/ui/tests/components/shell/shell-full.test.tsx:499-570`

**Interfaces:**

- Consumes: `AppShell` with `aside: AppShellAside` and the existing `Show <panel>` trigger.
- Produces: assertions for the full-window dialog, compact pane app bar, close action, focus return,
  and unchanged hidden desktop host.

- [x] **Step 1: Replace the old partial-sheet assertion with the full-window contract**

Add these assertions after opening Tasks:

```tsx
const overlay = await screen.findByRole('dialog', { name: 'Tasks' });
expect(overlay).toHaveClass(
  'inset-0',
  'h-dvh',
  'w-screen',
  'max-w-none',
  'border-0',
  'shadow-none',
);
expect(overlay).not.toHaveClass('w-[22rem]', 'max-w-[90vw]');
expect(within(overlay).getByTestId('shell-utility-pane-bar')).toHaveClass(
  'min-h-12',
  'border-b',
  'pt-[env(safe-area-inset-top)]',
);
expect(within(overlay).getByRole('button', { name: 'Close Tasks' })).toHaveClass('size-10');
```

- [x] **Step 2: Add close and focus-restoration coverage**

Capture the `Show Tasks` trigger, open the pane, click `Close Tasks`, and wait for the dialog to
leave the tree. Assert that the original trigger has focus:

```tsx
const trigger = screen.getByRole('button', { name: 'Show Tasks' });
fireEvent.click(trigger);
const overlay = await screen.findByRole('dialog', { name: 'Tasks' });
fireEvent.click(within(overlay).getByRole('button', { name: 'Close Tasks' }));
await waitFor(() => expect(overlay).not.toBeInTheDocument());
expect(trigger).toHaveFocus();
```

- [x] **Step 3: Run the shell test and verify red state**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/shell-full.test.tsx --maxWorkers=1
```

Expected: the new geometry and close-action assertions fail against `w-[22rem] max-w-[90vw]`.

---

### Task 2: Implement the adaptive full-window pane

**Files:**

- Modify: `packages/ui/src/components/shell/AppShell.tsx:82-85,691-723`
- Test: `packages/ui/tests/components/shell/shell-full.test.tsx`

**Interfaces:**

- Consumes: `SheetClose`, the resolved `activePanel`, `MobilePanelSwitcher`, and
  `setOverlayPanelOpen`.
- Produces: one compact full-window modal pane below `DESKTOP_MEDIA_QUERY`, with no change to
  `SheetContent`, `ShellAside`, or `ShellActivityBar` public APIs.

- [x] **Step 1: Add the explicit close action dependencies**

Import `X` from `../../icons` and `SheetClose` from `../../primitives`:

```tsx
import { Menu, X } from '../../icons';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '../../primitives';
```

- [x] **Step 2: Replace the side-sheet geometry**

Use full dynamic-viewport geometry only on the shell's compact panel instance:

```tsx
className =
  '@container inset-0 flex h-dvh w-screen max-w-none flex-col overflow-hidden border-0 shadow-none';
```

The generic navigation drawer and `SheetContent` primitive keep their existing widths.

- [x] **Step 3: Build one safe-area app bar**

Wrap the panel selector and close action in this bar:

```tsx
<div
  data-testid="shell-utility-pane-bar"
  className="border-outline-variant flex min-h-12 shrink-0 items-center border-b px-2 pt-[env(safe-area-inset-top)]"
>
  <div className="min-w-0 flex-1">
    <MobilePanelSwitcher ... />
  </div>
  <SheetClose asChild>
    <button
      type="button"
      aria-label={`Close ${activePanel.label}`}
      className="text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
    >
      <X aria-hidden="true" className="size-5" />
    </button>
  </SheetClose>
</div>
```

- [x] **Step 4: Run focused tests and verify green state**

Run:

```bash
pnpm --filter @docket/ui exec vitest run tests/components/shell/shell-full.test.tsx --maxWorkers=1
```

Expected: every shell test passes, including menu switching, Escape dismissal, explicit close, and
desktop activity-bar coverage.

- [ ] **Step 5: Commit the behavior**

Stage only the shell source, shell test, corrected spec, and plan. Commit with scope `web`, a
substantive body, and the Codex co-author trailer.

---

### Task 3: Validate and record the final adaptive states

**Files:**

- Modify: `docs/WORKLOG.md`
- Create: `docs/design/audits/2026-08-25-full-screen-utility-panel.md`
- Create: `docs/design/audits/screenshots/2026-08-25-full-screen-utility-panel/*.png`

**Interfaces:**

- Consumes: the final authenticated shell at the feature worktree URL.
- Produces: a Craft Rubric scorecard and responsive evidence that supersede the partial-sheet
  screenshots for compact utility-panel geometry.

- [ ] **Step 1: Run bounded verification**

Run the focused shell suite, UI typecheck, UI lint, root lint, root typecheck, complete UI test
suite, and production build with no more than two concurrent workers. If a default Node heap aborts
without a lint or type error, rerun only that package with a command-scoped 4 GB heap and record it.

- [ ] **Step 2: Capture authenticated adaptive evidence**

Reuse the existing Chrome tab. Capture Agenda at 320x844, 390x844, and 768x1024 in light and dark.
Capture 1024x900 to prove that the docked rail returns at the desktop breakpoint. Measure document
overflow, dialog and viewport rectangles, top-bar and close target height, visible underlying page
pixels, scrollbar treatment, and focus visibility.

- [ ] **Step 3: Clean temporary runtime state**

Stop every dev process created for the audit. Delete the localhost audit cookie. Remove the isolated
audit database through Trash, and return the claimed Chrome tab to its original production route.
Do not touch `.data/docket`.

- [ ] **Step 4: Complete the scorecard and worklog**

Move `UTILITY-PANEL-FULL-001` to Completed only after the screenshots and gates pass. Record exact
test counts, geometry, theme parity, cleanup, and any bounded-memory rerun.

- [ ] **Step 5: Commit evidence and integrate locally**

Commit the scorecard, screenshots, and worklog. Fast-forward local `main` with `git merge --ff-only`.
Stash and restore the pre-existing `ATHENA-RAIL-001` worklog diff exactly. Verify zero merge commits,
the feature and main tips match, and no remote state changed.
