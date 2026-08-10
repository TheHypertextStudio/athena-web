# Task Header Responsive Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the task-detail control row on one line and preserve every collapsed action in an always-available overflow menu.

**Architecture:** A named-container `TaskHeaderControls` component owns only the one-line layout and its three visibility tiers. A sibling `TaskHeaderOverflowMenu` owns task-specific menu behavior, reusing small timer and Athena menu-item components so inline buttons and overflow rows call the same underlying hooks. The route supplies task data and existing mutation callbacks.

**Tech Stack:** React 19, TypeScript, Tailwind v4 named container queries, Radix-based `@docket/ui` dropdown menus, Vitest, Testing Library.

## Global Constraints

- The header control row must never wrap or scroll horizontally.
- Status remains inline at every width.
- Priority and Assignee remain inline at the middle and wide tiers.
- Tracking, `Have Athena handle this`, and delegate context remain inline only at the wide tier.
- The ellipsis remains inline for every viewer and always exposes Priority, Assignee, Tracking, and Athena; Delete remains management-only.
- Existing mutation, pending, error, and permission behavior must not change.
- Use container queries, not viewport media queries or JavaScript measurement.
- Preserve the marketing layout while repairing only the authorized design-token policy debt.

---

### Task 1: Repair the inherited marketing design-token policy failure

**Files:**

- Modify: `apps/web/src/components/marketing/agents-strip.tsx`
- Modify: `apps/web/src/components/marketing/closing-section.tsx`
- Modify: `apps/web/src/components/marketing/feature-band.tsx`
- Modify: `apps/web/src/components/marketing/feature-split.tsx`
- Modify: `apps/web/src/components/marketing/organizations-pair.tsx`
- Modify: `apps/web/src/components/marketing/placeholder-surface.tsx`
- Modify: `apps/web/src/components/marketing/secondary-list.tsx`
- Modify: `packages/test-utils/tests/design-policies/design-token-debt.json`
- Test: `packages/test-utils/tests/design-policies/design-token-policy.test.ts`

**Interfaces:**

- Consumes: the existing closed MD3 typography roles from `packages/ui/src/primitives/text.tsx`.
- Produces: the same marketing structure and copy, with no unledgered raw typography utilities or stale ledger paths.

- [x] **Step 1: Preserve the observed red test**

  Run: `pnpm --filter @docket/test-utils exec vitest run tests/design-policies/design-token-policy.test.ts`

  Expected: FAIL naming seven new marketing components and stale entries for deleted marketing files.

- [x] **Step 2: Replace raw typography utilities with equivalent semantic roles**

  Apply these literal mappings without changing layout, copy, colors, or spacing:

  ```text
  text-4xl tracking-tight -> text-display-small
  text-3xl tracking-tight -> text-headline-large
  text-xl tracking-tight -> text-title-large
  text-base -> text-body-large
  font-mono text-xs supporting copy -> font-mono text-body-small
  font-mono text-xs labels -> font-mono text-label-small
  ```

- [x] **Step 3: Regenerate the current debt ledger**

  Run: `pnpm --filter @docket/test-utils exec tsx tests/design-policies/emit-ledger.ts`

  Inspect the diff and keep only removals/count reductions caused by the current marketing tree; do not add allowances for the seven new files.

- [x] **Step 4: Verify the focused policy is green**

  Run: `pnpm --filter @docket/test-utils exec vitest run tests/design-policies/design-token-policy.test.ts`

  Expected: 8 tests passed.

- [x] **Step 5: Commit the isolated baseline repair**

  Stage only the seven marketing components and `design-token-debt.json`. Commit as `fix(marketing): Restore the design-token policy after the homepage redesign` with a substantive body explaining that semantic roles preserve the intended hierarchy and deleted paths were removed from the ratchet.

### Task 2: Commit the approved responsive contract

**Files:**

- Create: `docs/superpowers/specs/2026-08-09-task-header-overflow-design.md`
- Create: `docs/superpowers/plans/2026-08-09-task-header-overflow.md`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Consumes: the user-approved visibility priority and the now-green repository baseline.
- Produces: the committed design and executable plan governing Tasks 3-5.

- [x] **Step 1: Self-review the documents**

  Run: `rg -n "TB[D]|TO[D]O|implement la[t]er|similar t[o]" docs/superpowers/specs/2026-08-09-task-header-overflow-design.md docs/superpowers/plans/2026-08-09-task-header-overflow.md`

  Expected: no placeholder matches.

- [x] **Step 2: Verify the documentation diff**

  Run: `git diff --check && git diff -- docs/WORKLOG.md docs/superpowers/specs/2026-08-09-task-header-overflow-design.md docs/superpowers/plans/2026-08-09-task-header-overflow.md`

  Expected: no whitespace errors; the worklog and both documents agree on tiers and scope.

- [ ] **Step 3: Commit the design checkpoint**

  Stage only the three documentation files. Commit as `chore(web): Record the task-header overflow contract` with a substantive body describing the approved visibility order and TDD execution path.

### Task 3: Add overflow-compatible timer and Athena actions

**Files:**

- Modify: `apps/web/src/components/time-tracking/task-timer-button.tsx`
- Modify: `apps/web/src/components/time-tracking/index.ts`
- Modify: `apps/web/src/components/athena/athena-context-action.tsx`
- Modify: `apps/web/tests/time-tracking/task-timer-button.test.tsx`
- Modify: `apps/web/tests/athena/context-action.test.tsx`

