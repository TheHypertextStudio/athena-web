# Label Hotkey and Palette Sub-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `L` inline-edit label hotkey and the `#` command-palette label sub-mode specced in `docs/engineering/specs/design-system.md` but never built.

**Architecture:** A shared `PickerOverlayProvider` (React context) owns one moved Radix popover that edits labels on N tasks at once, opened either by a new `onPropertyKey`/`onRowPropertyKey` extension point on `useListKeyboard`/`EntityTable` (the `L` hotkey) or by a new `task.label` registry action (the right-click menu). The command palette gets a small, honest sub-mode mechanism (`parsePrefix` + a per-mode hook, not a hook-in-a-loop registry — React's rules of hooks rule that out) with `#` as the first and only mode.

**Tech Stack:** TypeScript, React 19, Next.js App Router, TanStack Query v5, Radix Popover, Vitest + Testing Library.

## Global Constraints

- Base branch for this work is `claude/label-definition-ux-c2d23f` (LABELS-001) — already merged into this worktree. Do not rebase onto `main` until Task 10.
- Commit messages: Conventional Commits (`feat`/`fix`/`chore`, scope from `COMMIT_SCOPES.txt`, ≥100 non-comment-char body). Use `feat(ui)` for `packages/ui` changes and `feat(web)` for `apps/web` changes, per the file each commit touches.
- Every commit must pass its own package's typecheck/lint/tests before moving on — do not let failures accumulate across tasks.
- No `// TODO`, no stub implementations, no skipped tests.
- Follow the git-staging workflow: `git restore --staged . && git add <paths> && git commit -F <message-file>` as one chained command, message via a temp file (no `-m`).

---

### Task 1: `useListKeyboard` — text-input guard + property-key dispatch

**Files:**

- Modify: `packages/ui/src/hooks/useListKeyboard.tsx`
- Test: `packages/ui/tests/hooks/hooks.test.tsx`

**Interfaces:**

- Produces: `ListKeyboardEvent` gains optional `target?: EventTarget | null`, `ctrlKey?: boolean`, `metaKey?: boolean`, `altKey?: boolean` (all optional, so every existing caller/test is unaffected). `UseListKeyboardOptions` gains `onPropertyKey?: (key: string, index: number) => boolean`. The dispatched `key` is always lowercased.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/tests/hooks/hooks.test.tsx`, inside the existing `describe('useListKeyboard', ...)` block (after the `'ignores unrelated keys'` test, before the `'setActiveIndex clamps...'` test). First, extend the local `keyEvent` helper (near the top of the file) to accept overrides:

```ts
/** Minimal KeyboardEvent stand-in for the hook's handler (only the fields it reads). */
function keyEvent(key: string, overrides: Partial<ListKeyboardEvent> = {}): ListKeyboardEvent {
  return { key, preventDefault: vi.fn(), ...overrides };
}
```

Then add:

```ts
it('ignores every handled key when the event target is a text-entry element', () => {
  const onActiveChange = vi.fn();
  const { result } = renderHook(() => useListKeyboard({ rowCount: 3, onActiveChange }));
  const input = document.createElement('input');
  act(() => {
    result.current.onKeyDown(keyEvent('ArrowDown', { target: input }));
  });
  expect(result.current.activeIndex).toBe(-1);
  expect(onActiveChange).not.toHaveBeenCalled();
});

it('ignores a handled key when the target is contenteditable', () => {
  const { result } = renderHook(() => useListKeyboard({ rowCount: 3, initialIndex: 1 }));
  const div = document.createElement('div');
  Object.defineProperty(div, 'isContentEditable', { value: true });
  act(() => {
    result.current.onKeyDown(keyEvent('Escape', { target: div }));
  });
  expect(result.current.activeIndex).toBe(1);
});

it('fires onPropertyKey for an unmodified letter on the active row and consumes it when handled', () => {
  const onPropertyKey = vi.fn().mockReturnValue(true);
  const { result } = renderHook(() =>
    useListKeyboard({ rowCount: 3, initialIndex: 1, onPropertyKey }),
  );
  const event = keyEvent('l');
  act(() => {
    result.current.onKeyDown(event);
  });
  expect(onPropertyKey).toHaveBeenCalledWith('l', 1);
  expect(event.preventDefault).toHaveBeenCalled();
});

it('lowercases the dispatched key', () => {
  const onPropertyKey = vi.fn().mockReturnValue(true);
  const { result } = renderHook(() =>
    useListKeyboard({ rowCount: 2, initialIndex: 0, onPropertyKey }),
  );
  act(() => {
    result.current.onKeyDown(keyEvent('L'));
  });
  expect(onPropertyKey).toHaveBeenCalledWith('l', 0);
});

it('leaves an unhandled property key untouched (no preventDefault)', () => {
  const onPropertyKey = vi.fn().mockReturnValue(false);
  const { result } = renderHook(() =>
    useListKeyboard({ rowCount: 2, initialIndex: 0, onPropertyKey }),
  );
  const event = keyEvent('q');
  act(() => {
    result.current.onKeyDown(event);
  });
  expect(event.preventDefault).not.toHaveBeenCalled();
});

it('never dispatches onPropertyKey for a modified keystroke', () => {
  const onPropertyKey = vi.fn();
  const { result } = renderHook(() =>
    useListKeyboard({ rowCount: 3, initialIndex: 0, onPropertyKey }),
  );
  act(() => {
    result.current.onKeyDown(keyEvent('l', { metaKey: true }));
  });
  act(() => {
    result.current.onKeyDown(keyEvent('l', { ctrlKey: true }));
  });
  act(() => {
    result.current.onKeyDown(keyEvent('l', { altKey: true }));
  });
  expect(onPropertyKey).not.toHaveBeenCalled();
});

it('does not dispatch onPropertyKey when no row is active', () => {
  const onPropertyKey = vi.fn();
  const { result } = renderHook(() => useListKeyboard({ rowCount: 3, onPropertyKey }));
  act(() => {
    result.current.onKeyDown(keyEvent('l'));
  });
  expect(onPropertyKey).not.toHaveBeenCalled();
});

it('does not dispatch onPropertyKey for multi-character keys (arrows, Enter, etc.)', () => {
  const onPropertyKey = vi.fn();
  const { result } = renderHook(() =>
    useListKeyboard({ rowCount: 3, initialIndex: 0, onPropertyKey }),
  );
  act(() => {
    result.current.onKeyDown(keyEvent('ArrowDown'));
  });
  expect(onPropertyKey).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @docket/ui test -- hooks.test.tsx`
Expected: FAIL — `ListKeyboardEvent`/`UseListKeyboardOptions` don't know `target`/`onPropertyKey` yet (or the new assertions fail against current behavior).

- [ ] **Step 3: Implement**

Replace the full contents of `packages/ui/src/hooks/useListKeyboard.tsx` with:

````tsx
'use client';

/**
 * `@docket/ui` — grid keyboard navigation for the virtualized {@link ListView}.
 *
 * @remarks
 * Provides roving keyboard navigation over the *flattened* rows of a {@link ListView}
 * (group headers, sub-group headers, and data rows all count as navigable rows). It owns the
 * active row index and translates key presses into index moves and activation:
 *
 * - `ArrowDown` / `ArrowUp` — move the active row by one (clamped to the ends).
 * - `Home` / `End` — jump to the first / last row.
 * - `Enter` — activate the active row (toggles a group, opens a data row).
 * - `Escape` — clear the active row.
 * - an unmodified single letter on an active row — a property-edit hotkey (`onPropertyKey`),
 *   e.g. `L` for labels.
 *
 * A keydown whose target is a text-entry element (an `input`, `textarea`, `select`, or anything
 * `contentEditable`) is ignored entirely, at every key above — a row rendering an inline editor
 * must keep its own keystrokes.
 *
 * The hook is presentation-agnostic: it does not touch the DOM beyond returning an
 * `onKeyDown` handler and the current `activeIndex`, so the {@link ListView} can scroll the
 * active row into view through its virtualizer.
 */
import * as React from 'react';

/** The keyboard event fields {@link useListKeyboard} reads. */
export interface ListKeyboardEvent {
  /** The pressed key value. */
  readonly key: string;
  /** The event's target, used only for the text-entry guard. */
  readonly target?: EventTarget | null;
  /** Modifier state, used only to exclude modified keystrokes from `onPropertyKey`. */
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  /** Prevent the browser's default key behavior when the hook handles it. */
  preventDefault: () => void;
}

/** Options for {@link useListKeyboard}. */
export interface UseListKeyboardOptions {
  /** Total number of navigable (flattened) rows. */
  rowCount: number;
  /** Activate the row at `index` (Enter): toggles a group or opens a data row. */
  onActivate?: (index: number) => void;
  /** Called whenever the active index changes, so the host can scroll it into view. */
  onActiveChange?: (index: number) => void;
  /** The initial active index. Defaults to `-1` (no active row). */
  initialIndex?: number;
  /**
   * Handle a plain (unmodified) single-letter keydown on the active row — a property-edit
   * hotkey (`L` for labels, and future `S`/`A`/`P`/`D`).
   *
   * @remarks
   * Never called when no row is active, when a modifier (`⌘`/`Ctrl`/`Alt`) is held, or when the
   * event target is a text-entry element. Receives the lowercased key and the active row index.
   * Return `true` to consume the keystroke (`preventDefault`); return `false`/`undefined` to let
   * it fall through untouched, so a future in-row editor can still claim the same letter.
   */
  onPropertyKey?: (key: string, index: number) => boolean;
}

/** The value returned by {@link useListKeyboard}. */
export interface UseListKeyboardResult {
  /** The active (keyboard-focused) row index, or `-1` when none is active. */
  activeIndex: number;
  /** Imperatively set the active row index (clamped to valid range or `-1`). */
  setActiveIndex: (index: number) => void;
  /** The `onKeyDown` handler to spread onto the grid container. */
  onKeyDown: (event: ListKeyboardEvent) => void;
}

/** Clamp `index` to `[-1, rowCount - 1]`. */
function clampIndex(index: number, rowCount: number): number {
  if (index < 0) return -1;
  if (index > rowCount - 1) return rowCount - 1;
  return index;
}

/** Whether a keydown's target is an element that owns its own keystrokes. */
function isTextEntryTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Whether `key` is a single, unmodified letter eligible for `onPropertyKey` dispatch. */
function isPlainLetterKey(event: ListKeyboardEvent): boolean {
  return /^[a-zA-Z]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * Manage arrow / Enter / Esc / property-key grid keyboard navigation over flattened list rows.
 *
 * @param options - The row count and activation/active-change/property-key callbacks.
 * @returns the active index, an imperative setter, and the grid `onKeyDown` handler.
 *
 * @example
 * ```tsx
 * const { activeIndex, onKeyDown } = useListKeyboard({ rowCount: rows.length, onActivate });
 * return <div role="grid" onKeyDown={onKeyDown}>{...}</div>;
 * ```
 */
export function useListKeyboard({
  rowCount,
  onActivate,
  onActiveChange,
  initialIndex = -1,
  onPropertyKey,
}: UseListKeyboardOptions): UseListKeyboardResult {
  const [activeIndex, setActiveIndexState] = React.useState<number>(initialIndex);

  const setActiveIndex = React.useCallback(
    (index: number) => {
      const next = clampIndex(index, rowCount);
      setActiveIndexState(next);
      if (next >= 0) onActiveChange?.(next);
    },
    [rowCount, onActiveChange],
  );

  // Keep the active index valid if rows are removed (e.g. a group collapses).
  React.useEffect(() => {
    setActiveIndexState((current) => (current > rowCount - 1 ? rowCount - 1 : current));
  }, [rowCount]);

  const onKeyDown = React.useCallback(
    (event: ListKeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;

      if (onPropertyKey && activeIndex >= 0 && isPlainLetterKey(event)) {
        const handled = onPropertyKey(event.key.toLowerCase(), activeIndex);
        if (handled) {
          event.preventDefault();
          return;
        }
      }

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          setActiveIndex(activeIndex < 0 ? 0 : activeIndex + 1);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          setActiveIndex(activeIndex < 0 ? rowCount - 1 : activeIndex - 1);
          break;
        }
        case 'Home': {
          event.preventDefault();
          setActiveIndex(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          setActiveIndex(rowCount - 1);
          break;
        }
        case 'Enter': {
          if (activeIndex >= 0) {
            event.preventDefault();
            onActivate?.(activeIndex);
          }
          break;
        }
        case 'Escape': {
          event.preventDefault();
          setActiveIndexState(-1);
          break;
        }
        default:
          break;
      }
    },
    [activeIndex, rowCount, onActivate, setActiveIndex, onPropertyKey],
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @docket/ui test -- hooks.test.tsx`
Expected: PASS (all `useListKeyboard` tests, old and new).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @docket/ui typecheck && pnpm --filter @docket/ui lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/commit-msg-1.txt <<'EOF'
fix(ui): Stop grid keyboard nav from swallowing text-input keystrokes

useListKeyboard drives every EntityTable/ListView grid, and it had no guard for a keydown whose
target is an input, textarea, select, or contenteditable element rendered inside the grid -- an
inline title editor lost arrow keys, Home/End, and Escape to row navigation. This adds that guard
and, on the same pass, an onPropertyKey extension point for unmodified single-letter hotkeys (the
L label hotkey and the future S/A/P/D property hotkeys), since both need the identical guard.
EOF
git restore --staged . && git add packages/ui/src/hooks/useListKeyboard.tsx packages/ui/tests/hooks/hooks.test.tsx && git commit -F /tmp/commit-msg-1.txt
```

---

### Task 2: `EntityTable` — forward the property-key hotkey with the row and its anchor element

**Files:**

- Modify: `packages/ui/src/components/views/EntityTable.tsx`
- Test: `packages/ui/tests/components/views/entity-table.test.tsx`

**Interfaces:**

- Consumes: `useListKeyboard`'s `onPropertyKey?: (key: string, index: number) => boolean` (Task 1).
- Produces: `EntityTableProps<T>.onRowPropertyKey?: (key: string, row: T, anchor: HTMLElement | null) => boolean`. Called only when the active flattened row is a data row (never a group header). `anchor` is the active row's DOM element (resolved via the `aria-current="true"` marker every row-render branch already sets), or `null` if none is mounted.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/tests/components/views/entity-table.test.tsx`, as a new `describe` block after `'EntityTable — keyboard navigation'`:

```tsx
describe('EntityTable — property-key hotkeys', () => {
  it('forwards a property key with the active row and its anchor element', () => {
    const onRowPropertyKey =
      vi.fn<(key: string, row: Row, anchor: HTMLElement | null) => boolean>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'l' });
    expect(onRowPropertyKey).toHaveBeenCalledTimes(1);
    const [key, row, anchor] = onRowPropertyKey.mock.calls[0]!;
    expect(key).toBe('l');
    expect(row).toBe(ROWS[0]);
    expect(anchor).toBe(screen.getByRole('row', { name: /Billing revamp/ }));
  });

  it('resolves the anchor when rows render through a custom renderRowLink', () => {
    const onRowPropertyKey =
      vi.fn<(key: string, row: Row, anchor: HTMLElement | null) => boolean>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        renderRowLink={({ children, ...linkProps }) => (
          <a data-testid="link" {...linkProps}>
            {children}
          </a>
        )}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'l' });
    expect(onRowPropertyKey).toHaveBeenCalledWith('l', ROWS[0], screen.getAllByTestId('link')[0]);
  });

  it('never forwards a property key when the active row is a group header', () => {
    const onRowPropertyKey =
      vi.fn<(key: string, row: Row, anchor: HTMLElement | null) => boolean>();
    const GROUPS: EntityTableGroup<Row>[] = [
      { id: 'g-one', label: 'First bucket', rows: [ROWS[0]!] },
    ];
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        groups={GROUPS}
        getRowKey={getRowKey}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> the group header is the first flat row
    fireEvent.keyDown(grid, { key: 'l' });
    expect(onRowPropertyKey).not.toHaveBeenCalled();
  });

  it('prevents the default keydown when onRowPropertyKey reports it handled the key', () => {
    const onRowPropertyKey = vi.fn().mockReturnValue(true);
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    const notCancelled = fireEvent.keyDown(grid, { key: 'l' });
    expect(notCancelled).toBe(false); // dispatchEvent returns false once preventDefault runs
  });

  it('does nothing when no onRowPropertyKey handler is supplied', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(() => {
      fireEvent.keyDown(grid, { key: 'l' });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @docket/ui test -- entity-table.test.tsx`
Expected: FAIL — `onRowPropertyKey` is not a known prop / never called.

- [ ] **Step 3: Implement**

In `packages/ui/src/components/views/EntityTable.tsx`:

Add to `EntityTableProps<T>` (after `onRowClick`):

```ts
  /**
   * Handle a property-edit hotkey (`L`, and future `S`/`A`/`P`/`D`) on the active data row.
   *
   * @remarks
   * Never called when the active flattened row is a group-header boundary. `anchor` is the active
   * row's DOM element (via its `aria-current="true"` marker, which every row-render branch —
   * button, anchor, and custom `renderRowLink` — already carries), for positioning a popover
   * against it. Return `true` to consume the keystroke.
   */
  onRowPropertyKey?: (key: string, row: T, anchor: HTMLElement | null) => boolean;
```

Add, right after the existing `activateRow` callback (before the `useListKeyboard` call):

```ts
const handlePropertyKey = React.useCallback(
  (key: string, index: number): boolean => {
    if (!onRowPropertyKey) return false;
    const entry = flat[index];
    if (!entry || entry.kind !== 'row') return false;
    const anchor = scrollRef.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? null;
    return onRowPropertyKey(key, entry.row, anchor);
  },
  [flat, onRowPropertyKey],
);
```

Change the `useListKeyboard` call to pass it:

```ts
const { activeIndex, onKeyDown } = useListKeyboard({
  rowCount: flat.length,
  onActivate: activateRow,
  onPropertyKey: handlePropertyKey,
});
```

Destructure the new prop in the component signature (add `onRowPropertyKey,` alongside `onRowClick,` in the parameter list).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @docket/ui test -- entity-table.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, full package test run**

Run: `pnpm --filter @docket/ui typecheck && pnpm --filter @docket/ui lint && pnpm --filter @docket/ui test`
Expected: no errors; full `@docket/ui` suite green.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/commit-msg-2.txt <<'EOF'
feat(ui): Let EntityTable forward a property-edit hotkey with its row and anchor

Threads useListKeyboard's new onPropertyKey through EntityTable as onRowPropertyKey, resolving
the flattened active index back to the source row (never a group-header boundary) and to the
active row's DOM element via its existing aria-current marker -- the same marker every row-render
branch (button, anchor, custom renderRowLink) already carries, so this needed no new ref
plumbing. This is the extension point apps/web's TaskTable uses to open a label picker anchored
to the correct row when L is pressed.
EOF
git restore --staged . && git add packages/ui/src/components/views/EntityTable.tsx packages/ui/tests/components/views/entity-table.test.tsx && git commit -F /tmp/commit-msg-2.txt
```

---

### Task 3: Extract `labelFilterHref` in `search-route.ts`

**Files:**

- Modify: `apps/web/src/lib/search-route.ts`
- Test: `apps/web/tests/lib/search-route.test.ts`

**Interfaces:**

- Produces: `export function labelFilterHref(organizationId: string, labelId: string): string` — `/orgs/:orgId/tasks?filter=labels:eq:<labelId>` (URL-encoded). Used by Task 8's palette label mode.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/tests/lib/search-route.test.ts` (new top-level `describe`, after the existing ones — check the file's existing structure/imports first and match its style):

```ts
describe('labelFilterHref', () => {
  it('builds the same pre-filtered task-list URL the label search-hit route uses', () => {
    const href = labelFilterHref(ORG, 'label_1');
    expect(href).toBe(`/orgs/${ORG}/tasks?filter=labels%3Aeq%3Alabel_1`);
  });
});
```

Add `labelFilterHref` to the existing `import { hrefForSearchRoute, isExternalSearchHref } from '@/lib/search-route';` line.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- search-route.test.ts`
Expected: FAIL — `labelFilterHref` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/search-route.ts`, replace the `label` case's body and add the export. Find:

```ts
    case 'label':
      return withQuery(`/orgs/${organizationId}/tasks`, 'filter', `labels:eq:${entityId}`);
```

Replace with:

```ts
    case 'label':
      return labelFilterHref(organizationId, entityId);
```

Add the new export near `withQuery` (which stays `function`, not exported — this is the one exported wrapper around it for the label case):

```ts
/**
 * The task-list URL pre-filtered to one label, in the view toolbar's `filter=field:op:value`
 * codec — mirrors `entityHref`'s label case in `apps/api/src/search/routes.ts`; if either side's
 * shape changes, the other must change with it.
 */
export function labelFilterHref(organizationId: string, labelId: string): string {
  return withQuery(`/orgs/${organizationId}/tasks`, 'filter', `labels:eq:${labelId}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- search-route.test.ts`
Expected: PASS (new test, and the existing label-route test still passes since behavior is unchanged).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/commit-msg-3.txt <<'EOF'
chore(web): Extract the label task-list filter href into a named export

The pre-filtered task-list URL for one label was inlined in hrefForEntity's label case. The
upcoming command-palette label sub-mode needs the identical URL, so this pulls it out as
labelFilterHref rather than let a third callsite reinvent the filter=field:op:value string --
hrefForEntity now calls it too, with no behavior change.
EOF
git restore --staged . && git add apps/web/src/lib/search-route.ts apps/web/tests/lib/search-route.test.ts && git commit -F /tmp/commit-msg-3.txt
```

---

### Task 4: `PickerOverlayProvider` — context, provider, and app-shell mount

**Files:**

- Create: `apps/web/src/components/pickers/picker-overlay.tsx`
- Create (empty-content placeholder is NOT allowed — see Task 5, which fills this in): none; `label-picker-overlay.tsx` is written whole in Task 5.
- Modify: `apps/web/src/components/providers.tsx`
- Test: `apps/web/tests/components/pickers/picker-overlay.test.tsx`

**Interfaces:**

- Produces: `LabelPickerRequest`, `PickerOverlayApi`, `usePickerOverlay(): PickerOverlayApi`, `PickerOverlayProvider`. `PickerOverlayApi.open(request: LabelPickerRequest): void`.
- Consumes (Task 5): renders `<LabelPickerOverlay request={...} onClose={...} />` only when a request is open — Task 5 creates that component, so this task builds it as a thin, testable stub first is explicitly disallowed by "no stubs." Instead, Tasks 4 and 5 are combined here: this task writes `picker-overlay.tsx` (context/provider) AND a minimal but fully real `label-picker-overlay.tsx` inline, and Task 5 is what actually builds out the popover's data/checked-state/write logic. To keep Task 4 self-contained and non-stubby, **Task 4 creates the full context/provider AND `label-picker-overlay.tsx` in one pass** — the split below reflects that.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/components/pickers/picker-overlay.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PickerOverlayProvider, usePickerOverlay } from '@/components/pickers/picker-overlay';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          labels: {
            $get: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ items: [] }),
            }),
          },
        },
      },
    },
  },
}));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');

