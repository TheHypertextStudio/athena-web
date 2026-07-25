# Projects Timeline — a generic, manipulable timeline engine

> **Date**: 2026-07-25
> **Status**: Implemented — see `docs/WORKLOG.md` [TIMELINE-001]
> **Supersedes**: the inline `TimelineLens` in `apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx`

## Problem

The Projects Timeline lens is a 75-line component wedged inside a 613-line page client. It is not
a timeline; it is a list with a sparkline.

- **No axis.** The header is two `<span>`s in a `justify-between` — no ticks, no gridlines, no
  month bands, no today rule. A date cannot be read off the chart.
- **No scale model.** The window is raw data extremes with a 30-day floor, so bars always kiss both
  edges, and there is no zoom, pan, or granularity control.
- **Empty bars.** A flat `bg-primary-container` pill carries no name, health tint, progress, lead,
  or milestones — despite `ProjectOverviewItem` carrying all of it.
- **Undated work is plotted.** "Not scheduled" is rendered as text at the 0% position _inside_ the
  plot area, which is why undated projects read as broken rows.
- **Read-only.** No drag to schedule, no resize, and no dependency edges, even though
  `blockedByIds`/`blocksIds` are on the DTO.

Meanwhile `apps/web/src/components/portfolio/` already contains a competent roadmap engine —
calendar-snapped auto granularity, health-tinted bars with milestone diamonds, a sticky axis, a
pinned label column, an unscheduled tray, and a granularity menu. The Projects page reimplemented a
worse version from scratch. **The root problem is duplication, not polish.**

### Concrete defects to fix

| Defect                                                                                 | Location                  |
| -------------------------------------------------------------------------------------- | ------------------------- |
| `Group by` silently discarded — group headers flattened away                           | `projects-client.tsx:400` |
| `new Date(dateOnlyString)` parses UTC-midnight, renders local → off-by-one west of UTC | `projects-client.tsx:285` |
| Axis and label column do not stick on scroll                                           | `projects-client.tsx:289` |
| Bare divs; List lens uses `role="grid"`/`row`/`gridcell`                               | `projects-client.tsx:298` |
| Bar `aria-label` is `"{name} timeline"` — no dates, no status                          | `projects-client.tsx:324` |
| Single-date projects collapse to a 2% dot with no start/target distinction             | `projects-client.tsx:326` |
| `DATE_FORMAT` omits the year — a multi-year roadmap reads "Aug 31 … Aug 31"            | `projects-client.tsx:70`  |

## Goals

1. One timeline engine, generic over row type, consumed by both the Hub portfolio and org Projects.
2. The timeline is a **planning surface**: dragging is how work gets scheduled.
3. Dependencies are live — edges are drawn, violations are visible, ripples are proposed.
4. Nothing about dates, zoom, dragging, or dependencies is hardcoded to Projects.

## Non-goals

- Replacing the Dependencies lens (the graph canvas remains the relationship-editing surface).
- Task-level rows. Projects and their milestones only.
- Baseline/critical-path analysis, resource leveling, or any scheduling solver.

## Architecture

### The catalog abstraction

`views/field-catalog.ts` already established the pattern: a page declares _what its fields are_
once, and the shared toolbar, URL serializer, and apply engine all read that declaration. A new
list page writes a catalog and a data fetch — never a new filter UI.

The timeline gets the same treatment. A new `apps/web/src/components/timeline/` engine is generic
over `T` and driven by a `TimelineCatalog<T>`:

```
id(row)                      stable identity (edge routing, view transitions)
label(row)                   single-line display name
display(row)                 icon + semantic color metadata
span(row)                    { start, end } | null — null means unscheduled
markers(row)                 checkpoint markers (milestones) with dates
tint(row)                    semantic tone (health)
progress(row)                0..1 | null — fill inside the bar
edges(row)                   { blockedBy: Id[], blocks: Id[] }
reschedule(row, span)        the write path; returns a mutation
href(row)                    deep link
```

Projects contributes `project-timeline-catalog.ts` (~40 lines). The Hub portfolio becomes the
second consumer via `hub-timeline-catalog.ts`, retiring the duplicate implementation. Initiatives,
Programs, and Cycles gain a timeline the day someone writes their catalog.

