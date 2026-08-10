# Agenda Rail Structural Redesign

> **Status**: Approved in conversation; awaiting written-spec review
> **Date**: 2026-08-10
> **Area**: Agenda rail, shared scheduling canvas, layered calendar
> **Refines**: `2026-06-29-portable-agenda-rail-design.md` and
> `2026-07-13-scheduling-interaction-parity-design.md`

## Objective

Make the Agenda rail a purpose-built single-day companion rather than a full multi-lane calendar
compressed into a narrow panel. The rail must answer three questions quickly:

1. What day am I viewing?
2. What occupies that day?
3. Where can I add or adjust time?

The redesign removes redundant chrome and decorative geometry, improves event legibility, separates
day context from scheduled events, and gives empty calendar space a direct creation interaction.
The full Calendar and the Agenda continue sharing scheduling geometry and creation semantics; the
rail owns a smaller presentation shell suited to one day and a narrow width.

## Problems Observed

The current rail exposes implementation structure that does not serve a single-day companion:

- The outer Agenda adds twelve pixels around a second rounded calendar surface, leaving an
  unexplained inset between the rail and the time grid.
- The day appears twice: once as `Today · Aug 10` in the Agenda header and again as `MON 10` in the
  shared lane header.
- Provider work-location data can appear as if it were a timed event, although it describes the
  day rather than occupying time.
- Narrow or concurrent events lose most of their titles and sometimes their useful time labels.
- Adjacent event fills touch with no visible pacing and merge into one continuous mass.
- Layer accents are implemented as the card's rounded left border, so the line bends around both
  corners and reads as accidental decoration.
- Persistent lock glyphs spend scarce title width on an interaction constraint that matters only
  when editing.
- The rail exposes fractional zoom values such as `3.1×`, derived from persisted pixels-per-hour
  arithmetic rather than an intentional user-facing scale.
- Previous and next buttons support one-day stepping, but the date is not an obvious control for
  jumping across weeks or months.
- The shared canvas supports region selection and the full Calendar already has a quick-create
  form, but the Agenda rail does not connect them.

## Approaches Considered

### Purpose-built rail shell over shared scheduling primitives — selected

Keep the shared timezone, item normalization, collision, pointer-selection, drag, resize, and exact
time conversion modules. Give the Agenda its own single-day header, day-context strip, all-day strip,
edge-to-edge viewport, event presentation, and responsive quick-create host.

This preserves one scheduling engine while preventing the rail from inheriting multi-lane chrome
that has no meaning in a one-day panel. It introduces a deliberate rail presentation layer rather
than a second calendar implementation.

### Add presentation flags to the existing shared canvas

Flags such as `hideLaneHeading`, `edgeToEdge`, `eventGap`, and `hideReadOnlyIcon` could make the
current canvas resemble the desired rail. This is initially smaller, but it turns the canvas into a
matrix of surface-specific exceptions and keeps unrelated concerns coupled to one component.

### Make the rail list-first and reserve the timeline for Calendar

A chronological list would maximize title readability and simplify creation. It would remove the
spatial representation of duration and overlap, which is the rail's most useful distinction from
the day plan. The existing list view remains available, but the timeline remains the default.

## Selected Structure

### 1. Single date/navigation header

The rail has one date representation:

```text
‹   Today · Aug 10 ▾   ›
```

- Previous and next move by one calendar day.
- The centered date is a button. It opens the shared date picker for direct week/month jumps.
- When the viewed day is not today, the picker and header expose a one-action return to Today.
- Left/right keyboard shortcuts move one day and `T` returns to Today when focus is on the Agenda
  header or grid, never while an editable control owns the keystroke.
- The shared lane heading (`MON 10`) is not rendered in the single-day rail. Multi-lane Calendar
  headings remain unchanged.
- The list/timeline switcher remains available but does not compete with the date. At widths where
  both cannot fit, view choice moves into the Agenda display menu rather than wrapping the header.

### 2. Day context and all-day content

The region below the header has two optional rows with distinct semantics:

1. **Day context** carries non-blocking facts such as work location. A working-location item renders
   as a quiet chip such as `Home`, not as an all-day or timed event. If no supported context exists,
   the row does not render.
2. **All day** carries real all-day events in compact rows. It does not sit inside an oversized
   tinted lane-header panel.

Provider normalization must preserve enough event semantics to classify working-location records
before presentation. Title matching is not acceptable: a normal event named `Home` remains an
event. Unsupported provider metadata is omitted rather than guessed into either row.

### 3. Edge-to-edge timed viewport

- The header keeps its own horizontal inset, but the time viewport runs edge-to-edge inside the
  rail body.
- The rail shell owns clipping and outer corner radius. The scheduling viewport does not add a
  second rounded card or twelve-pixel outer padding.
