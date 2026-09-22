# Detail page layout

The layout rules for every entity detail page: tasks, projects, initiatives, programs, cycles, and
teams. They cover the body below the tab bar. The masthead above it is specified in
[`entity-detail-hierarchy.md`](./entity-detail-hierarchy.md), and surface tones in
[`semantic-surfaces.md`](./semantic-surfaces.md).

Every rule states a number or a condition that a screenshot or a bounding-box test can check.
`apps/web/e2e/task-detail-layout.spec.ts` checks rules 1, 2, 3, and 8 on the task page.

## Status

| Page                         | Follows these rules | Notes                                             |
| ---------------------------- | ------------------- | ------------------------------------------------- |
| Task                         | Yes                 | Reference implementation (TASK-DETAIL-003).       |
| Project, initiative, program | Partly              | Header chips, no sidebar; bordered summary cards. |
| Cycle, team                  | Partly              | Body sections predate `DetailSection`.            |

A page that does not yet follow a rule keeps its current layout until it moves onto the shared
pieces below. New work on any detail page follows the rules.

## The shared pieces

- `EntityDetailLayout` (`apps/web/src/components/views/entity-detail-layout.tsx`) owns the grid,
  the masthead, the tab bar, and the optional sidebar (its `aside` slot).
- `DetailSection` (`apps/web/src/components/entity-detail/detail-section.tsx`) is the frame for
  every body section.
- `PropertyRow` (`apps/web/src/components/task-detail/PropertyRow.tsx`) is one label/value row in
  the sidebar.
- `EntityDocument` (`apps/web/src/components/editor/entity-document.tsx`) is the description or
  brief.

## Rules

### 1. Two columns on a wide pane, one on a narrow pane

At a pane width of `ENTITY_DETAIL_ASIDE_MIN_WIDTH` (896px) or more, a page with a sidebar shows
two columns: the body (`minmax(0, 1fr)`) and a 20rem (320px) sidebar, 2rem (32px) apart. Below
that width the sidebar is not rendered and the page is one column.

### 2. One left edge and one right edge per column

Every child of the body spans the body column. The description surface, each section's heading
row, and each list row all start at the column's left edge and end at its right edge.

- No body child sets its own `max-width`, `mx-auto`, or fixed width.
- Line length for prose is held inside the editor (75ch on its blocks). The surface around the
  prose spans the column.

### 3. Each property appears once

- Wide pane: every property is a sidebar row, and the masthead's chip row renders nothing.
- Narrow pane: every property is a chip in the masthead row. Lower-priority chips move into the
  row's overflow menu as the pane narrows.
- Sidebar rows are 36px (`h-9`) and share one label gutter (`w-28`, 112px) and one value edge.
  Rows sit flush in one list, with no spacing groups between them.
- Read-only facts (created date, where imported work came from) sit in a muted footer below the
  rows, 16px down, as a definition list.
- Sidebar order: status, priority, assignee, delegate, project, parent, milestone, cycle, program,
  labels, due, anticipated start, estimate.

### 4. Section headings are bare; the rows under them are segmented lists

A section is a 36px heading row, then its rows 8px below.

- Heading row: the label in `text-title-small`, an optional count in `text-body-medium`
  `on-surface-variant`, then the section's actions (icon buttons, `ghost`, `size="sm"`) at the
  right end. The heading row itself has no background.
- Rows sit in a `SegmentedList` (`apps/web/src/components/entity-detail/segmented-list.tsx`), MD3
  Expressive's segmented list. Each row is a 44px `card`-tone segment with 12px of inner inset,
  2px from the next. The group's outer corners are `corner-lg` (16px) and the joins between rows
  are `corner-xs` (4px). Hover and focus lift a row to `surface-container-high`.
- No border, divider, or shadow anywhere in a section.
- A sub-group inside a section is labelled by a 28px `text-label-medium` heading, inset 12px to
  line up with the row content. Sub-groups are 16px apart.

### 5. Spacing

| Between                                   | Space |
| ----------------------------------------- | ----- |
| Body sections (including the description) | 32px  |
| A section's heading row and its rows      | 8px   |
| Segments in a list                        | 2px   |
| Sub-groups in a section                   | 16px  |
| Sidebar rows and the provenance footer    | 16px  |
| The masthead glyph and the title below it | 12px  |

Use only these values in a detail body. A new spacing value needs a new rule here first.

### 6. Empty sections

An empty section is its heading row and its add action. It has no sentence and no placeholder
row. Examples: Subtasks with no subtasks shows "Subtasks", then `+` and "Add existing task".
Relations with no links shows "Relations", then `+`.

### 7. At most one contents list, and never beside a sidebar

The description's generated contents list (`EntityDocument`'s `contents`) is allowed only on a
page without a sidebar. A page with a sidebar passes `contents={false}`.

### 8. No horizontal overflow

The page never scrolls sideways at any width from 320px to 1920px.

- A detail body uses container queries (`@2xl:`, `@4xl:`), never viewport breakpoints (`sm:`,
  `md:`), because the pane width differs from the viewport width whenever a side panel is open.
- No body child sets a minimum width.

### 9. Every relationship shown can be edited where it is shown

When the viewer can contribute, each relationship on the page can be added and removed in place.

- Subtasks: `+` adds a new subtask inline. The link button attaches an existing task. A row's
  remove button moves that subtask to the top level, with Undo.
- Relations: `+` opens a menu (Add blocker, Add blocked task, Add related task). Each menu item
  opens a task search, which never offers the task itself or a task already linked to it. A
  row's remove button removes the link and leaves the other task unchanged.
- Parent: a sidebar row with a task search and a "No parent" choice.
- Each of these is also a command-palette action on the task page.
- Open work added under a parent a person closed offers Reopen in a notice naming the parent. A
  parent the workspace closed from its subtasks reopens on its own.

## Checking a page

1. Capture the page at 1440×900 and 390×844 with `apps/web/e2e/tools/capture-shots.ts`, and a
   320px overflow check (see [`ui-verification.md`](../../engineering/ui-verification.md)).
2. At 1440px, the right edges of the description and every section's heading row match to the
   pixel.
3. No property label appears twice on the page.
4. Every empty section shows its heading and its actions, with no sentence.