Building against **two consumers before Projects ships** is what proves the abstraction is real
rather than a Projects timeline with a type parameter bolted on.

### Modules

| Module                 | Role                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time-scale.ts`        | Promoted from `portfolio/`. Extended with a viewport window decoupled from data extents (today-anchored by default), a `day` granularity, and zoom/pan. |
| `timeline-catalog.ts`  | The `TimelineCatalog<T>` model and its builders.                                                                                                        |
| `timeline-geometry.ts` | The three geometry tokens (below) and row-index ↔ pixel projection.                                                                                     |
| `timeline-canvas.tsx`  | Sticky axis, pinned resizable label column, collapsible group bands, virtualized rows.                                                                  |
| `timeline-bar.tsx`     | The bar: tint, name, progress fill, markers, edge handles.                                                                                              |
| `timeline-edges.tsx`   | SVG dependency layer with violation state.                                                                                                              |
| `use-timeline-drag.ts` | Pointer-driven move / resize / create, day-snapped.                                                                                                     |
| `unscheduled-tray.tsx` | Promoted from `portfolio/`; becomes a drag _source_ onto the axis.                                                                                      |
| `cascade-proposal.tsx` | The non-blocking downstream-ripple affordance.                                                                                                          |

## Geometry model

Three independent tokens. Nothing downstream may re-couple them.

### 1. Row height — uniform, derived from view configuration

Row height is computed **once per render** from the active display options and applied identically
to every row.

- It is _not_ a hardcoded global constant: display toggles (e.g. "show summary") change it.
- It is _not_ per-row: heterogeneous row heights are prohibited without exception. No content
  measurement, no auto-height, no row that is taller because its project has a summary.
- When a toggle flips, **all** rows change together.

This keeps vertical rhythm predictable, keeps virtualization measurement-free (uniform item size,
recomputed only when options change), keeps gridlines and group bands aligned, and lets the
dependency layer compute waypoints from row indices rather than measuring the DOM.

### 2. Bar geometry — an independent visual token

The bar is centered within the row track and sized for legibility of its own contents (name,
progress fill, markers). It does **not** fill the row. There is no `h-full` and no
`rowHeight - padding` formula. This decoupling lets a bar, a marker-only row, and a rolled-up group
summary occupy the same fixed track without any of them reflowing the timeline.

### 3. Hit geometry — independent again

Comfortable drag and resize targets come from transparent padding around the bar and invisible
edge-handle regions that extend beyond the visual, satisfying touch-target sizing without inflating
either the bar or the row. Interaction ergonomics never drive layout dimensions.

## Display options in view state

Display toggles (show summary, show progress, show markers, granularity) are part of `ViewState`,
alongside filters, grouping, and sort. Each toggle declares which geometry token it affects — for
example "show summary" changes row height, "show progress" changes only bar contents — so a toggle
can never silently re-couple the three tokens. They therefore persist through
`view-state-url.ts` and saved views with no new machinery, and they remain per-view rather than
global — matching how the rest of the views layer already behaves.

Consequence: the wrapped `line-clamp-2` summary is not deleted, it becomes a toggle that defaults
**off** in the timeline lens.

## Interaction model

The governing constraint: **never reject a user action.** Accept the gesture, then surface
consequences non-modally. Undo over confirm; flag over disable.

- **Drag a bar** → commits optimistically on drop. No confirmation dialog. A toast offers Undo.
- **Drag an edge** → resize. **Drag empty track** on an unscheduled row → schedules it.
  **Drag from the tray** → schedules it. One gesture vocabulary everywhere.
- **Violations never block.** If a drag pushes a blocker past a dependent's start, the edge turns
  red _and_ a dismissible chip appears: _"Pushes 2 downstream projects past target — Apply /
  Dismiss."_ Apply is a single transaction with a single Undo. Dismiss leaves the red edge standing
  as persistent signal.
- No control is disabled to prevent an "invalid" state. No bar ever snaps back.
- Dates snap to day boundaries during drag.

### Cascade proposals

Dragging mutates only the dragged row. The dependency graph is walked to find downstream rows whose
constraints are now violated, and the resulting change set is offered for review. This keeps one
drag equal to one intentional decision while still making the ripple visible — the middle path
between Linear (flag only) and classic Gantt (silent auto-cascade).

### View transitions

Switching List ↔ Dependencies ↔ Timeline assigns a stable per-project `view-transition-name` so a
list row morphs into its bar rather than hard-swapping.

## Control surface

The page shows a lens switcher and **two** controls: **Filter** (which rows) and **Display** (how
they are arranged and drawn). Grouping and ordering moved out of the filter bar into Display, where
they belong; the timeline contributes its scale, density, bar-contents, and axis-navigation options
as _sections inside that same menu_, through `FilterToolbar`'s `displayExtras` slot.

This is a rule, not a mobile accommodation. A surface that gains a capability gains a menu item,
never another button. The earlier arrangement — a pill each for Add filter, Group by, Sort by, sort
direction, scale, today, zoom in and zoom out, beside a three-button lens switcher — had no
hierarchy at any width and wrapped to three rows on a phone, pushing the chart below the fold.

Because the viewport is owned by the page (`useTimelineViewport`) rather than by the canvas, the
axis controls compose into that one row instead of forcing a second control band above the chart.

## Visual specification

- Sticky month band over week ticks; persistent today rule. Gridlines run the full canvas height.
- **Bars are calm.** One neutral tonal surface for every bar, with the semantic tone carried by a
  narrow accent at the leading edge and the dot in the label column. Filling each bar with a
  saturated status colour turns the canvas into a stoplight and buries _when_ work happens.
- Surfaces follow the MD3 tonal ladder against the shell's `surface` panel: card
  `surface-container`, sticky axis and group bands `surface-container-high`, bars
  `surface-container-highest`. No bare white panels.
- Group bands separated by tonal steps, not borders or dashed rules.
- Label column: single-line name plus tone dot, user-resizable, defaulting to a responsive
  `clamp(7rem, 30%, 16rem)` rather than a fixed width that starves the plot area on a phone.
- The unscheduled tray lives _inside_ the chart card as a pinned footer — it is the same
  collection, just the rows without a position yet, not a separate island parked below.
- Dependency edges route through the gap _between_ rows (never through a destination bar, which
  reads as a strikethrough) with rounded elbows, drawn from measured pixels.
- The timeline fills the full width and height of the page: every pixel of width is more time on
  screen and every pixel of height is another row, so it is not capped at a reading measure.
- Responsive by CSS breakpoints and container queries; no device branching and no mobile-only props.

## API changes

Extend `ProjectOverviewItem` with a `milestones` array mirroring the existing `HubMilestoneItem`,
so checkpoint markers can render on org project bars. Rescheduling reuses the existing project
`PATCH` for `startDate`/`targetDate`.

DTO changes require running `pnpm --filter @docket/types test`.

## Sequencing

1. **Extract and generalize the engine**; port the Hub portfolio onto it. Two consumers before
   Projects ships.
2. **Projects catalog + read-only lens** — correct axis, rich bars, group bands, markers. Fixes the
   discarded-grouping, timezone, stickiness, and semantics defects.
3. **Dependency edges** + violation state.
4. **Drag to schedule** — move, resize, create, tray drag, undo.
5. **Cascade proposals.**

Each milestone carries its own tests, TSDoc, and documentation updates.

## Risks

- **Abstraction fit.** Hub swimlanes are org-grouped while Projects groups by a `ViewState` field.
  Mitigated by making grouping a caller-supplied concern rather than something the engine assumes.
- **Optimistic reschedule conflicts.** Concurrent edits could clobber. Mitigated by scoping
  invalidation to the overview key and preserving server response ordering.
- **Edge routing at scale.** Many crossing dependency edges become noise. Mitigated by rendering
  edges only for the hovered/selected row plus active violations.
- **Virtualization vs. sticky layers.** Sticky axis and pinned label column must survive
  windowing; validated during milestone 1.

## Validation

- Unit tests for scale math, geometry projection, span resolution, and cascade computation.
- Component tests for grouped rendering, uniform row height across display-option changes, and
  the unscheduled tray.
- Interaction tests for drag, resize, create, undo, and proposal apply/dismiss.
- Rendered browser screenshots in light and dark at desktop and mobile widths before any milestone
  is called done.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`.