- The hour gutter remains sticky and only as wide as its labels require.
- The grid begins immediately after the gutter. A single quiet separator may divide gutter and
  lane; there is no decorative box around the grid.
- The current-time line remains visible but uses the same restrained geometry as the full Calendar
  and does not overpower event text.

### 4. Intentional scale

The Agenda uses three persisted scale steps:

| Step | Pixels per hour | Purpose                         |
| ---- | --------------: | ------------------------------- |
| `1×` |              48 | Fit most of a working day       |
| `2×` |              96 | Read and adjust ordinary events |
| `3×` |             144 | Precise scheduling              |

- The default is `1×`.
- Increment and decrement move only between these steps.
- Existing fractional values snap to the nearest step when read and are rewritten on the next
  scale action.
- Scale controls move out of the all-day gutter into the Agenda display menu. The active step may
  be shown there, but the resting timeline never displays a fractional multiplier.
- The full Calendar may retain its own wider zoom contract; the rail's narrow, reading-oriented
  context does not expose that continuous scalar.

## Event Geometry and Presentation

### Spacing

- Vertically adjacent timed events have at least one physical CSS pixel of visible separation.
- Concurrent columns have at least two pixels between them.
- A lone event does not receive the current four-pixel outer inset on both sides. It uses the lane
  width except for the one-pixel pacing required to distinguish it from grid boundaries.
- Spacing is presentation-only. Exact start/end positions, collision detection, selection, and
  persisted times continue using true bounds.

### Layer accent

Layer identity becomes a straight two-pixel inset bar placed inside the event with flat ends and a
small top/bottom inset. It never follows the card radius or wraps around a corner. Event fill remains
tonal; layer hue identifies source without becoming the event's entire background.

### Content budget

Event contents are assigned in this order:

1. Title
2. Time range
3. Optional source/context metadata

A marker-height event keeps a readable title before any icon. Compact events show the title and a
short time when both fit. Taller events wrap the title to the line count supported by their measured
height instead of truncating it to one line because the lane is narrow. Long events keep their
title/time cluster visible near the top of their currently visible segment when the original top has
scrolled out of view.

Dense-overflow controls use a compact textual disclosure such as `+1 more` rather than a large
empty-looking block. Opening it presents every hidden event with full title and time.

### Permissions

Read-only is an interaction rule, not persistent event content:

- Ambient timed and all-day cards do not show lock glyphs.
- Read-only items remain openable.
- Move and resize controls simply do not appear when unavailable.
- The item workspace states `Read-only` and explains provider permission or conflict details when
  the user attempts to understand or change the item.
- Accessible descriptions may still communicate read-only state without reserving visible title
  space.

## Direct Creation

### Pointer flow

- Clicking empty timed space creates a local thirty-minute draft at the nearest active snap point.
- Pressing and dragging empty timed space creates a draft matching the selected region.
- Pressing empty space starts selection; the draft and dialog appear only after a valid click or
  drag commits. Pointer cancel, Escape during selection, or lost capture clears the preview.
- Clicking the all-day strip creates an all-day draft for the viewed date.
- Clicking an existing event opens it and never starts creation underneath it.

The draft is not persisted and does not force saved events into new collision columns. It renders
as a translucent overlay with a clean outline, exact time label, and the same one-pixel pacing as
saved items. It remains selected while its creation dialog is open.

### Quick-create dialog

One shared quick-create component serves Calendar and Agenda:

- On the full Calendar it anchors beside the selected region.
- In the desktop rail it opens toward the main content so it never narrows or covers the time axis.
- In the mobile Agenda Sheet it becomes a bottom sheet with the same fields and actions.

The compact form contains:

- `Event` / `Time block` choice, using the saved default create intent;
- an autofocus title field;
- start and end fields that update the draft immediately;
- a writable destination calendar for events;
- `Save`, `Cancel`, and `More details` actions.

`More details` carries the unsaved draft into the full item creation workspace. It does not persist
a temporary calendar item first.

### Draft lifecycle

```text
idle → selecting → draft-open → saving → saved
  └────────────── cancel/dismiss ──────────────→ idle
                         saving failure ───────→ draft-open
```

- Closing an untouched dialog discards the draft immediately.
- Cancel always discards it.
- Escape closes the dialog and discards the draft unless focus is inside a nested picker that owns
  Escape first.
- Save moves the local draft into one visible `saving` projection. Success turns that same
  projection into the persisted item; failure returns it to `draft-open`. The UI never paints a
  draft and an optimistic item for the same create request at once.
- A failed save keeps the draft and entered values visible, restores the submit action, and shows
  application-owned recovery copy. Provider exception text is never rendered.
- Navigating to another date with an edited draft asks for discard confirmation; an untouched draft
  is discarded automatically.

## Component Boundaries

