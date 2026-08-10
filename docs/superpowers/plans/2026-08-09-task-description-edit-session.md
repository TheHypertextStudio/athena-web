# Task-description edit-session implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one final task-description value per settled editing session so the append-only activity log records one meaningful change rather than partial sentences.

**Architecture:** Extend the shared debounced-autosave hook with one idempotent `flush()` control while preserving its 600ms default for existing consumers. Freeform documents opt into a 2,000ms delay and flush when focus leaves the whole editor or the component unmounts; the API and immutable audit writer remain unchanged.

**Tech Stack:** React 19 hooks, TanStack Query mutations, TipTap editor, Testing Library fake timers, Vitest.

---

### Task 1: Lock autosave session semantics with failing tests

**Files:**

- Create: `apps/web/tests/lib/use-debounced-autosave.test.tsx`
- Modify: `apps/web/tests/editor/editor-surface.test.tsx`

- [ ] **Step 1: Add a renderHook harness for the shared autosave hook**

Define a typed harness whose props are `value`, `baseline`, `delayMs`, and `save`, then render:

```tsx
const { result, rerender, unmount } = renderHook(
  ({ value, baseline, delayMs, save }) => useDebouncedAutosave({ value, baseline, delayMs, save }),
  { initialProps: { value: 'Before', baseline: 'Before', delayMs: 2_000, save } },
);
```

- [ ] **Step 2: Test one trailing save and explicit flush**

With fake timers, rerender through several values less than two seconds apart and prove `save` is
not called until 2,000ms after the final value. Then start another dirty value, call
`result.current.flush()`, and prove it saves immediately and advancing timers cannot duplicate it.

- [ ] **Step 3: Test clean, baseline, and cleanup cases**

Prove an undefined baseline, an unchanged value, and a baseline update matching the last-sent value
produce no write. Prove changing back to the baseline cancels a pending timer. Prove unmounting the
hook itself cancels its timer; unmount persistence belongs to the editor, which deliberately calls
`flush()`.

- [ ] **Step 4: Test editor blur and unmount behavior**

In `editor-surface.test.tsx`, render `EntityDocument` with an `onSave` spy, edit the description,
and assert no save at 1,999ms and one normalized final save at 2,000ms. Start another edit and
focus a button outside the editor to prove blur flushes immediately. Move focus between descendants
inside the editor wrapper and prove it does not flush. Unmount a dirty editor and prove one flush.

- [ ] **Step 5: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @docket/web test tests/lib/use-debounced-autosave.test.tsx tests/editor/editor-surface.test.tsx
```

Expected: failures because the hook currently returns `void`, has no flush control, and freeform
documents still use 600ms and do not flush on boundary exit.

### Task 2: Implement the idempotent autosave control

**Files:**

- Modify: `apps/web/src/lib/use-debounced-autosave.ts`

- [ ] **Step 1: Define the public control contract**

Add and document:

```ts
export interface DebouncedAutosaveControls {
  /** Persist the latest dirty value now and cancel its pending timer. */
  readonly flush: () => void;
}
```

Change `useDebouncedAutosave<T>` to return `DebouncedAutosaveControls`.

- [ ] **Step 2: Centralize pending state and idempotence**

Keep refs for the active timer, the pending canonical value key, the last-sent key, and the latest
`value`/`save`. Implement stable `flush()` so it returns when nothing is pending, clears the timer,
clears the pending key before calling `save`, records the sent key, and sends the latest value.

- [ ] **Step 3: Rebuild the scheduling effect around flush**

On every canonical value/baseline/ready/delay change, cancel the prior timer. If the value is clean,
unready, missing its baseline, or already sent against the current baseline, leave no pending work.
Otherwise store the value key and schedule `flush` after `delayMs`. Cleanup cancels only the timer;
it leaves pending data available for a consumer's unmount flush.

- [ ] **Step 4: Run the hook tests and verify GREEN**

Run:

```bash
pnpm --filter @docket/web test tests/lib/use-debounced-autosave.test.tsx
```

Expected: all autosave hook tests pass.

### Task 3: Apply edit-session boundaries to freeform documents

**Files:**

- Modify: `apps/web/src/components/editor/freeform-text.tsx`
- Modify: `apps/web/tests/editor/editor-surface.test.tsx`

- [ ] **Step 1: Opt the editor into the prose delay**

Capture the hook controls:

```tsx
const { flush } = useDebouncedAutosave({
  value: draft,
  baseline: value ?? '',
  delayMs: 2_000,
  save: normalizeAndSave,
});
```

Keep normalization identical: trim the Markdown and send `null` only when the result is empty.

- [ ] **Step 2: Flush only when focus leaves the whole editor**

Type the wrapper's blur handler as `React.FocusEvent<HTMLDivElement>`. If
`event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)`, return;
otherwise set `focused` false and call `flush()`.

- [ ] **Step 3: Flush once on unmount**

Keep the latest `flush` in a ref and register a mount-only effect whose cleanup calls that ref.
Because `flush` clears pending state before saving, the blur path, timeout, and unmount cleanup
cannot persist the same draft twice.

- [ ] **Step 4: Run the focused editor tests and verify GREEN**

Run:

```bash
pnpm --filter @docket/web test tests/lib/use-debounced-autosave.test.tsx tests/editor/editor-surface.test.tsx
```

Expected: all edit-session tests pass with no `act()` warnings.

### Task 4: Validate the activity outcome and commit

**Files:**

- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Re-run the existing API audit contract**

```bash
pnpm --filter @docket/api test tests/routes/task-activity.test.ts
```

Expected: the append-only writer still records exactly the one resolved description diff supplied
by one PATCH; no schema or server coalescing changes exist.

- [ ] **Step 2: Run web package checks**

```bash
pnpm --filter @docket/web typecheck
pnpm --filter @docket/web lint
pnpm --filter @docket/web test
```

Expected: every command exits 0.

- [ ] **Step 3: Update the work log and inspect the diff**

Mark `TASK-ACTIVITY-001` completed only after the hook, editor, web, and API evidence is green.
Record the 2,000ms boundary, blur/unmount semantics, exact tests, and the unchanged server ledger.

- [ ] **Step 4: Commit atomically**

Stage only autosave/editor implementation, tests, plan, and its WORKLOG completion. Commit with
`fix(web): Record one activity event per description edit session` and a substantive body explaining
why write suppression belongs before the append-only audit boundary.

### Task 5: Repository completion audit

**Files:**

- Modify: `docs/WORKLOG.md` only if final evidence changes the recorded result

- [ ] **Step 1: Run all repository gates**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: typecheck, lint, test, and build exit 0. If the unrelated marketing design-token ledger
mismatch remains, prove it is unchanged from the starting commit and report it without editing
those out-of-scope files.

- [ ] **Step 2: Audit every approved requirement**

Inspect the final source and focused test output for the 352px ceiling, search-only header, both
shortcuts, Tab focus movement, arrow/Enter/Escape behavior, balanced row insets, one 2-second
description save, blur/unmount flush, and one audit diff per PATCH.

- [ ] **Step 3: Verify Git integrity**

```bash
git status --porcelain=v1 -b
git rev-list --merges --count origin/main..HEAD
git log --oneline --decorate -5
```

Expected: only intended commits, no merge commits, and no uncommitted implementation files.
