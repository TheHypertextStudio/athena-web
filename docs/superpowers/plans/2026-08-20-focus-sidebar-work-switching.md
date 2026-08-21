# Focus Sidebar Work Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person create, find, and switch tracked tasks from one coherent Focus sidebar while
fixing the active-task card and removing the rejected Athena interruption field.

**Architecture:** A new Focus task-queue component owns the Hub Today plan and task-only remote
search. It delegates every start, create, and switch to the existing timer controls. The session
card keeps timer state and moves task navigation/editing into a right-aligned overflow menu.

**Tech Stack:** React 19, TypeScript, TanStack Query, Hono RPC client, Radix menu primitives,
Vitest/Testing Library, Playwright.

---

### Task 1: Lock the sidebar behavior with failing tests

**Files:**

- Modify: `apps/web/tests/time-tracking/focus-panel.test.tsx`
- Modify: `apps/web/tests/time-tracking/focus-immersive.test.tsx`
- Delete: `apps/web/tests/time-tracking/focus-athena-handoff.test.tsx`

- [ ] **Step 1: Add the Focus plan and search mocks**

Extend the API mock with `hub.today.$get` and `hub.search.$get`. Reset both mocks before each test.
Use a Hub Today payload whose `plan` contains the active task and two other real tasks.

- [ ] **Step 2: Write the failing Up next tests**

Add tests that assert the active task is absent from **Up next**, both other planned titles render,
selecting one posts its `taskId`, and typing a title then pressing Enter posts only that `label`.

```tsx
fireEvent.click(await screen.findByRole('button', { name: 'Draft the launch checklist' }));
await waitFor(() => {
  expect(recordsPost).toHaveBeenCalledWith({
    json: { context: { label: 'Draft the launch checklist', taskId: 'task_2' } },
  });
});

const field = screen.getByRole('searchbox', { name: 'Find or create a task' });
fireEvent.change(field, { target: { value: 'Write the launch notes' } });
fireEvent.keyDown(field, { key: 'Enter' });
await waitFor(() => {
  expect(recordsPost).toHaveBeenCalledWith({
    json: { context: { label: 'Write the launch notes' } },
  });
});
```

- [ ] **Step 3: Write the failing session-card tests**

Assert that the title link has wrapping classes and no inline Open/Edit sibling. Open `Task actions`
and assert that Open task and Rename task appear there. Assert that the control row exposes labeled
Pause or Resume and Finish controls plus an end-justified menu trigger.

- [ ] **Step 4: Prove Athena is absent from both Focus surfaces**

Remove the obsolete handoff unit suite. Delete its test mock from immersive Focus and assert that no
textbox named “Hand something to Athena” renders.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/time-tracking/focus-panel.test.tsx \
  tests/time-tracking/focus-immersive.test.tsx \
  --maxWorkers=1
```

Expected: FAIL because **Up next**, the task field, and the task-actions menu do not exist yet.

### Task 2: Build one Up next task surface

**Files:**

- Create: `apps/web/src/components/time-tracking/focus-task-queue.tsx`
- Modify: `apps/web/src/components/time-tracking/focus-panel.tsx`
- Modify: `apps/web/src/components/time-tracking/focus-idle.tsx`

- [ ] **Step 1: Implement the planned-task query**

Create `FocusTaskQueue`. Read `api.v1.hub.today.$get({ query: { date } })` through
`queryKeys.today(date)`. Filter the active task and preserve the accepted plan order.

- [ ] **Step 2: Implement task-only search and create**

Use `useRemoteSearch<SearchOut>` with a 180ms debounce, a one-character minimum, and this request:

```tsx
api.v1.hub.search.$get({
  query: {
    q: term,
    kinds: 'task',
    limit: '8',
    surface: 'palette',
  },
});
```

Render search results in place of planned rows. Selecting a result calls
`onStart({ taskId: result.entityId, label: result.title })`. Pressing Enter or selecting the create
row calls `onStart({ label: query.trim() })`.

- [ ] **Step 3: Compose the section without helper filler**

Render the heading **Up next**, then the search field, then the current plan or search rows. Do not
render “Select to switch,” a separate Switch task heading, timer icons on each row, or truncated
task titles. Show the workspace name as supporting text.

- [ ] **Step 4: Wire the queue into FocusPanel**

Change the parent start handler to accept the timer control input shape and return its promise.
Render `FocusTaskQueue` after the session/idle card. Remove the rail-only `useFocusTask` request and
`FocusTaskContext`, since the former lone workflow label is being replaced by actual upcoming work.
Remove duplicate recent-task shortcuts from the idle card.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Task 1 Vitest command. Expected: the Up next and create/switch tests pass while the
session-card tests still fail.

### Task 3: Correct the active card, Focus menu, and removed Athena surface

**Files:**

- Modify: `apps/web/src/components/time-tracking/focus-session.tsx`
- Modify: `apps/web/src/components/time-tracking/focus-mode-launcher.tsx`
- Modify: `apps/web/src/components/time-tracking/focus-immersive.tsx`
- Delete: `apps/web/src/components/time-tracking/focus-athena-handoff.tsx`

- [ ] **Step 1: Give the title its own row**

Render the anchored title as a full-width wrapping link with no adjacent icons. Keep the unanchored
name field full width.

- [ ] **Step 2: Normalize and separate the control row**

Always render the Pause/Resume and Finish labels. Replace the square Finish glyph with
`CircleStop`. Add a `Task actions` dropdown trigger with `className="ml-auto"`. Put Open task and
Rename task in the menu, and align its content to the end.

- [ ] **Step 3: Compact the Focus-mode launcher**

Replace the two stacked full-width buttons with one end-aligned `Focus mode` menu. Preserve a row
that uses the existing preferred pop-out/mobile fallback and a row that forces same-tab navigation.

- [ ] **Step 4: Remove the Athena interruption field**

Remove the handoff from rail and immersive compositions, then delete the component. Leave Personal
Athena APIs and normal entry points unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 Vitest command. Expected: all selected tests pass with no warnings.

### Task 4: Update the browser journey and validate the slice

**Files:**

- Modify: `apps/web/e2e/work/focus-companion.spec.ts`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Replace the handoff journey with sidebar creation**

Remove the Athena route interception and receipt assertions. In the rail, fill “Find or create a
task,” press Enter, and assert that the active task link changes to the new title before Focus mode
opens.

- [ ] **Step 2: Run focused unit tests**

Run the Task 1 Vitest command plus the task timer suite:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/time-tracking/focus-panel.test.tsx \
  tests/time-tracking/focus-immersive.test.tsx \
  tests/time-tracking/task-timer-button.test.tsx \
  --maxWorkers=1
```

- [ ] **Step 3: Run static validation**

Run `pnpm --filter @docket/web typecheck` and `pnpm --filter @docket/web lint` serially. Both must
exit zero.

- [ ] **Step 4: Run the Focus browser journey**

Run `pnpm --filter @docket/web exec playwright test e2e/work/focus-companion.spec.ts --workers=1`.
The journey must pass against the repository’s supported test stack.

- [ ] **Step 5: Inspect the rendered surface**

Capture the rail at 1440 by 900 and 390 by 844 in light and dark. Check running, paused, search,
long-title, empty-plan, and plan-error states. At 320px, assert that document and rail scroll widths
do not exceed their client widths. Keyboard-tab through the field, rows, timer controls, task menu,
and Focus-mode menu.

- [ ] **Step 6: Complete the worklog and commit**

Move `FOCUS-002` to Completed with changed behavior, validation evidence, and the explicit decision
to remove the interruption handoff from Focus. Stage only this feature’s files. Commit with scope
`time` and a substantive body.
