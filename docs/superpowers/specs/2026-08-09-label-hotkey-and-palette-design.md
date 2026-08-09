# Label inline-edit hotkey + command-palette label sub-mode

- **Status**: Approved
- **Date**: 2026-08-09
- **Base branch**: `claude/label-definition-ux-c2d23f` (LABELS-001; not yet on `main`)

## Objective

`docs/engineering/specs/design-system.md` specs two label affordances that were never built:

1. **`L` inline-edit hotkey** (§521, §600) — pressing `L` on the focused/selected list row opens
   the label picker for it.
2. **`#` command-palette sub-mode** (§553) — typing `#` in the palette filters to labels; picking
   one navigates to the task list filtered by it.

LABELS-001 already shipped the label data model, `LabelChip`, `LabelsPicker` (with inline
`onCreate`), the `labels` `FieldDescriptor` in `task-catalog.ts`, and Settings → Labels. This spec
covers only the two missing affordances above it.

## Context found during exploration

- **None of the sibling hotkeys exist.** `S`/`A`/`P`/`D` (status/assignee/priority/due) are specced
  in the same table as `L` but none is implemented. There is no existing pattern to extend — `L` is
  the first, and it sets the shape the others will follow.
- **The keyboard host is `useListKeyboard`** (`packages/ui/src/hooks/useListKeyboard.tsx`), which
  drives `EntityTable` (`packages/ui/src/components/views/EntityTable.tsx`) — the shared table every
  task list renders through (`TaskTable` in `apps/web/src/components/views/task-table.tsx`). It
  currently handles only Arrow/Home/End/Enter/Escape and has **no text-input guard** — a keystroke
  typed into an input rendered inside the grid (e.g. an inline title editor) is currently hijacked
  as row navigation. This is a live bug, fixed as part of this work since the property-hotkey guard
  needs the same check.
- **`SelectionProvider` (`apps/web/src/components/selection/`) and `useSelectionActions` are fully
  built but wired to nothing.** No surface mounts a `SelectionProvider`; there is no bulk-action bar.
  `EntityTable` has its own separate, unrelated `selected`/`onSelect` controlled-selection props that
  `TaskTable` never passes. Registering a `task.label` action therefore lights up the right-click
  context menu (which resolves through the registry directly) but not a bulk bar, because no bulk
  bar exists.
- **`ActionDefinition.run` cannot open UI.** It returns `void | Promise<void>` and is meant for
  writes, not for opening a picker. `ObjectMeta` (the scalar bag on an `ObjectRef`) cannot carry a
  task's current label set without a stale DOM round-trip through the `data-object-meta` JSON
  attribute. So "set labels" cannot be modeled purely as one `ActionDefinition.run`.
- **Labels are org-scoped** (`labelsDef(orgId)` in `apps/web/src/components/labels/queries.ts`), but
  the command palette can be in Hub scope with no bound org (`activeOrgId === null`).
- **The filtered-task-list URL is already built in two places** with the same shape:
  `apps/api/src/search/routes.ts` (`entityHref`, label case) and
  `apps/web/src/lib/search-route.ts` (`hrefForEntity`, label case), both producing
  `/orgs/:orgId/tasks?filter=labels:eq:<labelId>`. This spec extracts a single builder on the web
  side (`labelFilterHref`) so a third callsite doesn't reinvent the string.

## Architecture

### 1. `PickerOverlayProvider` — the one definition of "edit labels on N tasks"

New `apps/web/src/components/pickers/picker-overlay.tsx`, mounted once in the `(app)` shell
alongside `useRegisterTaskActions`. Exposes:

```ts
interface PickerOverlayApi {
  open(request: LabelPickerRequest): void;
}
interface LabelPickerRequest {
  readonly kind: 'labels';
  readonly organizationId: string;
  readonly objects: readonly ObjectRef[]; // tasks being edited, 1 or more
  /** Known current label ids per object, when the caller already has them (avoids a fetch). */
  readonly current?: ReadonlyMap<string, readonly string[]>; // objectKey -> labelIds
  /** Anchor element/rect for the popover. Defaults to `document.activeElement`. */
  readonly anchor?: HTMLElement | null;
}
```