The redesign keeps responsibilities explicit:

- **Agenda shell** owns date navigation, view choice, rail scale, responsive dialog placement, and
  the separation of day context/all-day/timed regions.
- **Calendar item classifier** maps provider semantics into `day_context`, `all_day`, or `timed`
  presentation categories without title heuristics.
- **Scheduling geometry** owns time positions, collision columns, snapping, selection previews,
  and gestures. It does not own Agenda chrome or persistence.
- **Agenda event surface** owns the rail-specific content budget, spacing, flat accent, and hidden
  permission chrome while consuming shared geometry.
- **Quick-create controller** owns one draft, its responsive form, exact-time resolution, mutation,
  cancellation, and error state. Calendar and Agenda provide only placement and the selected date
  or region.

## Accessibility

- The date trigger announces the full selected date and that it opens a picker.
- Previous, next, and Today actions retain explicit accessible names.
- Empty time slots support keyboard creation through the focused grid and Enter/Space; the default
  draft duration is thirty minutes and arrow keys adjust the selected region by the active snap.
- The draft region is announced with its exact start and end time.
- Focus moves into the quick-create title after selection and returns to the originating grid region
  on cancel or failure dismissal.
- Event titles remain the accessible name. Read-only description is supplemental and never replaces
  it.
- The mobile bottom sheet traps focus and restores it to the Agenda trigger or selected region.

## State and Error Handling

- Empty, loading, stale, and failed calendar reads keep the grid mounted.
- Loading or degraded notices do not add a second scrollport or displace the date header.
- A working-location classification failure omits the context chip; it does not manufacture an
  event or block Calendar rendering.
- Invalid or ambiguous wall-clock bounds keep the draft visible and explain how to choose a valid
  time. No bound is silently coerced across a daylight-saving gap or fold.
- Changing scale or view keeps the current wall time anchored. An open creation draft retains its
  exact instants and reprojects into the new geometry.

## Scope

### Included

- Single-date header and fast date picker jump
- Day-context classification for working location
- Compact all-day strip
- Edge-to-edge rail time viewport
- Three discrete Agenda scale steps
- Event spacing, flat layer accent, readable content budgets, and quiet read-only behavior
- Click, drag, and all-day draft creation
- Shared responsive quick-create behavior across Calendar and Agenda
- Tests and updated calendar/Agenda documentation

### Excluded

- Recurrence authoring in the compact dialog; it belongs in `More details`
- Attendee, conferencing, and reminder fields in quick create
- Redesigning the full Calendar toolbar or multi-lane headings
- Changing provider write permissions
- Treating work location as tracked time or availability
- Creating a second persistence path for Agenda

## Validation Contract

### Pure and component tests

- Provider fixtures prove working-location records become day context while an ordinary event named
  `Home` remains an event.
- Agenda scale tests prove only 48, 96, and 144 pixels per hour can be persisted or displayed, and
  legacy fractional values snap deterministically.
- Geometry tests prove adjacent cards expose at least one pixel vertically and concurrent columns
  expose at least two pixels without changing exact bounds.
- Presentation tests prove no lock glyph renders at rest, the accent does not wrap card corners,
  and title/time priority holds at marker, compact, and full densities.
- Date-navigation tests cover previous, next, picker selection, Today, keyboard shortcuts, and
  draft-discard behavior.
- Creation tests cover click defaults, drag bounds, all-day selection, cancellation, exact draft
  updates from form edits, event/time-block switching, save success, save failure, and More details.

### Browser verification

Capture and inspect the populated rail at desktop and in its mobile Sheet, in light and dark themes.
The evidence must include:

- today and a non-today date;
- long, short, adjacent, and overlapping events;
- a work-location context chip plus real all-day events;
- `1×`, `2×`, and `3×` scale;
- a clicked draft and a dragged draft with the responsive dialog open;
- list/timeline switching and a direct date-picker jump;
- zero document-level horizontal overflow and one Agenda scrollport.

Measure rather than infer the acceptance conditions:

- one visible date representation in timeline mode;
- zero resting lock glyphs;
- no fractional Agenda scale label;
- event separation of at least one CSS pixel;
- no event accent pixels wrapping around top-left or bottom-left corners;
- every non-marker event exposes a readable title, and every event is named accessibly;
- click and drag create no server record before Save;
- successful Save replaces exactly one draft with exactly one persisted item.

## Acceptance Criteria

The design is complete when the Agenda rail reads as one continuous daily surface: one date, optional
day context, compact all-day content, and an edge-to-edge time grid. Events remain distinguishable
and readable without persistent permission chrome or decorative corner borders. Scale is intentional
and whole-numbered. Any date is reachable directly. Empty time is actionable through a visible local
draft and a responsive Event/Time block dialog, with no persistence before confirmation.