describe('usePickerOverlay', () => {
  it('throws when used outside a PickerOverlayProvider', () => {
    const { result } = renderHook(() => {
      try {
        return usePickerOverlay();
      } catch (error) {
        return error;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
  });

  it('opens the labels popover with a listbox once open() is called', async () => {
    const { wrapper } = makeQueryWrapper();

    function Trigger(): React.JSX.Element {
      const overlay = usePickerOverlay();
      return (
        <button
          type="button"
          onClick={() => {
            overlay.open({
              kind: 'labels',
              organizationId: ORG,
              objects: [{ kind: 'task', id: 'task_1', organizationId: ORG, title: 'Ship it' }],
              current: new Map([['task:task_1', []]]),
            });
          }}
        >
          Open
        </button>
      );
    }

    render(
      <PickerOverlayProvider>
        <Trigger />
      </PickerOverlayProvider>,
      { wrapper },
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Open' }).click();
    });

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- picker-overlay.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `picker-overlay.tsx`**

Create `apps/web/src/components/pickers/picker-overlay.tsx`:

```tsx
'use client';

/**
 * `components/pickers/picker-overlay` — the one moved popover for "edit labels on N objects".
 *
 * @remarks
 * `ActionDefinition.run` (see `@/lib/actions`) cannot open UI, and `ObjectMeta` cannot carry a
 * task's live label set without a stale DOM round-trip — so "set labels" cannot be modeled as a
 * plain registry action. Instead this is one popover, mounted once near the top of the app tree,
 * that any surface can summon through `usePickerOverlay().open(...)`: the `L` hotkey (via
 * `EntityTable`'s `onRowPropertyKey`, which already has the row's labels and passes them as
 * `current`) and the `task.label` context-menu action (which does not, and lets the popover
 * resolve them) both call the same `open`.
 *
 * One overlay moved to the target, not one picker mounted per row — the per-row composers
 * (`task-properties-rail.tsx` and friends) keep mounting their own `LabelsPicker` unchanged,
 * since they already have an anchor and don't need this indirection.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ObjectRef } from '@/lib/actions';

import { LabelPickerOverlay } from './label-picker-overlay';

/** A request to edit the label set of one or more objects. */
export interface LabelPickerRequest {
  readonly kind: 'labels';
  /** The workspace the objects belong to. */
  readonly organizationId: string;
  /** The objects being edited, in display order. Always at least one. */
  readonly objects: readonly ObjectRef[];
  /**
   * Each object's current label ids, keyed by `objectKey(object)`, when the caller already has
   * them (the `L` hotkey does — the row it fired on already renders its labels). Omit to have the
   * popover resolve them itself (the right-click path, which is already a two-step gesture).
   */
  readonly current?: ReadonlyMap<string, readonly string[]>;
  /** Anchor element for the popover. Defaults to `document.activeElement`. */
  readonly anchor?: HTMLElement | null;
}

/** What `usePickerOverlay()` exposes. */
export interface PickerOverlayApi {
  /** Open the labels popover for a request. Replaces any request already open. */
  readonly open: (request: LabelPickerRequest) => void;
}

const PickerOverlayContext = createContext<PickerOverlayApi | null>(null);

/** Thrown when `usePickerOverlay` is used outside a {@link PickerOverlayProvider}. */
class MissingPickerOverlayError extends Error {
  constructor() {
    super('No picker overlay is mounted. Wrap the app in <PickerOverlayProvider>.');
    this.name = 'MissingPickerOverlayError';
  }
}

/** The app's one picker-overlay controller. */
export function usePickerOverlay(): PickerOverlayApi {
  const value = useContext(PickerOverlayContext);
  if (value === null) throw new MissingPickerOverlayError();
  return value;
}

/** Props for {@link PickerOverlayProvider}. */
export interface PickerOverlayProviderProps {
  readonly children: ReactNode;
}

/**
 * Mount the app's one picker overlay.
 *
 * @remarks
 * Mount high in the tree — above both `ActionDomainsProvider` (whose `task.label` action calls
 * `usePickerOverlay()`) and every task list (whose `L` hotkey does too) — and exactly once, for
 * the same "exactly one" reason `InteractionProvider` is mounted exactly once.
 */
export function PickerOverlayProvider({ children }: PickerOverlayProviderProps): JSX.Element {
  const [request, setRequest] = useState<LabelPickerRequest | null>(null);
  // Forces a clean remount of LabelPickerOverlay per open() call, so its internal "resolved
  // current, seeded once" state and its anchor ref (captured at mount) never leak across requests.
  const sequenceRef = useRef(0);

  const api = useMemo<PickerOverlayApi>(
    () => ({
      open: (next) => {
        sequenceRef.current += 1;
        setRequest(next);
      },
    }),
    [],
  );

  return (
    <PickerOverlayContext.Provider value={api}>
      {children}
      {request ? (
        <LabelPickerOverlay
          key={sequenceRef.current}
          request={request}
          onClose={() => {
            setRequest(null);
          }}
        />
      ) : null}
    </PickerOverlayContext.Provider>
  );
}
```

- [ ] **Step 4: Implement `label-picker-overlay.tsx`**

Create `apps/web/src/components/pickers/label-picker-overlay.tsx`:

```tsx
'use client';

/**
 * `components/pickers/label-picker-overlay` — the popover {@link PickerOverlayProvider} renders.
 *
 * @remarks
 * Mounts fresh per `open()` call (see `picker-overlay.tsx`'s `key`), so its "resolved current,
 * seeded once" local state and its anchor ref never need to react to a *different* request
 * arriving mid-session — a new request is a new mount.
 *
 * Checked state: a label reads as checked only when *every* target object currently carries it
 * (mirrors `LabelsPicker`'s own single-object summarization, extended to N). Toggling a label
 * moves the whole set toward the opposite of its current "all carry it" state: checking a
 * partially- or un-applied label applies it to every object that lacks it; unchecking a fully-
 * applied label removes it from every object that has it.
 */
import type { LabelCreate, LabelOut } from '@docket/work/label-contract';
import { LabelId } from '@docket/work/ids';
import { PickerList, type PickerOption } from '@docket/ui/components';
import { Popover, PopoverAnchor, PopoverContent, Skeleton } from '@docket/ui/primitives';
import type { PopoverVirtualAnchor } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import { useQueries } from '@tanstack/react-query';

import { objectKey } from '@/lib/actions';
import { api } from '@/lib/api';
import { labelOptions } from '@/components/pickers/options';
import { labelsDef, useCreateLabel } from '@/components/labels/queries';
import { taskDetailDef } from '@/lib/use-task-detail';
import { queryKeys, unwrap, useApiListQuery, type QueryClient } from '@/lib/query';

import type { LabelPickerRequest } from './picker-overlay';

/** Props for {@link LabelPickerOverlay}. */
export interface LabelPickerOverlayProps {
  readonly request: LabelPickerRequest;
  readonly onClose: () => void;
}

/** Write one task's label set and invalidate everything it can change. */
async function applyLabelsToTask(
  orgId: string,
  taskId: string,
  labelIds: readonly string[],
  queryClient: QueryClient,
): Promise<void> {
  await unwrap(
    () =>
      api.v1.orgs[':orgId'].tasks[':id'].$patch({
        param: { orgId, id: taskId },
        json: { labels: labelIds.map((id) => LabelId.parse(id)) },
      }),
    'Could not update labels.',
  );
  void queryClient.invalidateQueries({ queryKey: queryKeys.task(orgId, taskId) });
  void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'task-graph'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(orgId) });
}

/** The popover {@link PickerOverlayProvider} mounts while a labels request is open. */
export function LabelPickerOverlay({ request, onClose }: LabelPickerOverlayProps): JSX.Element {
  const { organizationId: orgId, objects, current: suppliedCurrent } = request;
  const queryClient = useQueryClient();

  const labelsQ = useApiListQuery(labelsDef(orgId));
  const allLabels: readonly LabelOut[] = labelsQ.data?.items ?? [];
  const options = useMemo<readonly PickerOption[]>(() => labelOptions(allLabels), [allLabels]);

  const needsFetch = suppliedCurrent === undefined;
  const detailResults = useQueries({
    queries: needsFetch ? objects.map((o) => taskDetailDef(orgId, o.id)) : [],
  });

  const resolvedCurrent = useMemo<ReadonlyMap<string, readonly string[]> | null>(() => {
    if (suppliedCurrent) return suppliedCurrent;
    if (!needsFetch) return new Map();
    if (detailResults.some((r) => r.data === undefined)) return null;
    const map = new Map<string, readonly string[]>();
    objects.forEach((o, index) => {
      const task = detailResults[index]?.data;
      map.set(objectKey(o), task ? task.labels.map((l) => l.id) : []);
    });
    return map;
  }, [suppliedCurrent, needsFetch, detailResults, objects]);

  // Seeded exactly once per mount (this component remounts fresh per open() call — see
  // picker-overlay.tsx), then owned locally so sequential toggles in one open session compute
  // against what the popover has already applied, not a resolved snapshot that never refetches
  // mid-session.
  const [localCurrent, setLocalCurrent] = useState<ReadonlyMap<string, readonly string[]> | null>(
    null,
  );
  const seeded = useRef(false);
  if (!seeded.current && resolvedCurrent !== null) {
    seeded.current = true;
    setLocalCurrent(resolvedCurrent);
  }

  const checkedIds = useMemo<readonly string[]>(() => {
    if (localCurrent === null || objects.length === 0) return [];
    return options
      .map((o) => o.value)
      .filter((id) => objects.every((o) => (localCurrent.get(objectKey(o)) ?? []).includes(id)));
  }, [options, objects, localCurrent]);

  const applyToggle = useCallback(
    (labelId: string) => {
      if (localCurrent === null) return;
      const applyToAll = !checkedIds.includes(labelId);
      const next = new Map(localCurrent);
      for (const o of objects) {
        const key = objectKey(o);
        const objectLabels = localCurrent.get(key) ?? [];
        const has = objectLabels.includes(labelId);
        if (applyToAll === has) continue;
        const updated = applyToAll
          ? [...objectLabels, labelId]
          : objectLabels.filter((id) => id !== labelId);
        next.set(key, updated);
        void applyLabelsToTask(orgId, o.id, updated, queryClient);
      }
      setLocalCurrent(next);
    },
    [localCurrent, checkedIds, objects, orgId, queryClient],
  );

  const createLabel = useCreateLabel(orgId);
  const onCreate = useCallback(
    (name: string) => {
      const input: LabelCreate = { name };
      createLabel.mutate(input, {
        onSuccess: (created) => {
          applyToggle(created.id);
        },
      });
    },
    [createLabel, applyToggle],
  );

  // Computed once at mount (this component remounts fresh per open() call), matching the timing
  // Radix needs to measure the popover's initial position correctly.
  const anchorRef = useRef<PopoverVirtualAnchor | null>(
    request.anchor ??
      (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
  );

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent>
        {localCurrent === null ? (
          <div className="flex flex-col gap-1.5 p-1.5" aria-hidden="true">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        ) : (
          <PickerList
            options={options}
            selected={checkedIds}
            onSelect={applyToggle}
            multiple
            searchPlaceholder="Filter labels…"
            emptyText="No labels"
            ariaLabel="Labels"
            create={{
              render: (q) => `Create "${q}"`,
              canCreate: (q, opts) =>
                !opts.some((o) => o.label.trim().toLowerCase() === q.trim().toLowerCase()),
              onCreate,
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
```

Check `@docket/ui/primitives`' barrel actually re-exports `Skeleton`, `Popover`, `PopoverAnchor`, `PopoverContent`, and `PopoverVirtualAnchor` (it should — `PropertyRow`/`LabelsPicker` already import `Popover`/`PopoverContent` from there, and `command-palette.tsx` already imports `Skeleton` from there). If `PopoverVirtualAnchor` is not re-exported from the primitives barrel, import it directly from `@docket/ui/primitives/popover` instead, or add it to the barrel — check `packages/ui/src/primitives/index.ts` first and adjust the import accordingly; do not silently work around a missing export without adding it to the barrel (the type must be genuinely importable, not duplicated locally).

- [ ] **Step 5: Mount `PickerOverlayProvider` in `providers.tsx`**

In `apps/web/src/components/providers.tsx`, add the import:

```ts
import { PickerOverlayProvider } from '@/components/pickers/picker-overlay';
```

Wrap `ActionDomainsProvider`'s subtree with it (inside `InteractionProvider`, above `ActionDomainsProvider`, so both the `task.label` registry action — Task 6 — and every `TaskTable` — Task 7 — can reach `usePickerOverlay()`):

```tsx
<InteractionProvider>
  {/*
                  The object menu was built and left unplugged: with no domain ever registered,
                  every right-click fell through to the browser. These two providers are what make
                  the app's one contextmenu handler live — one introduces the domains to the
                  registry, the other renders what the registry resolves.
                */}
  <PickerOverlayProvider>
    <ActionDomainsProvider>
      <ObjectContextMenuProvider>
        <ServiceWorkerProvider>{children}</ServiceWorkerProvider>
      </ObjectContextMenuProvider>
    </ActionDomainsProvider>
  </PickerOverlayProvider>
</InteractionProvider>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter web test -- picker-overlay.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: no errors. Fix any import-path issues surfaced here (e.g. if `PopoverVirtualAnchor` needs a different import path than guessed above).

- [ ] **Step 8: Commit**

```bash
cat > /tmp/commit-msg-4.txt <<'EOF'
feat(web): Add the shared label picker overlay and mount it in the app shell

Neither ActionDefinition.run nor ObjectMeta can carry a task's live label set to open a picker,
so "edit labels on N tasks" cannot be a plain registry action. This adds PickerOverlayProvider --
one moved Radix popover any surface can summon via usePickerOverlay().open(...) -- backed by
LabelPickerOverlay, which resolves each object's current labels (from the caller when supplied,
otherwise fetched), computes checked state as "every target object carries it", and toggles by
moving the whole set toward the opposite of that state. Mounted once in providers.tsx, above both
ActionDomainsProvider and every task list, so the upcoming L hotkey and task.label action can both
reach it. Nothing calls open() yet -- that lands in the next two commits.
EOF
git restore --staged . && git add apps/web/src/components/pickers/picker-overlay.tsx apps/web/src/components/pickers/label-picker-overlay.tsx apps/web/src/components/providers.tsx apps/web/tests/components/pickers/picker-overlay.test.tsx && git commit -F /tmp/commit-msg-4.txt
```

---

### Task 5: `LabelPickerOverlay` behavior tests — checked state, toggle, create

**Files:**

- Test: `apps/web/tests/components/pickers/label-picker-overlay.test.tsx`

**Interfaces:**

- Consumes: `LabelPickerOverlay` (Task 4), `LabelPickerRequest` (Task 4).

This task is pure test-writing against the component Task 4 already built — Task 4's tests only proved the popover opens; this proves its actual behavior.

- [ ] **Step 1: Write the tests**

Create `apps/web/tests/components/pickers/label-picker-overlay.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { LabelId } from '@docket/work/ids';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LabelPickerOverlay } from '@/components/pickers/label-picker-overlay';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const BUG = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const URGENT = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2');

const LABELS_GET = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      items: [
        {
          id: BUG,
          organizationId: ORG,
          name: 'Bug',
          color: '#ef4444',
          teamId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: URGENT,
          organizationId: ORG,
          name: 'Urgent',
          color: '#f97316',
          teamId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }),
});
const TASK_PATCH = vi
  .fn()
  .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
const LABEL_CREATE = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          labels: {
            $get: (...args: unknown[]) => LABELS_GET(...args),
            $post: (...args: unknown[]) => LABEL_CREATE(...args),
          },
          tasks: { ':id': { $get: vi.fn(), $patch: (...args: unknown[]) => TASK_PATCH(...args) } },
        },
      },
    },
  },
}));

