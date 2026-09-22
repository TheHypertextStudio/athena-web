---
surfaces: ['orgs-[orgId]-tasks-[taskId]']
date: 2026-09-22
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: task detail, relationships and layout — 2026-09-22

Review of the task page after TASK-DETAIL-003: every relationship editable in place, every property
in one sidebar, and flat sections on one right edge, measured against
[`docs/design/references/detail-page-layout.md`](../references/detail-page-layout.md).

## Evidence

- `docs/design/audits/evidence/2026-09-22-task-detail-1920-light.png` and `-dark.png`: a populated
  task at 1920×1080 with the calendar rail open, after adding a blocker, a blocked task, a related
  task, a new subtask, an attached and detached subtask, and a parent, all through the page.
- `capture-shots.ts` set for a seeded task and its project (1440×900 and 390×844 in both themes,
  plus the 320px overflow check), written to `apps/web/.data/design-review/2026-09-22-task-detail/`.
- `apps/web/e2e/task-detail-layout.spec.ts`: at 1920px the description, Subtasks, Relations, and
  Activity share one right edge to the pixel; each property is on screen once; no sideways scroll
  at 390px and 320px; the keyboard pass below.
- `apps/web/e2e/task-relations.spec.ts`: every relationship write, end to end, three repeats green.

## Scores

| Dimension  | Score | Evidence                                                                                                                                                                      |
| ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand      | 3     | Plex and MD3 tones throughout; no new surface roles.                                                                                                                          |
| Typography | 3     | Section headings `title-small`, counts `body-medium`, sidebar one token. Description headings still render at `title-large`, above the section headings (open, below).        |
| Spacing    | 3     | One right edge for the body column (measured); 32px between sections, 36px rows, flush sidebar rows, 16px to the provenance footer.                                           |
| Hierarchy  | 3     | Title, one primary action (Track), then description, Subtasks, Relations, Activity; properties in the sidebar.                                                                |
| Color      | 3     | Tonal only: no borders, dividers, or resting backgrounds on sections; hover and focus tint rows.                                                                              |
| Motion     | 3     | Search popovers open from the Relations menu after it closes, with no flash or dismissal. A closing search still animates out under the next one opened from another control. |
| States     | 3     | Empty Subtasks and Relations are a heading and their actions; Milestone appears only once there is a project; the search re-asks while the index catches up.                  |
| Detail     | 3     | No overflow at 320px; the remove button shows on hover, on focus, and always on touch; the status chip lost its lone chevron.                                                 |

## Gates

- **a11y**: the keyboard spec adds a subtask, tabs from a row link to its toggle and remove button
  (visible on focus), opens the Relations menu with Enter, and lands focus in the search. Every icon
  button carries an accessible name; each row is one link.
- **responsive**: two columns at 1920px, one column with chips at 1440px with the rail open, 390px,
  and 320px, with no sideways scroll.
- **theme-parity**: the 1920 and 390 captures in both themes match.
- **no-placeholder**: no sentences in empty sections; no read-only placeholder rows.
- **screenshots**: listed above.

## Findings, by severity

1. Activity sentences for relationship changes read mechanically ("set Dependency to Blocked by
   Confirm the venue", "cleared Dependency"). Change `format-activity.ts` to name relationship
   edits as added or removed links.
2. Description headings (`title-large`) outrank section headings (`title-small`). Settle the
   document heading scale across every entity brief.
3. Right-click "Create subtask" on a task still creates a literal "New subtask"; the page's `+`
   composer is the better path and the menu item should open it.
4. Project, initiative, and program pages do not yet follow the layout rules (bordered summary
   cards, the milestones explainer sentence).
