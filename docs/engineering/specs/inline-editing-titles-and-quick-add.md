# Inline title editing & inline quick-add

> **Status**: Draft for review
> **Author**: Willie Chalmers III (with Claude)
> **Motivation**: "Linear for Everything" — data is editable and creatable by default, in place. Today a title is a dead heading (or, for Initiatives, hidden behind a special "Edit" form), and creating a task interrupts you with a modal. Both break flow.

---

## 1. Problem

Two related gaps, same root cause — **titles are treated as read-only presentation, not as editable data**:

1. **Renaming is a special flow or impossible.** Task, Project, Program headings render as static `<h1>`/`<PageTitle>`. The Initiative heading is the only editable one, and only through a click-Edit-button → form → Save flow. No title is editable in list rows or board cards. (The server already accepts the edit: `TaskUpdate.title`, `ProjectUpdate.name`, `ProgramUpdate.name` are all defined — only the client patch types omit the field.)
2. **Creating a task interrupts.** Every list/section that can hold tasks opens the `CreateTaskDialog` modal (or has no add at all). Populating a project means modal → fill → submit → modal again, repeatedly. There is exactly one true inline add in the app — `Subtasks.tsx` — and it is the pattern to generalize.

## 2. Goals / non-goals

**Goals**

- A title reads as a heading/row text until you edit it **in place** — no mode chrome, no separate Edit button, no navigation away.
- Rename works on **detail headings and list/board rows** for Task, Project, Program, Initiative, Cycle.
- Add a task **inline** in a project (and other task contexts): type a title, Enter creates it, focus stays for the next — no modal, no redirect.
- Respect the capability gate (`canEdit`); read-only users see plain text with no affordance.
- Fluid, not swap-y: the display→edit transition has no layout shift (honors the "no hard view swaps" rule).

**Non-goals (this spec)**

- Rich text in titles (titles are single-line plain strings).
- Bulk rename / multi-select edit.
- Editing non-title fields inline beyond what already exists.
- Reworking the `CreateTaskDialog` itself (it stays for the "full" create with description/labels/etc.; quick-add is the fast path, not a replacement).

## 3. Two components

### 3a. `EditableTitle` — single-line inline rename

New component at `apps/web/src/components/editor/editable-title.tsx`. **Not** `EditableFreeformText` — that is a multiline TipTap/Markdown body editor, wrong for a one-line string.

```ts
export interface EditableTitleProps {
  /** Current title/name. */
  value: string;
  /** Persist a new, non-empty title. Never called with an empty string. */
  onSave: (next: string) => void;
  /** Whether the viewer may edit; false → plain text, no affordance. */
  canEdit: boolean;
  /** Disable while a save is in flight. */
  saving?: boolean;
  /** How editing is triggered — see §4. */
  activate?: 'click' | 'doubleClick';
  /** Accessible label for the edit field (e.g. "Task title"). */
  ariaLabel: string;
  /** Styling hook so a heading and a row cell can share one component at different scales. */
  className?: string;
}
```

**Behavior**