const TASK_A = { kind: 'task' as const, id: 'task_a', organizationId: ORG, title: 'A' };
const TASK_B = { kind: 'task' as const, id: 'task_b', organizationId: ORG, title: 'B' };

function renderOverlay(overrides: Partial<React.ComponentProps<typeof LabelPickerOverlay>> = {}) {
  const { wrapper } = makeQueryWrapper();
  const onClose = vi.fn();
  render(
    <LabelPickerOverlay
      request={{
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A],
        current: new Map([['task:task_a', [BUG]]]),
      }}
      onClose={onClose}
      {...overrides}
    />,
    { wrapper },
  );
  return { onClose };
}

describe('LabelPickerOverlay', () => {
  it('checks a label already on the single target object', async () => {
    renderOverlay();
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    expect(bugRow).toHaveAttribute('aria-selected', 'true');
    const urgentRow = screen.getByRole('option', { name: /Urgent/ });
    expect(urgentRow).toHaveAttribute('aria-selected', 'false');
  });

  it('checks a label only when every target object carries it', async () => {
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A, TASK_B],
        current: new Map([
          ['task:task_a', [BUG]],
          ['task:task_b', []],
        ]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    expect(bugRow).toHaveAttribute('aria-selected', 'false');
  });

  it('applies a partially-carried label to every target object', async () => {
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A, TASK_B],
        current: new Map([
          ['task:task_a', [BUG]],
          ['task:task_b', []],
        ]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    fireEvent.click(bugRow);

    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledTimes(1); // task_a already has it -> only task_b writes
    });
    expect(TASK_PATCH).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: ORG, id: 'task_b' }, json: { labels: [BUG] } }),
    );
    // Optimistic local state now shows Bug checked for both.
    expect(screen.getByRole('option', { name: /Bug/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('removes a fully-applied label from every target object', async () => {
    renderOverlay({
      request: {
        kind: 'labels',
        organizationId: ORG,
        objects: [TASK_A, TASK_B],
        current: new Map([
          ['task:task_a', [BUG]],
          ['task:task_b', [BUG]],
        ]),
      },
    });
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    fireEvent.click(bugRow);

    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledTimes(2);
    });
    expect(TASK_PATCH).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: ORG, id: 'task_a' }, json: { labels: [] } }),
    );
    expect(TASK_PATCH).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: ORG, id: 'task_b' }, json: { labels: [] } }),
    );
  });

  it('resolves current labels from the task detail query when the caller omits current', async () => {
    const TASK_GET = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'task_a',
          organizationId: ORG,
          labels: [{ id: BUG, name: 'Bug', color: '#ef4444' }],
        }),
    });
    vi.doMock('@/lib/api', () => ({
      api: {
        v1: {
          orgs: {
            ':orgId': {
              labels: { $get: (...args: unknown[]) => LABELS_GET(...args) },
              tasks: { ':id': { $get: (...args: unknown[]) => TASK_GET(...args) } },
            },
          },
        },
      },
    }));
    const { LabelPickerOverlay: FreshOverlay } =
      await import('@/components/pickers/label-picker-overlay');
    const { wrapper } = makeQueryWrapper();
    render(
      <FreshOverlay
        request={{ kind: 'labels', organizationId: ORG, objects: [TASK_A] }}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    const bugRow = await screen.findByRole('option', { name: /Bug/ });
    expect(bugRow).toHaveAttribute('aria-selected', 'true');
    vi.doUnmock('@/lib/api');
  });

  it('creates a label from typed text and applies it to every target object', async () => {
    LABEL_CREATE.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'label_new',
          organizationId: ORG,
          name: 'Backend',
          color: '#0ea5e9',
          createdAt: '2026-08-09T00:00:00.000Z',
        }),
    });
    renderOverlay();
    const search = await screen.findByRole('textbox');
    fireEvent.change(search, { target: { value: 'Backend' } });
    const createRow = await screen.findByRole('option', { name: /Create/ });
    fireEvent.click(createRow);

    await waitFor(() => {
      expect(LABEL_CREATE).toHaveBeenCalledWith(
        expect.objectContaining({ json: { name: 'Backend' } }),
      );
    });
    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledWith(
        expect.objectContaining({
          param: { orgId: ORG, id: 'task_a' },
          json: { labels: expect.arrayContaining([BUG, 'label_new']) },
        }),
      );
    });
  });

  it('closes when the popover reports it closed', async () => {
    const { onClose } = renderOverlay();
    await screen.findByRole('option', { name: /Bug/ });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
```

Check the exact mock shape of `api.v1.orgs[':orgId'].tasks[':id'].$patch`/`$get`/`labels.$post` argument names against how `unwrap`/the Hono client actually calls them (mirror the pattern from `apps/web/tests/cycle-detail/cycle-detail.test.tsx`'s `vi.mock('@/lib/api', ...)` block precisely, including exact call signatures) — adjust the mock's parameter names if the real client calls with a different shape than guessed above (e.g. positional vs. named args); run the test and fix based on actual failures rather than assuming this listing is pixel-perfect.

- [ ] **Step 2: Run tests, fix until green**

Run: `pnpm --filter web test -- label-picker-overlay.test.tsx`
Expected: initial failures are normal here (this is asserting behavior against code already written in Task 4, not driving new code) — fix mismatches in `label-picker-overlay.tsx` (Task 4's file) or in the test's mocks until all pass. If a genuine behavior bug in Task 4's implementation surfaces (e.g. the toggle math, the seed-once guard, or the anchor timing), fix it in `label-picker-overlay.tsx` directly.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cat > /tmp/commit-msg-5.txt <<'EOF'
test(web): Cover LabelPickerOverlay's checked-state, toggle, and create paths

Pins the popover's actual behavior: a label checks only when every target object carries it, a
partially-applied label toggle applies to all, a fully-applied one removes from all, current
resolves from the task detail query when the caller omits it, and inline creation applies the new
label to every target immediately. Uncovered by Task 4's smoke test, which only proved the popover
opens.
EOF
git restore --staged . && git add apps/web/tests/components/pickers/label-picker-overlay.test.tsx && git commit -F /tmp/commit-msg-5.txt
```

---

### Task 6: Register the `task.label` action

**Files:**

- Modify: `apps/web/src/components/tasks/task-actions.ts`
- Test: `apps/web/tests/components/tasks/task-actions.test.tsx` (new — confirmed no existing test covers this module; `apps/web/tests/interactivity/action-registration.test.tsx` is the closest sibling and this test mirrors its harness, applied to the real `useRegisterTaskActions` hook instead of a hand-rolled fixture domain)

**Interfaces:**

- Consumes: `usePickerOverlay` (Task 4).
- Produces: a `task.label` `ActionDefinition` in the `task` domain's registration array.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/components/tasks/task-actions.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InteractionProvider } from '@/lib/actions/interaction-provider';
import { createActionRegistry } from '@/lib/actions/registry';
import { useRegisterTaskActions } from '@/components/tasks/task-actions';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const open = vi.fn();
vi.mock('@/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));

/** The one component a domain mounts to publish its actions. */
function TaskActionRegistration(): null {
  useRegisterTaskActions();
  return null;
}

describe('task.label registration', () => {
  it('registers a multi-object, organize-section action with an L shortcut hint', () => {
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );
    expect(registry.snapshot().ids).toContain('task.label');
  });

  it('opens the picker overlay for the context objects on run', async () => {
    open.mockClear();
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );
    const context = {
      objects: [{ kind: 'task' as const, id: 't1', organizationId: 'org_1', title: 'Ship it' }],
      source: 'context-menu' as const,
      organizationId: 'org_1',
    };
    await registry.invoke('task.label', () => context);
    expect(open).toHaveBeenCalledWith({
      kind: 'labels',
      organizationId: 'org_1',
      objects: context.objects,
    });
  });

  it('does nothing when the context has no bound organization', async () => {
    open.mockClear();
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );
    const context = {
      objects: [{ kind: 'task' as const, id: 't1', organizationId: null, title: 'Ship it' }],
      source: 'context-menu' as const,
      organizationId: null,
    };
    await registry.invoke('task.label', () => context);
    expect(open).not.toHaveBeenCalled();
  });
});
```

`ActionRegistry.invoke(id, resolveContext)` is confirmed directly on the `ActionRegistry` interface in `apps/web/src/lib/actions/registry.ts` (evaluates `resolveContext` now and runs the matching definition's `run`), so the test above calls it straight off the `registry` instance — no need to route through `useActionDispatch`/a button component.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- task-actions`
Expected: FAIL — `task.label` is not registered yet.

