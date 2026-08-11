# Agenda Quick-Create Dialog Refinement

> **Status**: Approved visual direction; written contract pending review
> **Date**: 2026-08-10
> **Area**: Agenda rail, calendar quick create, timezone-aware scheduling
> **Refines**: `2026-08-10-agenda-rail-structural-redesign-design.md`

## Objective

Keep direct creation fast without hiding the schedule it acts on. The quick-create surface remains
a real dialog, but it no longer opens over the Agenda calendar. It uses Google Calendar's strongest
interaction pattern—summary first, inline date/time expansion, and a focused timezone child
dialog—without copying Google's visual skin or adding unrelated conferencing and guest features.

The refinement also restores explicit Agenda zoom controls and makes timezone selection complete:
people can search by abbreviation, common timezone name, canonical IANA identifier, or associated
city, and can optionally assign different start and end zones.

## Accepted Requirements

- Quick create remains a dialog with focus management, Escape behavior, and an explicit close
  action.
- On desktop, the dialog is a shell-level sibling of the Agenda and defaults into the primary-page
  side of the rail. It may float over primary page content but never over the Agenda calendar.
- A top drag handle moves the dialog within the permitted primary-content rectangle. The Agenda
  boundary is a hard collision edge.
- The overview dialog does not expose a permanent timezone field.
- Date and time are separate controls when the schedule row is expanded.
- Timezone selection opens a focused child dialog with search and optional separate start/end
  zones.
- Missing required information is indicated by the field itself. Save remains disabled until the
  draft is valid; no visible validation or save-failure sentence appears inside the quick dialog.
- Agenda zoom returns as visible decrement, whole-step readout, and increment controls.

## Approaches Considered

### Shell-level draggable dialog with a calendar exclusion boundary — selected

Mount the dialog in the App Shell overlay layer as a sibling of the primary page and Agenda rail.
Measure the primary-content rectangle and constrain dialog placement and dragging to it. This keeps
dialog semantics and Google Calendar-like movement while guaranteeing the rail remains readable.

### Docked inspector pane

A third layout column would guarantee no overlap, but it would make quick create feel like a
persistent editor, narrow the primary page, and violate the requirement that the surface remain a
dialog.

### Unconstrained floating dialog

A conventional draggable overlay is mechanically simpler, but it could be moved back over events
and would only fix the initial position rather than the overlap problem itself.

## Interaction Model

### 1. Draft selection and dialog placement

Click, drag, keyboard, and all-day selection continue creating one local draft with no write. On
desktop, the shell-level dialog opens in the primary-content area immediately beside the Agenda.
Its initial vertical position follows the selected region where practical, then clamps to the
viewport. Its initial horizontal position hugs the Agenda boundary without crossing it.

The dialog's top grip is its only drag initiation surface. Dragging:

- uses pointer capture so leaving the handle does not abandon the gesture;
- clamps the complete dialog rectangle within the primary-content rectangle;
- never crosses the measured Agenda boundary;
- does not resize or reorder shell columns;
- does not persist position across browser sessions; each new draft starts from the useful default;
- supports a keyboard equivalent from the focused handle using arrow keys, with larger movement
  when Shift is held.

The dialog and Agenda are siblings in the shell composition, not a dialog nested inside the Agenda
scrollport. Scrolling the Agenda therefore cannot move, clip, or reposition the editor.

### 2. Overview state

The default quick dialog is an overview rather than a complete form. In order, it contains:

1. draggable handle and close action;
2. title field;
3. `Event` / `Timebox` intent choice;
4. one activatable schedule summary, such as
   `Monday, August 10 · 10:00–11:00 AM`;
5. quiet schedule metadata, such as `Pacific Time · Does not repeat`;
6. compact optional rows for location and description;
7. destination calendar and availability metadata;
8. `More options`, `Cancel`, and `Save` actions.

Timezone is not a standalone overview field. The schedule metadata uses a familiar timezone name,
not a raw IANA identifier. When start and end zones differ, it names the route compactly, such as
`Los Angeles → New York`, so the exceptional state is visible.

### 3. Inline date/time expansion

Activating the schedule summary expands it in place. Timed drafts expose:

```text
[ Monday, August 10 ] [ 10:00 AM ] – [ 11:00 AM ]
[ ] All day                Time zone
[ Does not repeat ▾ ]
```

- Date and time are separate controls, not native `datetime-local` fields.
- A same-day event uses one date control. Moving the end before the start advances the end date only
  through an explicit date choice; values are not silently wrapped.
- Multi-day timed events reveal a separate end-date control.
- `All day` converts the draft to inclusive start/exclusive end calendar dates and hides timezone
  because an all-day item has no wall-clock zone.
- `Time zone` opens the child dialog.
- Activating the collapsed summary again may collapse the controls without losing edits.