- Renders `value` as text with `className` (the caller supplies the type scale — `text-headline-medium` for a heading, the row's text size for a cell).
- Activation (§4) swaps the text for an `<input>` styled **identically** (same font, size, weight, line-height, color, and box position) so there is no visible jump — the caret simply appears in the same glyphs.
- **Save** on `Enter` or `blur`. **Revert** on `Escape`. An empty/whitespace value on save **reverts** to the previous title (titles cannot be emptied) — `onSave` is never called with empty.
- `canEdit === false` → renders plain text, no hover affordance, no cursor change, not focusable as an editor.
- Preserves any `view-transition-name`/`layoutId` the caller sets on the wrapper so shared-element transitions still morph the row.

### 3b. `QuickAddTaskRow` — inline task creation

New component at `apps/web/src/components/tasks/quick-add-task-row.tsx`, generalizing the `Subtasks.tsx` form-submit pattern.

```ts
export interface QuickAddTaskRowProps {
  /** Create a task from a typed title; resolves when persisted. */
  onAdd: (title: string) => Promise<void>;
  /** Gate the affordance. */
  canEdit: boolean;
  /** Placeholder, e.g. "Add a task…". */
  placeholder?: string;
}
```

**Behavior**

- Renders a quiet "+ Add task" affordance that, on click/focus, becomes an inline input.
- `Enter` (form submit) → `onAdd(title)`; on resolve, clear the input and **keep focus** for the next one (input never unmounts, mirroring `Subtasks`).
- `Escape` or blur-when-empty collapses back to the "+ Add task" affordance.
- The **host** owns context: it wraps `onAdd` to call the create API with `{ title, teamId, ...context }` where context is `projectId` / `milestoneId` / `cycleId` / `assigneeId` as appropriate. Minimal payload is `{ title, teamId }` (`TaskCreate`); `teamId` is already threaded to every host as `defaultTeamId`.
- Optimistic insert into the surrounding list, reconciled by the mutation (matches how `my-work` prepends and project detail refetches today).

## 4. Interaction model (the one real design decision)

| Surface                   | Single click                                           | Edit trigger                                          | Keyboard                                              |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| **Detail heading**        | _(is the title)_ — click places the caret and you type | **single click** (seamless; nothing to conflict with) | Tab to it, type                                       |
| **List row / board card** | **opens** the object (unchanged)                       | **double-click** on the title                         | **F2** while the row is focused (standard rename key) |

Rationale: on a detail page there is nothing for a click to conflict with, so single-click-to-edit is the most faithful "editable by default." In a list/board, single click must keep opening the row (that is the primary action), so rename moves to double-click — the least-surprising no-mode gesture (Finder, Trello, spreadsheets) — with **F2** giving a keyboard-accessible path. The existing convention for nested controls applies: the editable title is its own focusable element inside the row and `stopPropagation`s so the row's open-click never fires while editing.

Quick-add is always an explicit "+ Add task" affordance (no gesture ambiguity), placed at the **end of each task group** (e.g. under each milestone in the project Tasks tab, under each board column) so context (milestoneId/cycleId) is implied by position.

## 5. Data-layer changes (client only)

The server already accepts all of these; only the client patch types omit the field.

- `use-task-mutations.ts`: add `title?: string` to `TaskPatch` and map it into the PATCH body.
- `use-project-mutations.ts`: add `name?: string` to `ProjectPatch` + `toProjectPatchBody`.
- `use-program-mutations.ts`: add `name?: string` to `ProgramPatch` + `toProgramPatchBody`.
- Initiative already supports `name` (`InitiativePatch.name`); Cycle: verify/add the equivalent.
- Task create for quick-add reuses `api.v1.orgs[':orgId'].tasks.$post` with `{ title, teamId, ...context }`. Extract the inline create logic from `CreateTaskDialog` into a small `useCreateTask(orgId)` hook so both the dialog and `QuickAddTaskRow` share one call site.

## 6. Surfaces & phasing

The map found **5 detail headings** + **16 row/card surfaces**, but the rows funnel through **3 shared primitives** (`EntityListRow`, `ListRow`/`TaskRow`, `TaskTable`). Deliver in reviewable phases, screenshotting each:

- **Phase 1 — highest value, lowest risk.**
  - `EditableTitle` + wire the 5 **detail headings** (Task, Project, Program, Initiative, Cycle). Delete the Initiative `editingHeader` form.
  - `QuickAddTaskRow` + `useCreateTask`, wired into the **project Tasks tab** (per-milestone), directly answering "populate a project without a modal."
- **Phase 2 — breadth via the shared primitives.**
  - Rename in `EntityListRow`, `ListRow`/`TaskRow`, and the `TaskTable` title column (covers My Work, Triage, Saved Views, Programs/Cycles/Teams lists, project-milestone & cycle task tables at once).
  - Quick-add on the program work board (per column) and cycle pages.
- **Phase 3 — bespoke rows.**
  - all-tasks grid, day-tasks rail, work-board card, task-graph node, projects & initiatives tree grids. Each gets the shared `EditableTitle` with the row's `stopPropagation` treatment.

## 7. Edge cases

- Empty/whitespace rename → revert, no server call.
- Concurrent save + external update: last-write-wins via the mutation; optimistic value reconciled on settle.
- `canEdit` false everywhere → plain text, no affordances.
- Quick-add rapid entry: input stays mounted; disable submit while a create is in flight but keep the field focused.
- A11y: rename field has `aria-label`; F2 documented; the row remains a single activation target; quick-add is a labelled form.
- View transitions: wrapping element keeps its stable `view-transition-name`/`layoutId` so filtering/relayout still morphs, not swaps.

## 8. Testing

- Unit (`EditableTitle`): saves on Enter/blur, reverts on Escape, reverts on empty, no affordance when `!canEdit`, calls `onSave` once with trimmed value.
- Unit (`QuickAddTaskRow`): Enter creates + clears + keeps focus, Escape/empty-blur collapses, disabled while pending.
- E2E: rename a task title on its detail page and in a list row; quick-add two tasks into a project milestone without a modal and without navigating away.

## 9. Risks

- **Concurrent ultracode tree churn** — mitigated: all work happens in the isolated `worktree-feat+graph-node-overhaul` (or a sibling) and merges when that run settles.
- **Breadth (16 surfaces)** — mitigated by phasing through the 3 shared primitives; Phase 1 alone delivers the headline value.
- **Double-click discoverability on rows** — mitigated by F2 + the fact that opening→detail still offers single-click rename; revisit with a hover affordance if it tests poorly.