- [ ] **Step 3: Implement**

In `apps/web/src/components/tasks/task-actions.ts`:

Add `Tag` to the icon import:

```ts
import { ArrowRight, CheckCircle2, Link, Plus, Tag, Workflow } from '@docket/ui/icons';
```

Add the picker-overlay import:

```ts
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
```

Inside `useRegisterTaskActions`, call the hook alongside `router`/`queryClient` and capture it before the `useMemo` (so it's available in the deps array like the other two):

```ts
export function useRegisterTaskActions(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pickerOverlay = usePickerOverlay();

  const definitions = useMemo<readonly ActionDefinition[]>(() => {
    ...
    return defineActionDomain('task', [
      ...
      {
        id: 'task.label',
        label: 'Labels…',
        icon: Tag,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        shortcutHint: 'L',
        keywords: ['tag', 'tags'],
        run: (context) => {
          if (context.organizationId === null) return;
          pickerOverlay.open({
            kind: 'labels',
            organizationId: context.organizationId,
            objects: context.objects,
          });
        },
      },
      {
        id: 'task.showInGraph',
        ...
      },
    ]);
  }, [router, queryClient, pickerOverlay]);

  useRegisterActionDomain('task', definitions);
}
```

(Insert the new definition object anywhere in the array — placing it after `task.addSubtask` and before `task.copyLink` keeps `organize`-section actions adjacent, matching the existing `section` grouping.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- task-actions`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/commit-msg-6.txt <<'EOF'
feat(web): Register task.label so the right-click menu can open the label picker

Adds a task.label ActionDefinition (multi-object, "organize" section, L shortcut hint) that opens
the shared picker overlay for the right-clicked task(s) -- no current supplied, since a right-
click is already a two-step gesture and the overlay resolves it itself. This lights up the
existing right-click context menu for labels; there is no bulk-action bar yet for it to also
light up, since SelectionProvider is not wired into any task list.
EOF
git restore --staged . && git add apps/web/src/components/tasks/task-actions.ts apps/web/tests/components/tasks/task-actions.test.tsx && git commit -F /tmp/commit-msg-6.txt
```

---

### Task 7: Wire the `L` hotkey into `TaskTable`

**Files:**

- Modify: `apps/web/src/components/views/task-table.tsx`
- Test: `apps/web/tests/components/views/task-table.test.tsx`

**Interfaces:**

- Consumes: `EntityTable`'s `onRowPropertyKey` (Task 2), `usePickerOverlay` (Task 4).

- [ ] **Step 1: Read the existing test file**

Read `apps/web/tests/components/views/task-table.test.tsx` fully first, to match its exact rendering/mocking conventions (it likely wraps `TaskTable` in whatever providers it needs and asserts on `EntityTable`'s rendered rows).

- [ ] **Step 2: Write the failing test**

Add a test asserting that pressing `l` on the active row opens the picker with the row's own labels as `current` (mock `usePickerOverlay` the same way Task 6's test did):

```tsx
it('opens the label picker for the focused row on L, with its current labels attached', () => {
  const open = vi.fn();
  vi.mocked(usePickerOverlay).mockReturnValue({ open });
  // ... render TaskTable with a fixture task carrying one label ...
  const grid = screen.getByRole('grid');
  grid.focus();
  fireEvent.keyDown(grid, { key: 'ArrowDown' });
  fireEvent.keyDown(grid, { key: 'l' });

  expect(open).toHaveBeenCalledWith({
    kind: 'labels',
    organizationId: TASK.organizationId,
    objects: [
      { kind: 'task', id: TASK.id, organizationId: TASK.organizationId, title: TASK.title },
    ],
    current: new Map([[`task:${TASK.id}`, TASK.labels.map((l) => l.id)]]),
    anchor: expect.anything(),
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- task-table.test.tsx`
Expected: FAIL — `TaskTable` does not call `usePickerOverlay` yet.

- [ ] **Step 4: Implement**

In `apps/web/src/components/views/task-table.tsx`:

Add imports:

```ts
import { objectKey } from '@/lib/actions';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
```

Inside `TaskTable`, before the `return`:

```ts
export function TaskTable({
  columns,
  tasks,
  groups,
  taskHref,
  onOpenTask,
  onRowPrefetch,
  label,
  defaultCollapsed,
  className,
}: TaskTableProps): JSX.Element {
  const pickerOverlay = usePickerOverlay();

  return (
    <EntityTable<TaskOut>
      aria-label={label}
      columns={columns}
      {...(groups ? { groups } : { rows: tasks ?? [] })}
      getRowKey={(task) => task.id}
      rowHref={(task) => taskHref(task)}
      rowDrag={(task) =>
        entityDragSource({
          kind: 'task',
          id: task.id,
          organizationId: task.organizationId,
          title: task.title,
        })
      }
      renderRowLink={({ children, ...linkProps }) => (
        <Link {...linkProps}>{children}</Link>
      )}
      onRowPrefetch={onRowPrefetch}
      onRowClick={
        onOpenTask
          ? (task) => {
              onOpenTask(task);
            }
          : undefined
      }
      onRowPropertyKey={(key, task, anchor) => {
        if (key !== 'l') return false;
        const object = {
          kind: 'task' as const,
          id: task.id,
          organizationId: task.organizationId,
          title: task.title,
        };
        pickerOverlay.open({
          kind: 'labels',
          organizationId: task.organizationId,
          objects: [object],
          current: new Map([[objectKey(object), task.labels.map((l) => l.id)]]),
          anchor,
        });
        return true;
      }}
      defaultCollapsed={defaultCollapsed}
      className={className}
    />
  );
}
```

Also extend the file's top TSDoc remark (the block describing the properties column set) with one sentence noting the `L` hotkey, matching the file's existing documentation density — do not skip this; every other affordance in that comment is documented there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test -- task-table.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, and manual verification**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: no errors.

Then start the dev server (`preview_start` with the web app's launch config) and, on a page rendering `TaskTable` with at least one labeled task (e.g. `/orgs/:orgId/tasks`), click a row to focus the grid, press `ArrowDown` then `l`, and confirm the labels popover opens anchored to that row and reflects its current labels. Screenshot the result.

- [ ] **Step 7: Commit**

```bash
cat > /tmp/commit-msg-7.txt <<'EOF'
feat(web): Wire the L hotkey into TaskTable to open the label picker

TaskTable already had every row's labels in hand, so its onRowPropertyKey handler supplies them
as `current` -- the hotkey opens the picker instantly with no fetch, unlike the task.label
context-menu action added in the previous commit. This is the shape S/A/P/D will extend later:
more `key` cases in the same handler, more picker-overlay request kinds.
EOF
git restore --staged . && git add apps/web/src/components/views/task-table.tsx apps/web/tests/components/views/task-table.test.tsx && git commit -F /tmp/commit-msg-7.txt
```

---

### Task 8: Command-palette label sub-mode — `parsePrefix` + `useLabelPaletteMode`

**Files:**

- Create: `apps/web/src/components/command-palette/sub-modes.ts`
- Test: `apps/web/tests/components/command-palette/sub-modes.test.ts`

**Interfaces:**

- Produces: `parsePrefix(query: string): { mode: string | null; term: string }`, `PALETTE_MODES: Record<string, { label: string; icon: LucideIcon }>`, `useLabelPaletteMode(term: string, ctx: { activeOrgId: string | null; close: () => void }): { items: readonly PaletteItem[]; loading: boolean; error: string | null }`.
- Consumes: `labelsDef` (`@/components/labels/queries`), `subsequenceMatch` (`./filter`), `labelFilterHref` (Task 3), `PaletteItem` (`./types`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/components/command-palette/sub-modes.test.ts`:

```ts
import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { LabelId } from '@docket/work/ids';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePrefix, useLabelPaletteMode } from '@/components/command-palette/sub-modes';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const BUG = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1');

describe('parsePrefix', () => {
  it('splits a leading # into the labels mode and the remaining term', () => {
    expect(parsePrefix('#bug')).toEqual({ mode: '#', term: 'bug' });
  });

  it('treats a bare # as the labels mode with an empty term', () => {
    expect(parsePrefix('#')).toEqual({ mode: '#', term: '' });
  });

  it('has no mode for a query with no recognized prefix', () => {
    expect(parsePrefix('bug')).toEqual({ mode: null, term: 'bug' });
  });

  it('has no mode for an empty query', () => {
    expect(parsePrefix('')).toEqual({ mode: null, term: '' });
  });
});

describe('useLabelPaletteMode', () => {
  it('shows no items and is not loading with no bound organization', () => {
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () => useLabelPaletteMode('', { activeOrgId: null, close: vi.fn() }),
      { wrapper },
    );
    expect(result.current).toEqual({ items: [], loading: false, error: null });
  });

  it('lists the org labels matching the term, navigating to the filtered task list on select', async () => {
    vi.doMock('@/lib/api', () => ({
      api: {
        v1: {
          orgs: {
            ':orgId': {
              labels: {
                $get: vi.fn().mockResolvedValue({
                  ok: true,
                  status: 200,
                  json: () =>
                    Promise.resolve({
                      items: [
                        {
                          id: BUG,
                          organizationId: ORG,
                          name: 'Bug',
                          color: '#ef4444',
                          teamId: null,
                          createdAt: '2026-08-01T00:00:00.000Z',
                        },
                      ],
                    }),
                }),
              },
            },
          },
        },
      },
    }));
    const { useLabelPaletteMode: freshHook } =
      await import('@/components/command-palette/sub-modes');
    const close = vi.fn();
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => freshHook('bu', { activeOrgId: ORG, close }), { wrapper });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0]).toMatchObject({ label: 'Bug' });

    result.current.items[0]!.run();
    expect(close).toHaveBeenCalledOnce();
    vi.doUnmock('@/lib/api');
  });

  it('filters out labels that do not match the term', async () => {
    vi.doMock('@/lib/api', () => ({
      api: {
        v1: {
          orgs: {
            ':orgId': {
              labels: {
                $get: vi.fn().mockResolvedValue({
                  ok: true,
                  status: 200,
                  json: () =>
                    Promise.resolve({
                      items: [
                        {
                          id: BUG,
                          organizationId: ORG,
                          name: 'Bug',
                          color: '#ef4444',
                          teamId: null,
                          createdAt: '2026-08-01T00:00:00.000Z',
                        },
                      ],
                    }),
                }),
              },
            },
          },
        },
      },
    }));
    const { useLabelPaletteMode: freshHook } =
      await import('@/components/command-palette/sub-modes');
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => freshHook('zzz', { activeOrgId: ORG, close: vi.fn() }), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.items).toHaveLength(0);
    vi.doUnmock('@/lib/api');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- sub-modes.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/command-palette/sub-modes.ts`:

```ts
'use client';

/**
 * `components/command-palette/sub-modes` — the command palette's typed prefix mode.
 *
 * @remarks
 * A registry expressed as "call every mode's hook in a loop" cannot exist here — React's rules of
 * hooks forbid a hook call whose presence depends on runtime state (which mode is active). So
 * this stays honest: {@link parsePrefix} is pure and generic, {@link PALETTE_MODES} is pure
 * metadata for rendering the pill/section label, and each mode's item list is its own named hook
 * (only {@link useLabelPaletteMode} today), called unconditionally by `CommandPalette` and
 * selected by `mode`. Adding `>` or `@` later means: one new named hook here, one new
 * `PALETTE_MODES` entry, one new call + switch arm in `CommandPalette` — not a framework.
 */
import { Tag, type LucideIcon } from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { labelsDef } from '@/components/labels/queries';
import { labelFilterHref } from '@/lib/search-route';
import { userErrorMessage } from '@/lib/problem';
import { useApiListQuery } from '@/lib/query';

import { subsequenceMatch } from './filter';
import type { PaletteItem } from './types';

/** A raw palette query split into its leading mode prefix (if any) and the term after it. */
export interface ParsedPaletteQuery {
  readonly mode: string | null;
  readonly term: string;
}

/** Split `query` on a recognized leading mode prefix. */
export function parsePrefix(query: string): ParsedPaletteQuery {
  if (query.startsWith('#')) return { mode: '#', term: query.slice(1) };
  return { mode: null, term: query };
}

/** Display metadata for a registered mode, keyed by its prefix character. */
export interface PaletteModeMeta {
  readonly label: string;
  readonly icon: LucideIcon;
}

/** Every registered sub-mode's display metadata. */
export const PALETTE_MODES: Record<string, PaletteModeMeta> = {
  '#': { label: 'Labels', icon: Tag },
};

/** What every mode's item-list hook needs from the palette host. */
export interface PaletteModeContext {
  /** The org bound to the palette's route, or `null` on the Hub. */
  readonly activeOrgId: string | null;
  /** Close the palette; a selected row calls this before navigating. */
  readonly close: () => void;
}

/** What every mode's item-list hook returns. */
export interface PaletteModeResult {
  readonly items: readonly PaletteItem[];
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The `#` mode's item list: every org label matching `term`, each navigating to the task list
 * pre-filtered to it.
 *
 * @remarks
 * Labels are org-scoped and the palette can be in Hub scope with no bound org — that case returns
 * no items and issues no request rather than fanning out across every membership, so the caller
 * can show its own "open a workspace" copy instead of a bare empty list.
 */
export function useLabelPaletteMode(
  term: string,
  { activeOrgId, close }: PaletteModeContext,
): PaletteModeResult {
  const router = useRouter();
  const enabled = activeOrgId !== null;
  const labelsQ = useApiListQuery({ ...labelsDef(activeOrgId ?? ''), enabled });

  const items = useMemo<readonly PaletteItem[]>(() => {
    if (!enabled) return [];
    const q = term.trim().toLowerCase();
    const allLabels = labelsQ.data?.items ?? [];
    return allLabels
      .filter((label) => subsequenceMatch(label.name, q))
      .map((label) => ({
        id: `label-mode:${label.id}`,
        section: 'results' as const,
        label: label.name,
        icon: Tag,
        run: () => {
          close();
          router.push(labelFilterHref(activeOrgId!, label.id));
        },
      }));
  }, [enabled, term, labelsQ.data, close, router, activeOrgId]);

  return {
    items,
    loading: enabled && labelsQ.isPending,
    error:
      enabled && labelsQ.isError
        ? userErrorMessage(labelsQ.error, 'Could not load your labels.')
        : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- sub-modes.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: no errors. If lint flags the non-null assertion `activeOrgId!` inside `run`, replace it with a narrowed local (`const orgId = activeOrgId; if (orgId === null) return; ...`) captured before the closure instead of suppressing the rule.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/commit-msg-8.txt <<'EOF'
feat(web): Add the command palette's # label sub-mode data layer

parsePrefix splits a raw palette query into a mode prefix and the term after it; useLabelPaletteMode
is the # mode's item list, gated on a bound org (labels are org-scoped, the palette is not) so the
Hub-scope, no-org case returns no items and issues no request rather than fanning out across every
membership. Each selected row navigates to the task list pre-filtered to that label via the
labelFilterHref extracted earlier. Not wired into CommandPalette yet -- next commit.
EOF
git restore --staged . && git add apps/web/src/components/command-palette/sub-modes.ts apps/web/tests/components/command-palette/sub-modes.test.ts && git commit -F /tmp/commit-msg-8.txt
```

---

### Task 9: Wire the `#` mode into `CommandPalette`

**Files:**

- Modify: `apps/web/src/components/command-palette/command-palette.tsx`
- Test: `apps/web/tests/components/command-palette/command-palette.test.tsx` (new)

**Interfaces:**

- Consumes: `parsePrefix`, `PALETTE_MODES`, `useLabelPaletteMode` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/components/command-palette/command-palette.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { LabelId } from '@docket/work/ids';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '@/components/command-palette/command-palette';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const BUG = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1');

vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({
    activeOrgId: ORG,
    orgName: () => 'Acme',
  }),
}));

const SEARCH_GET = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ items: [] }),
});
const LABELS_GET = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      items: [
        {
          id: BUG,
          organizationId: ORG,
          name: 'Bug',
          color: '#ef4444',
          teamId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }),
});

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      hub: { search: { $get: (...args: unknown[]) => SEARCH_GET(...args) } },
      orgs: {
        ':orgId': {
          search: { $get: (...args: unknown[]) => SEARCH_GET(...args) },
          labels: { $get: (...args: unknown[]) => LABELS_GET(...args) },
        },
      },
    },
  },
}));