The compact dialog exposes recurrence choice because it is part of the schedule summary, but only
the existing supported recurrence contract may be offered. Unsupported recurrence authoring stays
in `More options`; the refinement must not add a visual choice that cannot persist.

### 4. Timezone child dialog

`Time zone` opens a focused child dialog above the quick-create dialog. The parent remains visible
under the overlay but is inert until the child closes. The child contains:

- `Use separate start and end time zones` checkbox;
- searchable start-zone combobox;
- end-zone combobox, disabled until separate zones are enabled;
- `Use current time zone`, `Cancel`, and `OK` actions.

Search is local and supports case-insensitive matches across:

- current and known standard/daylight abbreviations (`PDT`, `PST`, `EDT`);
- common names (`Pacific Time`, `Eastern Time`);
- canonical IANA identifiers (`America/Los_Angeles`);
- exemplar and associated cities (`Los Angeles`, `Vancouver`).

Results show enough disambiguation to make short codes safe:

```text
Los Angeles
America/Los_Angeles · Pacific Time        PDT · UTC−7
```

Exact canonical identifiers rank first, then exact city/name/code matches, then prefix and substring
matches. Ambiguous codes show every matching zone instead of guessing. UTC offset and abbreviation
are computed for the draft date so daylight-saving labels are accurate.

Applying a timezone preserves the entered wall date and clock values and resolves them in the new
zone; the selected exact instants and draft projection update accordingly. `Use current time zone`
sets both zones to the Agenda display zone. Cancel leaves the parent draft unchanged. Escape closes
only the child dialog first.

## Timezone Data and Persistence

Timezone search uses an application-owned, versioned index derived from IANA/CLDR data. Each entry
contains a canonical IANA id, exemplar city, common names, and known abbreviations. Runtime `Intl`
formatting supplies the date-specific abbreviation and UTC offset. Search requires no network call
and never sends a partially entered query to a provider.

The current model stores one `timezone`. That is sufficient only when both boundaries share a
zone. The persisted contract becomes:

- `timezone`: start timezone and the single timezone for ordinary events;
- `endTimezone`: optional end timezone; `null` means use `timezone`.

This requires one nullable database column, DTO/create/update schema support, serializers, and
provider mapping. Google writes use `timezone` for `start.timeZone` and
`endTimezone ?? timezone` for `end.timeZone`; provider reads preserve the same distinction.
Docket-owned items retain exact UTC instants plus both zone choices so reopening the editor can
reconstruct the original wall values.

Existing items remain valid with `endTimezone = null`. Existing clients that send only `timezone`
continue creating single-zone events.

## Dialog Ownership and Component Boundaries

- **Agenda selection controller** owns the local selected region and draft projection.
- **Shell overlay host** publishes the primary-content and Agenda rectangles and mounts the
  quick-create dialog as their sibling.
- **Dialog position controller** owns default placement, clamped pointer/keyboard dragging, resize
  observation, and focus restoration. It knows geometry, not calendar fields.
- **Quick-create overview** owns intent, title, collapsed/expanded schedule presentation, optional
  fields, destination, validation state, and save orchestration.
- **Date/time editor** owns separate date and clock values, all-day conversion, recurrence exposure,
  and DST-aware resolution.
- **Timezone picker** owns indexed search, ranking, separate-zone choice, and an apply/cancel result.
  It does not mutate the calendar item directly.
- **Calendar write contract** persists exact bounds plus start/end timezone metadata and maps them
  to provider payloads.
- **Agenda scale control** consumes the existing `1×`, `2×`, and `3×` scale model and exposes
  decrement/readout/increment directly in the rail header.

## Validation and Failure Behavior

The dialog contains no visible validation sentences or explicit save-failure message.

- Required fields use a restrained invalid visual state and `aria-invalid`.
- Save is disabled while title, date/time, destination, or DST occurrence choice is incomplete or
  invalid.
- The first invalid field receives focus when an attempted keyboard submission cannot proceed.
- Assistive technology receives concise field state through accessible names/descriptions without
  adding visible recovery prose.
- A persistence failure retains the draft and re-enables Save. The existing app-level notification
  surface reports the application-owned failure outside the dialog; provider exception text is
  never rendered.
- Closing an untouched dialog discards immediately. Closing or navigating with an edited draft uses
  the existing discard confirmation.

## Responsive Behavior

On desktop layouts where the Agenda is a visible rail, the dialog is draggable within primary
content and cannot cover the rail. When there is insufficient side-by-side primary-content room,
the quick-create dialog becomes a full-height sibling view within the Agenda Sheet rather than a
card stacked over the time grid. The calendar view stands down while the dialog is active, so the
same no-covering invariant holds. The mobile surface retains `role="dialog"`, focus containment,
Escape/back behavior, and the same progressive disclosure fields; free dragging is disabled.

