# Open-document switcher implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized open-document dropdown with a 352px searchable popover that opens from Command/Control+Shift+A and has conventional, visible keyboard focus.

**Architecture:** Keep `TabBar` and its host-owned tab state unchanged. Rebuild the transient `OverflowMenu` surface on the shared Popover primitive so a real search field, navigation links, and close buttons participate in ordinary focus order; the component owns only open/query/focus-recovery state.

**Tech Stack:** React 19, Radix Popover, Tailwind v4 semantic tokens, Testing Library, Vitest.

---

### Task 1: Lock the switcher behavior with failing tests

**Files:**

- Modify: `packages/ui/tests/components/shell/shell-full.test.tsx`

- [ ] **Step 1: Replace the old dropdown-only assertions with the searchable popover contract**

Add tests that open the existing `Open documents (2)` trigger and assert:

```tsx
const search = await screen.findByRole('searchbox', { name: 'Search open documents' });
expect(search).toHaveFocus();
expect(screen.queryByText('Open documents', { selector: '[role="menu"] *' })).toBeNull();
expect(search.closest('[data-radix-popper-content-wrapper]')?.firstElementChild).toHaveClass(
  'w-88',
);
```

Assert case-insensitive filtering and the empty state:

```tsx
fireEvent.change(search, { target: { value: 'launch' } });
expect(screen.queryByRole('link', { name: 'Fix the build' })).toBeNull();
expect(screen.getByRole('link', { name: 'Q3 Launch' })).toBeInTheDocument();
fireEvent.change(search, { target: { value: 'missing' } });
expect(screen.getByText('No open documents found')).toBeInTheDocument();
```

- [ ] **Step 2: Add shortcut and focus-order tests**

Exercise both platform modifiers and rejected chords:

```tsx
fireEvent.keyDown(document, { key: 'a', metaKey: true, shiftKey: true });
expect(await screen.findByRole('searchbox', { name: 'Search open documents' })).toHaveFocus();
fireEvent.keyDown(document, { key: 'a', ctrlKey: true, shiftKey: true });
fireEvent.keyDown(document, { key: 'a', metaKey: true, shiftKey: true, altKey: true });
fireEvent.keyDown(document, { key: 'a', metaKey: true, shiftKey: true, repeat: true });
```

Use `userEvent.tab()` to prove focus advances from the search field to the first document link and
then its close button. Use ArrowDown/ArrowUp to prove result-link navigation, and Escape to prove
the count trigger receives restored focus.

- [ ] **Step 3: Add balanced geometry and close-focus recovery tests**

Render a stateful `TabBar` harness. Assert each result row carries the shared `px-4` inset, the
close button has no `mr-*` class, and closing the middle/last result focuses the nearest remaining
document link. Closing the final result must focus the search field.

- [ ] **Step 4: Run the focused suite and verify RED**

Run:

```bash
pnpm --filter @docket/ui test tests/components/shell/shell-full.test.tsx
```

Expected: failures because the current surface has no searchbox, no global shortcut, content-sized
width, Radix menu focus semantics, and an `mr-1` close inset.

### Task 2: Implement the controlled searchable popover

**Files:**

- Modify: `packages/ui/src/components/shell/tab-overflow-menu.tsx`
- Modify: `packages/ui/src/components/shell/TabBar.tsx`

- [ ] **Step 1: Replace DropdownMenu imports and state with Popover state**

Use the shared primitives and icons:

```tsx
import { ChevronDown, Search, X } from '../../icons';
import {
  CONTROL,
  fieldSurface,
  focusRing,
  focusRingInset,
  menuItemClass,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../primitives';
```

Add controlled `open` and `query` state, refs for the trigger/search/content, and a filtered-tabs
memo using `tab.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())`.

- [ ] **Step 2: Register the cross-platform shortcut and deterministic open focus**

Install one document keydown listener while the switcher is mounted. It must require Shift plus
Meta or Control, reject Alt/repeat, compare `event.key.toLowerCase() === 'a'`, prevent the browser
default, and set `open` true. On `PopoverContent.onOpenAutoFocus`, prevent the default and focus the
search ref. Clear the query whenever the popover closes.

- [ ] **Step 3: Build the 352px search header and result list**

Render `PopoverContent align="end" className="w-88" role="dialog" aria-label="Open documents"`.
Build the search well from `fieldSurface({ variant: 'filled', controlSize: 'xl' })`,
`CONTROL.xl.paddingX`, `CONTROL.xl.gap`, and `CONTROL.xl.icon`, with a native
`type="search" role="searchbox" aria-label="Search open documents"` and a quiet `<kbd>` shortcut
hint. Render `No open documents found` for an empty filtered list.

- [ ] **Step 4: Render valid compound result rows**

Each `role="listitem"` wrapper uses `menuItemClass('standard', { selected: active })` and therefore
owns equal `px-4` insets. Keep the host link as the flexing primary action with `focusRingInset`;
render the close button as a sibling using `focusRing`, with no trailing margin. Preserve the type
glyph, truncation, `aria-current`, and `Close <title>` label.

- [ ] **Step 5: Add arrow navigation and close recovery**

On the popover content, handle ArrowDown/ArrowUp by collecting its document anchors, finding the
anchor for the current row, wrapping the index, and focusing the target anchor. Store a close
index before `onClose`; after the `tabs` prop changes, focus the same index, the prior last index,
or the search field when no result remains.

- [ ] **Step 6: Update the TabBar TSDoc**

Replace dropdown-menu and menu-role wording with the searchable popover contract, including the
global shortcut, fixed width, filtering, and ordinary Tab order.

- [ ] **Step 7: Run the focused suite and verify GREEN**

Run:

```bash
pnpm --filter @docket/ui test tests/components/shell/shell-full.test.tsx
```

Expected: all shell tests pass with no React, accessibility, or Radix warnings.

### Task 3: Validate and commit the switcher slice

**Files:**

- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Run package checks**

```bash
pnpm --filter @docket/ui typecheck
pnpm --filter @docket/ui lint
pnpm --filter @docket/ui test
```

Expected: every command exits 0.

- [ ] **Step 2: Inspect the diff and update the work log**

Mark `SHELL-DOCS-002` completed only after focused and package checks pass. Record the exact files,
test counts, focus behavior, and any deliberate deviation from the design.

- [ ] **Step 3: Commit atomically**

Stage only the switcher implementation, tests, plan, and its WORKLOG completion. Commit with
`feat(ui): Make open documents a searchable keyboard switcher` and a substantive body explaining
the semantic move from an ARIA menu to a compound popover.