function renderPalette() {
  const { wrapper } = makeQueryWrapper();
  const onClose = vi.fn();
  render(<CommandPalette open onClose={onClose} />, { wrapper });
  return { onClose };
}

describe('CommandPalette — # label sub-mode', () => {
  it('enters the labels mode on #, suppressing hub search and static commands', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '#bu' } });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Bug/ })).toBeInTheDocument();
    });
    // The search endpoint is never hit while in mode.
    expect(SEARCH_GET).not.toHaveBeenCalled();
  });

  it('navigates to the filtered task list and closes on selecting a label', async () => {
    const { onClose } = renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#bug' } });
    const row = await screen.findByRole('option', { name: /Bug/ });
    fireEvent.click(row);

    expect(push).toHaveBeenCalledWith(`/orgs/${ORG}/tasks?filter=labels%3Aeq%3A${BUG}`);
    expect(onClose).toHaveBeenCalled();
  });

  it('exits the mode on Escape without closing the palette', async () => {
    const { onClose } = renderPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '#bug' } });
    await screen.findByRole('option', { name: /Bug/ });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(input).toHaveValue('');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('exits the mode when backspacing the prefix away', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '#bug' } });
    await screen.findByRole('option', { name: /Bug/ });
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Bug/ })).not.toBeInTheDocument();
    });
  });
});