**Interfaces:**

- Produces: `TaskTimerMenuItem({ taskId, title }): JSX.Element` and `AthenaContextMenuItem({ label, context }): JSX.Element`.
- Both menu items consume the same `useTimerState`/`useTimerControls` and `useAthenaPanel` hooks as their inline counterparts.

- [ ] **Step 1: Write failing behavior tests**

  Add a timer test that opens a real `DropdownMenu`, selects `Track this task`, and expects the existing records POST body `{ context: { label: 'Ship it', taskId: 'task_1' } }`. Add an Athena test that opens a real menu, selects `Have Athena handle this`, and expects the real provider's dock to open with the supplied task context.

- [ ] **Step 2: Verify RED**

  Run: `pnpm --filter @docket/web exec vitest run tests/time-tracking/task-timer-button.test.tsx tests/athena/context-action.test.tsx`

  Expected: FAIL because `TaskTimerMenuItem` and `AthenaContextMenuItem` are not exported.

- [ ] **Step 3: Implement shared action state and menu rows**

  Extract a file-local `useTaskTimerAction(taskId, title)` returning `{ active, tracking, label, disabled, run }`; keep `TaskTimerButton` on it and render `TaskTimerMenuItem` with `DropdownMenuItem`, `Pause`/`Play`, and `onSelect={run}`. Add `AthenaContextMenuItem` beside `AthenaContextAction`, rendering `DropdownMenuItem` with `Sparkles` and `onSelect={() => openAthena(context)}`.

- [ ] **Step 4: Verify GREEN**

  Run the same focused command and expect both files to pass with no warnings.

### Task 4: Build the one-line header and task overflow menu

**Files:**

- Create: `apps/web/src/components/task-detail/task-header-controls.tsx`
- Create: `apps/web/tests/task-detail/task-header-controls.test.tsx`

**Interfaces:**

- `TaskHeaderControlsProps` consumes `status`, `priority`, `assignee`, optional `delegate`, `actions`, and `overflow` React nodes.
- `TaskHeaderOverflowMenuProps` consumes `taskId`, `title`, `athenaContext`, `priority`, `priorityPending`, `memberOptions`, `assigneeId`, `canEdit`, `canManage`, `onPriorityChange`, `onAssigneeChange`, and `onDelete`.

- [ ] **Step 1: Write the structural and interaction regression tests**

  Render `TaskHeaderControls` with recognizable real buttons. Assert the root has `@container/task-header`, `flex-nowrap`, and no descendant class contains `flex-wrap`; assert metadata is `hidden @md/task-header:flex`, wide context/actions are `hidden @3xl/task-header:flex`, and overflow is always rendered. Render `TaskHeaderOverflowMenu`, open `Task actions`, then select a priority and assignee and assert the supplied callbacks receive literal values. Verify Delete is absent for non-managers and invokes `onDelete` for managers.

- [ ] **Step 2: Verify RED**

  Run: `pnpm --filter @docket/web exec vitest run tests/task-detail/task-header-controls.test.tsx`

  Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal one-line layout**

  Use this structure:

  ```tsx
  <div className="@container/task-header flex min-w-0 flex-nowrap items-center gap-2">
    <span className="shrink-0">{status}</span>
    <span className="hidden min-w-0 items-center gap-2 @md/task-header:flex">
      {priority}
      {assignee}
    </span>
    <span className="min-w-0 flex-1" aria-hidden="true" />
    <span className="hidden min-w-0 items-center gap-2 @3xl/task-header:flex">
      {delegate}
      {actions}
    </span>
    <span className="shrink-0">{overflow}</span>
  </div>
  ```

  Implement the overflow with Radix submenus and radio items for Priority and Assignee, followed by `TaskTimerMenuItem`, `AthenaContextMenuItem`, and the permission-gated Delete row.

- [ ] **Step 4: Verify GREEN**

  Run the focused test and expect all cases to pass.

### Task 5: Integrate, validate, document, and commit

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Consumes: `TaskHeaderControls`, `TaskHeaderOverflowMenu`, existing task mutation callbacks, and the existing delete confirmation state.
- Produces: the task-detail header behavior visible to users.

- [ ] **Step 1: Replace the wrapping route markup**

  Remove the route's `flex flex-wrap` control row and inline management-only dropdown. Compose the existing `StatusPicker`, `PriorityPicker`, `ActorPicker`, delegate display, `TaskTimerButton`, and `AthenaContextAction` into `TaskHeaderControls`, with `TaskHeaderOverflowMenu` always present.

- [ ] **Step 2: Run focused web verification**

  Run: `pnpm --filter @docket/web exec vitest run tests/task-detail/task-header-controls.test.tsx tests/time-tracking/task-timer-button.test.tsx tests/athena/context-action.test.tsx`

  Expected: all focused tests pass.

- [ ] **Step 3: Run the repository gates**

  Run, in order: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `git diff --check`, and `git rev-list --merges --count origin/main..HEAD`.

  Expected: every command exits 0 and the merge count is `0`.

- [ ] **Step 4: Complete the worklog**

  Move `TASK-HEADER-OVERFLOW-001` to Completed and record the exact focused/full validation evidence plus the marketing-policy prerequisite as a separate atomic commit.

- [ ] **Step 5: Commit the product fix**

  Stage only the task-header implementation, focused tests, and worklog. Commit as `fix(web): Collapse task-header actions instead of wrapping` with a substantive body describing the container tiers, persistent overflow access, and preserved permissions.
