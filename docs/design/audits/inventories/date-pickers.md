# Date picker audit

Every surface in the product where a person reads or writes a date, what it uses, and its state.

This file is **enforced**, not merely written. `apps/web/tests/pickers/date-picker-inventory.test.ts`
derives the call sites from source and fails the build if any of them is missing from the tables
below, if a surface hand-rolls a raw `<input type="date">`, or if any file reintroduces the
``new Date(`${value}T00:00:00`)`` concatenation that put the literal string `Invalid Date` on the
global task list. A picker added without an audit row does not compile past `pnpm test`.

## The contract every calendar-day picker satisfies

One implementation — `packages/ui/src/components/pickers/DatePicker.tsx`, re-exported to the app
through `apps/web/src/components/date-picker/index.ts` — built on one keyboard-operable month grid
(`CalendarGrid.tsx`). Because there is exactly one, these are properties of the product rather than
promises repeated per surface:

| Behaviour                | How                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open                     | Click or Enter on the trigger; the grid takes focus on the committed day.                                                                                       |
| Move the highlight       | `←`/`→` a day · `↑`/`↓` a week · `PageUp`/`PageDown` a month · `Shift` + those a year · `Home`/`End` the month ends.                                            |
| Commit                   | `Enter`, `Space`, or a click on a day. Nothing else writes.                                                                                                     |
| Escape                   | Closes, writes nothing, keeps the previously committed value.                                                                                                   |
| Outside click            | Same as Escape.                                                                                                                                                 |
| Change an existing value | One open → select cycle. No clear-first step; the saved day opens pre-selected.                                                                                 |
| Bounds                   | Days outside `TASK_DATE_MIN`–`TASK_DATE_MAX` (1970-01-01 – 2200-12-31) are _unreachable_, not merely rejected — the picker cannot emit a value the API refuses. |
| Ranges                   | The end can never precede the start: each end bounds the other, so an inverted window is unexpressible.                                                         |
| Broken values            | A stored value that cannot be read renders the surface's own placeholder. `Invalid Date` is unreachable.                                                        |

Asserted in `apps/web/tests/pickers/date-picker-contract.test.tsx` (17 cases) and
`apps/web/tests/pickers/calendar-date.test.ts` (13 cases).

Planning periods use `TimeframePicker.tsx`, which composes the same `CalendarGrid` for a specific
day and adds Linear-compatible month, quarter, half-year, and year choices. Broad values commit a
canonical boundary, resolution, and fiscal snapshot together. Their trigger renders the semantic
period label instead of exposing that boundary. `TimeframeRangePicker` keeps Project start and
target values independent while rejecting an inverted pair. Its interaction and calendar
delegation are asserted in `apps/web/tests/pickers/timeframe-picker-contract.test.tsx`.

## Calendar-day pickers (`DatePicker` / `DateRangePicker`)

| #   | Surface                                   | File                                                                        | Field(s)                          | Status                                        |
| --- | ----------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| 1   | Task detail → properties rail             | `apps/web/src/components/task-detail/task-properties-rail.tsx`              | Start date, Due date              | Shared picker                                 |
| 2   | Task create/edit composer                 | `apps/web/src/components/tasks/task-form-pickers.tsx`                       | Due date                          | Shared picker                                 |
| 3   | Project detail → properties panel         | `apps/web/src/components/project-detail/properties-panel.tsx`               | Timeline (start → target)         | Shared picker                                 |
| 4   | Project create composer                   | `apps/web/src/components/projects/create-project.tsx`                       | Timeline (start → target)         | Shared picker                                 |
| 5   | Initiative detail → properties panel      | `apps/web/src/components/initiatives/properties-panel.tsx`                  | Target date                       | Shared picker                                 |
| 6   | Initiative create composer                | `apps/web/src/components/initiatives/create-initiative.tsx`                 | Target date                       | Shared picker                                 |
| 7   | Cycle detail → metadata row               | `apps/web/src/components/cycle-detail/cycle-metadata-row.tsx`               | Cycle window (start → end)        | Shared picker                                 |
| 8   | Cycle create composer                     | `apps/web/src/components/cycles/create-cycle.tsx`                           | Cycle window (start → end)        | Shared picker                                 |
| 9   | Triage → Athena suggestion editor         | `apps/web/src/components/triage/suggestions-lane.tsx`                       | Due date                          | **Migrated** from a raw `<input type="date">` |
| 10  | Agenda → move entry to another day        | `apps/web/src/components/agenda/agenda-entry-actions.tsx`                   | Move to                           | **Migrated** from a raw `<input type="date">` |
| 11  | Search → date facet                       | `apps/web/src/components/search/search-client.tsx`                          | From, To                          | **Migrated** from a raw `<input type="date">` |
| 12  | Athena conversation browser → search lens | `apps/web/src/components/athena/athena-conversation-browser.tsx`            | From, To                          | **Migrated** from a raw `<input type="date">` |
| 13  | Calendar → item drawer, all-day item      | `apps/web/src/components/calendar/item-drawer/core-fields-form.tsx`         | Starts, Ends                      | **Migrated** from a raw `<input type="date">` |
| 14  | Project detail → Milestones panel         | `apps/web/src/components/project-detail/project-milestones.tsx`             | Target date                       | Shared picker                                 |
| 15  | Project create/edit composer → pickers    | `apps/web/src/components/projects/project-form-pickers.tsx`                 | Timeline (start → target)         | Shared picker                                 |
| 16  | Initiative create/edit composer → pickers | `apps/web/src/components/initiatives/initiative-form-pickers.tsx`           | Target date                       | Shared picker                                 |
| 17  | Agenda → quick create an all-day item     | `apps/web/src/components/calendar/create-block-form.tsx`                    | Starts, Ends                      | Shared picker                                 |
| 18  | Agenda → quick create a timed item        | `apps/web/src/components/calendar/create-block-schedule-editor.tsx`         | Start date, End date              | Shared picker                                 |
| 19  | Repeating work → schedule editor          | `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx` | Apply from, moved occurrence      | Shared picker                                 |
| 20  | Task composer → repeat property           | `apps/web/src/components/recurrence/repeat-task-control.tsx`                | Start date, End date              | Shared picker                                 |
| 21  | Settings → work locations                 | `apps/web/src/app/(app)/settings/work-locations/page.tsx`                   | Date, effective range, occurrence | Shared picker                                 |
| 22  | Work locations → schedule editor          | `apps/web/src/components/work-location/schedule-editor-dialog.tsx`          | Date, effective range             | Shared picker                                 |
| 23  | Work locations → occurrence editor        | `apps/web/src/components/work-location/occurrence-editor-dialog.tsx`        | Occurrence date                   | Shared picker                                 |