describe('CommandPalette — # with no bound organization', () => {
  it('shows an explanatory row instead of an empty list', async () => {
    vi.doMock('@/components/active-org', () => ({
      useActiveOrg: () => ({ activeOrgId: null, orgName: () => 'Hub' }),
    }));
    const { CommandPalette: FreshPalette } =
      await import('@/components/command-palette/command-palette');
    const { wrapper } = makeQueryWrapper();
    render(<FreshPalette open onClose={vi.fn()} />, { wrapper });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#' } });

    expect(await screen.findByText(/open a workspace/i)).toBeInTheDocument();
    expect(LABELS_GET).not.toHaveBeenCalled();
    vi.doUnmock('@/components/active-org');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- command-palette.test.tsx`
Expected: FAIL — no mode wiring exists yet.

If any assertion in the harness itself is wrong (wrong role name, wrong mock shape) rather than the mode being unimplemented, fix the test first — cross-check `command-palette.tsx`'s actual markup (already read in full during planning) before assuming a discrepancy is a real bug.

- [ ] **Step 3: Implement**

In `apps/web/src/components/command-palette/command-palette.tsx`:

Add imports:

```ts
import { Command, Search, Tag, X } from '@docket/ui/icons';
```

(replacing the existing `import { Command, Search } from '@docket/ui/icons';`)

```ts
import { PALETTE_MODES, parsePrefix, useLabelPaletteMode } from './sub-modes';
```

Inside `CommandPalette`, after `const [query, setQuery] = useState('');` add the mode derivation, and call the mode hook unconditionally (rules of hooks — see Task 8's file doc):

```ts
const { mode, term } = useMemo(() => parsePrefix(query), [query]);
const labelModeResult = useLabelPaletteMode(term, { activeOrgId, close: onClose });
const modeResult = mode === '#' ? labelModeResult : null;
```

Change the `useHubSearch` call's `open` to suppress it while in a mode:

```ts
const { results, loading, error, hasQuery } = useHubSearch({
  query,
  scope,
  close: onClose,
  open: open && mode === null,
});
```

Change `staticMatches` to suppress static commands while in a mode:

```ts
const staticMatches = useMemo(
  () => (mode !== null ? [] : filterCommands(commands, query)),
  [mode, commands, query],
);
```

Change `items` to use the mode's items when active:

```ts
const items = useMemo<readonly PaletteItem[]>(
  () => (modeResult ? modeResult.items : [...results, ...staticMatches]),
  [modeResult, results, staticMatches],
);
```

Add the mode-aware close, and pass it to `usePaletteKeyboard` instead of `onClose`:

```ts
const handlePaletteClose = useCallback(() => {
  if (mode !== null) {
    setQuery('');
    return;
  }
  onClose();
}, [mode, onClose]);

const { onKeyDown } = usePaletteKeyboard({
  items,
  activeIndex,
  setActiveIndex,
  onClose: handlePaletteClose,
  dialogRef,
});
```

(Add `useCallback` to the existing `'react'` import list.)

Change the resolved loading/error and the "no org bound" flag, placed near the existing `orgLocalLabel`/`showResultsSkeleton`/`showEmpty` block:

```ts
const orgLocalLabel = activeOrgId ? orgName(activeOrgId) : 'This org';
const effectiveError = modeResult ? modeResult.error : error;
const showNoOrgForMode = mode !== null && activeOrgId === null;
const showResultsSkeleton = modeResult
  ? modeResult.loading && modeResult.items.length === 0
  : loading && results.length === 0;
const showEmpty =
  !showNoOrgForMode && items.length === 0 && !showResultsSkeleton && !effectiveError;
```

Replace the leading `Search` icon in the input row with a mode-aware element. Find:

```tsx
        <div className="border-outline-variant flex items-center gap-3 border-b px-4">
          <Search aria-hidden="true" className="text-on-surface-variant size-5 shrink-0" />
          <input
```

Replace with:

```tsx
        <div className="border-outline-variant flex items-center gap-3 border-b px-4">
          {mode !== null ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-on-surface-variant hover:text-on-surface flex shrink-0 items-center gap-1 text-label-large"
              aria-label={`Exit ${PALETTE_MODES[mode]?.label ?? 'filter'}`}
            >
              <Tag aria-hidden="true" className="size-4" />
              {PALETTE_MODES[mode]?.label}
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : (
            <Search aria-hidden="true" className="text-on-surface-variant size-5 shrink-0" />
          )}
          <input
```

Change the placeholder:

```tsx
            placeholder={
              mode !== null
                ? `Filter ${(PALETTE_MODES[mode]?.label ?? '').toLowerCase()}…`
                : scope === 'org'
                  ? `Search ${orgLocalLabel}…`
                  : 'Search everything, or jump to…'
            }
```

Replace the error block to use `effectiveError`:

```tsx
{
  effectiveError ? (
    <div
      role="alert"
      className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
    >
      {effectiveError}
    </div>
  ) : null;
}
```

Add the no-org informational block right after it:

```tsx
{
  showNoOrgForMode ? (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-on-surface-variant text-body-medium">
        Open a workspace to filter by {(PALETTE_MODES[mode ?? '']?.label ?? 'this').toLowerCase()}
      </p>
    </div>
  ) : null;
}
```

Update the empty-state copy's `hasQuery` branch to also read sensibly in mode (the existing "Nothing matched your search…" / "switch scope" copy is search-specific — swap to mode-neutral copy when a mode is active):

```tsx
{
  showEmpty ? (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-on-surface text-body-medium font-medium">No matches</p>
      <p className="text-on-surface-variant text-body-medium max-w-xs">
        {mode !== null
          ? 'No labels match.'
          : hasQuery
            ? 'Nothing matched your search. Try a different term or switch scope.'
            : 'Nothing here yet. Create some work, or link a document, and it will show up.'}
      </p>
    </div>
  ) : null;
}
```

Update the `grouped` computation's section label and loading suffix:

```tsx
const grouped = SECTION_ORDER.map((s) => ({
  ...s,
  label:
    mode !== null && s.section === 'results'
      ? (PALETTE_MODES[mode]?.label ?? s.label)
      : s.section === 'results' && !hasQuery
        ? 'Recent'
        : s.label,
  rows: items.filter((it) => it.section === s.section),
})).filter((g) => g.rows.length > 0);
```

```tsx
<p className={menuLabel('standard')}>
  {group.label}
  {group.section === 'results' && (modeResult ? modeResult.loading : loading)
    ? ` · ${mode !== null ? 'loading…' : 'searching…'}`
    : ''}
</p>
```

- [ ] **Step 4: Run tests, fix until green**

Run: `pnpm --filter web test -- command-palette.test.tsx`
Expected: PASS. Debug any mismatches against the actual rendered markup (role names, exact copy) rather than loosening assertions.

- [ ] **Step 5: Run the full command-palette test directory**

Run: `pnpm --filter web test -- apps/web/tests/components/command-palette`
Expected: PASS — `search-result-item.test.ts`, `sub-modes.test.ts`, and `command-palette.test.tsx` all green.

- [ ] **Step 6: Typecheck, lint, and manual verification**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: no errors.

Then, in the dev server, open the command palette (`⌘K`), type `#`, confirm search stops and the input shows a "Labels" pill, type a label name and confirm it filters, select one and confirm it navigates to the pre-filtered task list, press `Escape` once to clear the mode (palette stays open) and again to close it. Screenshot the mode view.

- [ ] **Step 7: Commit**

```bash
cat > /tmp/commit-msg-9.txt <<'EOF'
feat(web): Wire the # label sub-mode into the command palette

Typing # now narrows the palette to org labels: hub search and the static command list both
suppress while a mode is active, the results section relabels to "Labels", and selecting a row
navigates to the pre-filtered task list. With no bound org (Hub scope) it shows one explanatory
row instead of fanning a query out across every membership. Escape exits the mode before closing
the palette; backspacing the # away falls out of mode for free, since the mode is derived purely
from the query string.
EOF
git restore --staged . && git add apps/web/src/components/command-palette/command-palette.tsx apps/web/tests/components/command-palette/command-palette.test.tsx && git commit -F /tmp/commit-msg-9.txt
```

---

### Task 10: Final verification and merge to `main`

**Files:** none (verification + git only).

- [ ] **Step 1: Full-repo verification**

Run, in order, stopping to fix any failure before continuing:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- [ ] **Step 2: Confirm linear history so far**

```bash
git log --oneline main..HEAD
git rev-list --merges --count main..HEAD
```

Expected: the 9 commits from Tasks 1–9 (plus the earlier spec commit already on this branch), and `0` merge commits.

- [ ] **Step 3: Manual verification recap**

Confirm both browser verifications from Tasks 7 and 9 were actually performed and passed (do not skip if they were deferred) — re-run them now if not already done in this session.

- [ ] **Step 4: Merge into `main`**

This repo requires a linear history (`main` forbids merge commits; ff-only/rebase only). Since this branch (`claude/festive-ellis-cacd7f`) was fast-forwarded onto `claude/label-definition-ux-c2d23f` before this work started, `main` itself is several commits behind — merging cleanly requires fast-forwarding `main`, not merging `main` into this branch.

```bash
git fetch origin main
git log --oneline origin/main..HEAD   # should show every commit from LABELS-001 through Task 9
git rev-list --merges --count origin/main..HEAD   # must print 0
```

If `origin/main` has moved ahead of the local `main` ref since this branch was created, rebase onto the new tip instead of assuming a clean fast-forward:

```bash
git fetch origin main
git rebase origin/main
```

Resolve any conflicts, re-run Step 1's full verification after the rebase, then fast-forward the remote:

```bash
git push origin HEAD:main
```

Do **not** use `--force`. If `origin/main` rejects a plain push (it has diverged further), stop and re-rebase rather than forcing.

- [ ] **Step 5: Confirm the merge**

```bash
git fetch origin main
git log --oneline -5 origin/main
```

Expected: `origin/main`'s tip is this branch's final commit.
