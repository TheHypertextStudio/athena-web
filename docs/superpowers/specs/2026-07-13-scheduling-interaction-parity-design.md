# Scheduling Interaction Parity Design

> **Status**: Approved by the active calendar UX objective
> **Date**: 2026-07-13
> **Area**: Shared scheduling canvas, calendar, agenda

## Objective

Make Docket's shared agenda/calendar canvas as predictable and direct as the useful parts of Google
Calendar and Sunsama while preserving Docket's differentiators: fluid arbitrary lanes, events and
timeboxes as distinct objects, task-to-time-region relationships, provider-neutral permissions, and
an always-rendered grid.

Parity means interaction quality, not copying either product's layout. A user must be able to read
the time axis, understand collisions, create a region, move an editable item, resize either edge,
and distinguish read-only data without opening a modal. Every visible preview must match the bounds
that persistence receives.

## Approaches Considered

### Evolve the shared canvas with focused geometry modules — selected

Keep `SchedulingCanvas` as the consumer-neutral host, extract time-axis, collision, event-card, and
gesture responsibilities, and preserve the existing query/mutation boundary. This reuses the
working arbitrary-lane and fail-soft architecture while replacing the weak interaction internals.

### Restore the legacy calendar timeline

The legacy timeline already has a pure collision helper, but it is date-view-specific, is not used
by Agenda, and would recreate two rendering engines. It is useful as an algorithm reference, not as
the production surface.

### Adopt a third-party calendar widget

A packaged calendar could provide common drag and collision behavior, but most assume named day or
week modes, fixed resource views, and library-owned persistence. Adapting one would fight the fluid
lane contract and make events, timeboxes, task drops, and always-rendered error states harder to
reason about.

## Time Axis

The canvas receives one `displayTimezone`. Date lanes share a 24-hour wall-clock axis so the same
local time remains horizontally aligned across arbitrary adjacent dates. People lanes use that same
viewer-timezone axis, which means a horizontal row represents the same instant for every person;
each person's own timezone appears as secondary header metadata and never changes item geometry.

The wall-clock grid remains stable on daylight-saving transitions. Temporal converts local clock
positions to exact instants and detects ambiguity. A spring-forward hour is visibly marked as
skipped and cannot silently produce a different label. A repeated fall-back hour is marked as
repeated, and affected event labels include a short timezone abbreviation. Existing events that
cross the repeated hour retain a non-zero visual duration instead of disappearing. Query boundaries
still use the exact interval between consecutive local midnights, so reads include all 23 or 25
elapsed hours even though the familiar wall-clock grid remains aligned across date lanes.

Ticks are derived from zoom:

- the active snap interval is the minor grid interval;
- the labeled interval is the smallest readable interval whose labels remain at least 44 physical
  pixels apart;
- available labeled intervals are 2 hours, 1 hour, 30 minutes, and 15 minutes;
- all labels use locale-aware time formatting and the canvas timezone;
- the current-time indicator uses the same instant-to-pixel mapping.

The supported zoom remains 24–240 pixels per elapsed hour. Presets are shortcuts over that scalar:
Overview (24), Standard (72), and Detail (144). The slider and keyboard controls can still select
intermediate values; presets never select a separate rendering mode.

## Collision Layout

Each lane computes overlap clusters from its clipped timed items. Items in one cluster receive
stable side-by-side columns. Sorting is deterministic by start instant, longer duration, then stable
id, so API order cannot decide which item is visible.

Layout uses the greater of the item's true visual height and its minimum interactive height. This
means short adjacent items that would physically collide at low zoom are treated as a visual
collision instead of painting on top of one another. No item is fully hidden. Hover, keyboard
focus, and active manipulation elevate the selected item without changing the underlying column
assignment.

## Direct Manipulation

Dragging the body of an editable timed item moves it. A four-pixel movement threshold distinguishes
a click from a drag. Before that threshold, releasing opens the item workspace. After it, pointer
capture keeps the gesture stable and a live preview shows the proposed lane, start, end, and time
range. Vertical and horizontal edge proximity auto-scroll the viewport. Escape or pointer cancel
restores the original position.

Editable items expose visible start and end resize grips on hover, focus, and touch selection. The
grips use the same preview and cancellation model as move. A zero-distance gesture is always a
no-op, including when the item is shorter than the current snap interval. The minimum duration is
applied only after a non-zero resize delta.

The interaction controller refuses a preview or commit when the item, source lane, or target lane
is read-only. Consumers still recheck permissions when persisting. Multi-day and all-day items do
not expose timed move/resize until their full-range behavior is supported; Agenda and Calendar use
the same rule.

Native object drag is separated from time movement. Tasks can still be dragged from other surfaces
onto an event or timebox. A calendar item uses a dedicated relationship-drag affordance so browser
native drag-and-drop cannot compete with pointer movement or resize.

## Event Presentation

Timed items use layer color as a tint and border rather than relying on color alone. The card shows
title and formatted time when height permits, with compact and marker treatments at smaller
heights. Hover and focus provide a clear outline and elevation. Resize grips, move cursor, pending
sync state, and read-only state are visible without opening the drawer.

Loading, empty, stale, and failure messages remain non-blocking overlays. They never unmount the
axis, lanes, current-time indicator, or locally available items.

## Data Flow

The canvas continues to emit proposed semantic wall-clock bounds. Calendar and Agenda convert those
bounds to exact instants in `displayTimezone` through the shared Temporal helper, apply an
optimistic cache patch, and reconcile through the existing typed mutation layer. Provider writes
retain pending/conflict behavior. Failure rolls back the optimistic position and shows fixed safe
copy; server exception text is never rendered.

## Accessibility

- Event bodies, relationship-drag affordances, and both resize grips have stable accessible names.
- Move and resize grips support arrow-key adjustment by the active snap interval.
- The item drawer remains the non-pointer editing alternative.
- Focus order follows chronological order, not paint order.
- Read-only items remain openable and linkable but never expose false move/resize affordances.

## Verification Contract

Pure tests cover zoom/tick policies, locale formatting, DST boundaries, instant/pixel round trips,
collision clusters, identical/nested/transitive/adjacent events, and stable ordering. Component
tests cover click-versus-drag, live move preview, same/cross-lane commits, start/end resize, cancel,
zero-distance short events, read-only source and target lanes, multi-day gating, relationship drag,
and persistent grid overlays.

Calendar and Agenda integration tests prove exact optimistic mutation payloads. A browser-capable
session must then exercise the real component at desktop and narrow widths in light and dark themes,
including a recorded manipulation pass. Automated tests and a production build do not substitute
for that visual evidence.