Before this pass, rows 9–12 each hosted their own `<input type="date">`, so four surfaces had four
different behaviours and none of them had bounds. Rows 1–8 already shared a component, but that
component was itself a bare native input in a popover — it had no highlighted day, so `Enter` and
the arrow keys did nothing, which is the "strange interaction semantics" this audit was opened for.

## Instant and clock fields — a different control, deliberately

These name a _moment_, not a calendar day. They carry timezone and DST-fold semantics a day picker
has no way to express (the calendar fields let a person resolve the ambiguous hour that occurs
twice on a fall-back night). They are inventoried here for completeness and are **not** held to the
calendar-day contract.

| Surface                             | File                                                                    | Field                    | Control                                               |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------- |
| Calendar → create/edit block        | `apps/web/src/components/calendar/calendar-time-field.tsx`              | Starts at, Ends at       | `datetime-local` + explicit Earlier/Later fold choice |
| Athena → elicitation answer         | `apps/web/src/components/athena/elicitation-control.tsx`                | Agent-requested datetime | `datetime-local`, shape chosen by the agent's schema  |
| Settings → notification quiet hours | `apps/web/src/components/settings/notification-preferences-section.tsx` | Quiet hours start/end    | `time` (a clock, no date)                             |
| Settings → work locations           | `apps/web/src/app/(app)/settings/work-locations/page.tsx`               | Planned start/end        | `time` + explicit Earlier/Later fold choice           |
| Admin → notification console        | `apps/admin/src/app/(admin)/notifications/notification-console.tsx`     | Scheduled send           | `datetime-local`                                      |

## Formatting

`apps/web/src/components/date-picker/format-day.ts` is the app's only sanctioned day formatter.
It accepts either shape the API actually returns for a date field (`YYYY-MM-DD` _or_ a full ISO
instant, since the columns are `timestamp`), reads the calendar day without shifting it into the
viewer's zone, and returns `null` — never `"Invalid Date"` — when there is nothing readable.

Five call sites were fixed to use it:

| File                                                         | Was                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `apps/web/src/app/(app)/tasks/all-tasks-client.tsx`          | ``new Date(`${dueDate}T00:00:00`)`` → rendered `Invalid Date` in the due column |
| `apps/web/src/components/rail/day-tasks-panel.tsx`           | same expression                                                                 |
| `apps/web/src/app/(app)/calendar/calendar-schedule-model.ts` | same expression                                                                 |
| `apps/web/src/components/agenda/agenda-header.tsx`           | same expression                                                                 |
| `apps/web/src/components/agenda/agenda-canvas.tsx`           | same expression                                                                 |

`apps/web/src/lib/format-date.ts` remains for values that are genuinely instants; it already
returns `null` on unparseable input.

## Measured against the running app

Driven through a real browser on the dev stack, signed in, against the live API — not asserted in
jsdom. Task detail, Due date, 1440×900 light:

| Step                  | Observed                                                                         |
| --------------------- | -------------------------------------------------------------------------------- |
| Open                  | Focus lands on `2026-08-12`, the committed day                                   |
| `→`                   | Highlight moves to `2026-08-13`                                                  |
| `↓`                   | Highlight moves to `2026-08-20`                                                  |
| `PageDown`            | Highlight moves to `2026-09-20`                                                  |
| `Escape` after moving | `GET /v1/orgs/{org}/tasks/{id}` still returns `2026-08-12` — nothing was written |
| Reopen, `→`, `Enter`  | API returns `2026-08-13`                                                         |
| Reload the page       | Trigger reads `Aug 13, 2026`                                                     |

Viewport insets of the open popover, measured with `getBoundingClientRect` against
`innerWidth`/`innerHeight`: 1440×900 `{left 404, top 369, right 730, bottom 144}`; 390×844
`{left 72, top 329, right 12, bottom 128}` — identical in light and dark. The 12px right gutter at
390 is `OVERLAY_COLLISION_PADDING`; the picker never touches an edge.

**`Invalid Date` sweep.** Four tasks seeded through the API at the boundary values
(`1970-01-01`, `2200-12-31`, `2028-02-29`, and no dates at all), assigned, then eleven day-facing
routes crawled for `/invalid date|NaN|Jan 1, 1970|1970-01-01/i`: `/tasks`, `/today`, `/agenda`,
`my-work`, `tasks`, `projects`, `cycles`, `initiatives`, `programs`, `stream`, `triage` — **zero
matches on all eleven**. The global task list, which is where the defect shipped, renders those
rows as `Jan 1`, `Feb 29`, `Dec 31`, and an empty cell.