A single controlled Radix `Popover`, anchored via a virtual reference element, rendering
`PickerList` (multi-select, searchable, `create`) over `labelsDef(orgId)`, with `LabelChip`
swatches as each option's icon — the same building blocks `LabelsPicker` already composes, reused
directly rather than duplicated.

- **Checked state**: a label is checked when every target object currently carries it (matching
  `LabelsPicker`'s own summarization semantics extended to N objects).
- **Toggle semantics**: toggling a label adds it to every object that lacks it, or removes it from
  every object that has it (whichever action moves the "all carry it" state forward — i.e. checking
  a partially-applied label applies it to all; unchecking a fully-applied label removes it from all).
- **`current` provided** → use it directly, no fetch. **`current` omitted** → resolve per-object from
  the task-detail query (already cached per `queryKeys.task(orgId, id)` when available, otherwise a
  fetch) — acceptable because every caller without `current` is a right-click, already a two-step
  gesture.
- **Writes** go through the existing `labels` field on the task patch mutation
  (`apps/web/src/lib/use-task-mutations.ts:218`), one call per changed object.
- **Create** wires `onCreate` to `useCreateLabel`, then applies the new label immediately (matching
  every other `LabelsPicker` composer in the app).

One overlay moved to the target, not one `LabelsPicker` mounted per row — the existing per-row
composers (`task-properties-rail.tsx`) keep mounting their own `LabelsPicker` unchanged, since they
already have an anchor and don't need this indirection.

### 2. `L` on the focused table row

**`packages/ui`** (`useListKeyboard.tsx`):

- Add the missing text-input guard: a keydown whose `event.target` is (or is inside) an `input`,
  `textarea`, `select`, or `[contenteditable]` is ignored entirely — arrows, Home/End, Enter, Escape,
  and the new property-key dispatch all skip. Fixes the live bug where an inline editor inside the
  grid loses its own keystrokes.
- Add `onPropertyKey?: (key: string, index: number) => boolean`, invoked for any single unmodified
  printable-letter keydown once the guard above passes and `activeIndex >= 0`. Returning `true`
  calls `event.preventDefault()`; returning `false`/`undefined` lets the key fall through
  (unhandled letters must not be swallowed, since a future in-row editor may want them). Modified
  keystrokes (`⌘`/`Ctrl`/`Alt`) never reach this dispatch — those are reserved.

`EntityTable` forwards this as `onRowPropertyKey?: (key: string, row: T) => boolean`, translating
the flattened `activeIndex` back to the source row (skipping group-header rows, matching
`activateRow`'s existing logic). `@docket/ui` never learns what `'l'` means — it only relays which
key was pressed on which row.

**`apps/web`** (`TaskTable`): passes `onRowPropertyKey` that switches on `key`:

```ts
onRowPropertyKey={(key, task) => {
  if (key !== 'l') return false;
  pickerOverlay.open({
    kind: 'labels',
    organizationId: task.organizationId,
    objects: [taskRef(task)],
    current: new Map([[objectKey(taskRef(task)), task.labels.map((l) => l.id)]]),
    anchor: rowElementFor(task.id), // from the existing row ref registry
  });
  return true;
}}
```

`current` is supplied because `TaskTable` already has the row's labels in hand — the hotkey opens
instantly, no fetch. This is the shape `S`/`A`/`P`/`D` will extend later: more `key` cases in the
same switch, more `PickerOverlayApi` request kinds.

Multi-select is not foreclosed: `objects` is already a list. When `SelectionProvider` is eventually
mounted on `TaskTable`, `L` becomes "the selection, or the focused row when the selection is empty"
— one conditional in this same handler, no change to `useListKeyboard` or the overlay.

### 3. `task.label` action (context menu)

Registered in `apps/web/src/components/tasks/task-actions.ts` alongside the existing task domain:

```ts
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
      // no `current` — right-click already costs a gesture, the picker resolves it.
    });
  },
}
```

This lights up the right-click **context menu** on any task, anywhere the registry is wired
(already true today via `objectTargetProps`). It does **not** light up a bulk-action bar, because
none exists — wiring `SelectionProvider` + a bulk bar into `TaskTable` is out of scope for this spec
(flagged as a real follow-up, not silently dropped).

### 4. `#` command-palette sub-mode

New `apps/web/src/components/command-palette/sub-modes.ts`:

```ts
interface PaletteMode {
  readonly prefix: string; // '#'
  readonly label: string; // 'Labels'
  readonly icon: LucideIcon;
  /** Build the mode's own item list from the term typed after the prefix. */
  useItems(
    term: string,
    ctx: { activeOrgId: string | null; close: () => void },
  ): {
    items: readonly PaletteItem[];
    loading: boolean;
  };
}

function parsePrefix(query: string): { mode: string | null; term: string } {
  // '#bug' -> { mode: '#', term: 'bug' }; 'bug' -> { mode: null, term: 'bug' }
}

const MODES: Record<string, PaletteMode> = { '#': labelMode };
```

`labelMode.useItems`:

- **No bound org** (`activeOrgId === null`): return one non-interactive informational row —
  "Open a workspace to filter by label" — no query issued.
- **Bound org**: `useApiQuery(labelsDef(activeOrgId))`, client-filtered by `term` via the existing
  `subsequenceMatch` from `filter.ts`, each row rendered with its `LabelChip` swatch as `icon` and
  `run` navigating to `labelFilterHref(activeOrgId, label.id)`.

`CommandPalette` changes:

- Derive `{ mode, term } = parsePrefix(query)` from the raw input.
- While `mode !== null`: suppress `useHubSearch` (no query issued) and the static
  `filterCommands` list; render the mode's `useItems(term, …)` as the sole section, headed by a
  removable pill showing the mode's label (e.g. "Labels ×") in place of the section headers.
- **Exiting a mode**: `Escape` exits the mode first (clears back to an empty, mode-less query) and
  only closes the palette on a second `Escape`; `Backspace` on an empty `term` (cursor right after
  the prefix) removes the prefix and returns to normal search. Both are new branches in
  `use-palette-keyboard.ts`, gated on `mode !== null`.
- `activeIndex` reset rules already keyed on `items.length` (existing effect) cover the mode's item
  list unchanged.

`labelFilterHref(orgId, labelId)` is extracted in `apps/web/src/lib/search-route.ts` as a named
export and called from both the existing `hrefForEntity` label case and the new palette mode, so the
URL shape has exactly one source of truth on the web side (the API's `entityHref` keeps its own
copy, matching the existing comment that already documents the two must mirror each other).

## Testing

- `useListKeyboard`: text-input-guard blocks all handled keys when focus is in an input/textarea/
  contenteditable inside the grid (regression test for the pre-existing bug); `onPropertyKey` fires
  for an unmodified letter on the active row and is skipped for `⌘`/`Ctrl`/`Alt`-modified keys and
  when `activeIndex < 0`.
- `EntityTable`: `onRowPropertyKey` receives the correct source row (not a group-header entry) and
  its `true`/`false` return controls `preventDefault`.
- `PickerOverlayProvider` (or its hook): checked-state computation for 1 and N objects with
  partially-overlapping label sets; toggle semantics (partial → apply-all, full → remove-all);
  `current` short-circuits the per-object fetch; create-then-apply.
- `parsePrefix`: prefix detection, term extraction, no-prefix passthrough.
- `CommandPalette` in `#` mode: suppresses `useHubSearch`; renders the no-org informational row;
  renders label rows filtered by term; Escape exits mode before closing; Backspace on empty term
  exits mode; selecting a label row navigates to `labelFilterHref`.
- `search-route.test.ts` / `label-href.test.ts`: extend to cover `labelFilterHref` directly instead
  of only through `hrefForEntity`.

## Out of scope

- Wiring `SelectionProvider` into `TaskTable` and building a bulk-action bar. `task.label` is
  registered so it's ready to serve one the moment it exists, but building it is a separate,
  larger project.
- The `S`/`A`/`P`/`D` hotkeys and `>`/`@` palette sub-modes. This spec establishes the extension
  points (`onPropertyKey`, `onRowPropertyKey`, the `MODES` registry) each will slot into, but
  implements only `L` and `#`.