The timezone child dialog becomes a full-width nested dialog on narrow screens. Closing it returns
focus to the `Time zone` control in the parent.

## Zoom Restoration

The Agenda header exposes:

```text
−   2×   +
```

- decrement and increment step only through `1×`, `2×`, and `3×`;
- controls disable at their limits;
- the readout opens the existing display menu for direct scale and timeline/list selection;
- changing scale keeps the current wall time anchored and preserves any open draft;
- no fractional value is persisted or displayed.

## Accessibility

- The quick-create surface has an accessible dialog name and initial focus enters the title.
- The drag handle is named `Move create-event dialog`, exposes its keyboard movement, and never
  becomes the only way to access content.
- The schedule summary is a button announcing the complete date, time range, timezone, recurrence,
  and expanded state.
- Date, start time, end time, all-day, recurrence, and timezone controls each have distinct labels.
- Timezone search uses combobox/listbox semantics with result count and active option announcement.
- The timezone child dialog traps focus independently and restores it to the invoking control.
- Cancel/close restores focus to the selected calendar region; Save moves focus to the persisted
  event.

## Scope

### Included

- Shell-level draggable desktop quick-create dialog with a hard Agenda exclusion boundary
- Mobile sibling-dialog transition that does not cover the Agenda grid
- Overview schedule summary and inline date/time expansion
- Separate date and time controls
- Searchable timezone child dialog
- Optional separate start/end timezones through local, API, database, and provider contracts
- Highlight-only validation and disabled Save
- App-level save failure notification with draft retention
- Visible whole-step Agenda zoom controls
- Focused unit, component, API, provider, accessibility, and live-browser coverage

### Excluded

- Guests, conferencing, attachments, reminders, visibility, or availability redesign
- Freeform dialog movement over the Agenda or sidebar
- Persisting dialog coordinates across sessions
- Changing the full Calendar's overall layout or event-card styling
- A second calendar persistence path
- Remote timezone autocomplete

## Validation Contract

### Pure and component tests

- Position geometry clamps every dialog edge inside primary content and never crosses the Agenda
  boundary after open, drag, viewport resize, rail collapse/expand, or zoom.
- Pointer capture and keyboard movement update position; dragging from any non-handle field does not.
- Overview renders one schedule summary and no timezone field; activating it exposes separate date
  and time controls plus the timezone action.
- All-day conversion hides timezone and produces inclusive/exclusive date bounds.
- Timezone search matches representative codes, common names, canonical identifiers, and cities;
  ambiguous abbreviations return multiple ranked results.
- Date-specific offset/abbreviation labels cover daylight-saving transitions.
- Applying a zone preserves wall values and updates exact instants; Cancel preserves the parent
  draft; separate end-zone mode resolves each boundary in its selected zone.
- Save is disabled and only the relevant fields are highlighted while required data is missing or
  invalid. No visible validation/failure paragraph renders in the dialog.
- Failed persistence retains values and sends one application-owned notification outside the
  dialog.
- Zoom controls expose only `1×`, `2×`, and `3×`, disable at bounds, and preserve viewport/draft
  anchoring.
- DTO, database, serializer, native write, and Google adapter tests preserve `endTimezone` while
  remaining backward compatible with single-zone items.

### Live browser verification

At desktop and mobile widths, in light and dark themes:

- create click, drag, keyboard, and all-day drafts;
- open the overview, expand schedule controls, search timezone by `PST`, `Pacific Time`,
  `America/Los_Angeles`, and `Los Angeles`;
- apply one zone and separate start/end zones across a daylight-saving boundary;
- drag the desktop dialog against every primary-content edge and prove it never intersects the
  Agenda rectangle;
- resize and collapse/expand shell rails while the dialog is open;
- prove no create request occurs before enabled Save and exactly one occurs after Save;
- force a failed write and prove the draft remains, the dialog contains no failure prose, and the
  app notification appears outside it;
- exercise `− / 1×–3× / +` and prove no fractional label or calendar-covering dialog state;
- verify focus entry, nested-dialog Escape order, cancel restoration, and keyboard dialog movement;
- capture desktop/mobile light/dark overview, expanded schedule, timezone search, separate-zone,
  missing-field, and saved states.

## Acceptance Criteria

The refinement is complete when direct creation remains a fast dialog workflow without obscuring
the Agenda calendar. The overview communicates the schedule in one readable row, date and time
expand only when edited, timezone configuration is discoverable but not intrusive, and search works
for the ways people actually name zones. Required information is communicated through field state
and Save availability rather than visible error prose. Separate start/end zones round-trip through
storage and providers, and visible Agenda zoom remains whole-stepped and immediately reachable.
