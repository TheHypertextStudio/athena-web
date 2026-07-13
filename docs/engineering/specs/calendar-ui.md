# Layered Calendar UI Spec

> **Status**: Implemented — fluid scheduling canvas
> **Area**: Web app, agenda, settings, task detail
> **Last Updated**: 2026-07-13

## Goal

Calendar UI should make layered time understandable and editable without flattening everything into
one type of event. External provider events, Docket-native blocks, and task timeboxes share the same
calendar views but retain their source identity and permissions.

## Primary Surfaces

### Agenda Rail

The current portable agenda rail remains the lightweight daily companion.

Changes:

- Render `CalendarItemOut` or an adapter from it instead of Google-specific event entries.
- Show external events, native blocks, and task timeboxes in one chronological list/timeline.
- Preserve current day navigation and view switching.
- Add layer visibility awareness when the global layer state exists.
- Read-only items open the item workspace rather than navigating directly to the provider by
  default. Provider deep link remains available in actions.

### Full Calendar View

The full calendar is a host around the shared scheduling canvas, not a separate day/week widget.
The host owns data, permissions, persistence, date-window expansion, and display copy. The canvas
owns only geometry and pointer interpretation.

Required controls:

- date and people/resource axes,
- layer toggle panel,
- today/previous/next viewport navigation,
- continuous 24–240 pixels-per-hour zoom with Overview (24), Standard (72), and Detail (144)
  shortcuts over the same scalar,
- event/timebox creation defaults,
- visible sync/reauth/conflict status.

Layout:

- Dense operational interface, not a marketing layout.
- A bounded two-axis scroll viewport with a sticky date/resource and all-day header above the
  24-hour grid. Zoom preserves the wall time at the viewport center after accounting for the
  header, so changing scale does not jump to another part of the day.
- One continuous pixels-per-hour scalar. Labels and snap intervals adapt independently to remain
  readable and useful, with snap precision tightening from 60 minutes to a maximum five-minute
  resolution as scale increases.
- Equal-width arbitrary lanes. The count visible at once derives from container width and a saved
  minimum lane width; overflow scrolls horizontally.
- A rolling query window with one measured viewport of overscan in each direction. Reaching a
  boundary shifts the host window without introducing named or fixed-count view modes.
- Items colored by layer with icons for source/kind.
- Concurrent timed items form deterministic side-by-side columns within their lane. Minimum
  interactive height participates in collision detection, so short items do not paint over or
  fully hide one another at low zoom.
- All text must fit in cards across mobile and desktop.

Time-axis rules:

- Labels, snap lines, item geometry, selection, previews, current-time position, and persistence
  use the viewer's selected IANA timezone. A person or resource timezone is header metadata only.
- Calendar and Agenda refresh their current-time instant every 30 seconds, including across a local
  midnight boundary; the line is not frozen at mount time.
- Major labels are the smallest supported interval that remains readable at the active scale;
  minor lines use the active snap interval.
- Existing exact instants render through daylight-saving transitions. Skipped and repeated wall
  times are marked, and exact repeated-hour labels on cards, announcements, and shared details add
  the short zone name (for example, PDT or PST) when needed to distinguish the instant. A newly
  selected, moved, or resized edge in a gap or fold is rejected rather than silently coerced to
  another instant; create and drawer `datetime-local` edits reject the same ambiguous wall times.

### Canvas Interaction Contract

- Pointer selection emits a snapped region; it never persists an object itself. The host opens the
  create flow as the saved `event` or `timebox` default while preserving an explicit choice before
  persistence.
- The initiating pointer owns region selection through pointer capture and a live snapped preview.
  Events from other pointer ids are ignored. Escape, pointer cancel, lost capture, or unmount clears
  the preview and listeners without emitting a creation request.
- Dragging an editable timed card moves it after a four-pixel activation threshold. Visible start
  and end grips resize one edge at a time. Pointer capture, live preview, bounded edge autoscroll,
  and Escape/pointer-cancel restoration apply to all three gestures.
- Move and resize emit proposed bounds and target lane; the host rechecks item, source-lane,
  target-lane, provider, conflict, and source-model policy before mutating.
- Tasks and calendar items use one closed drag payload. Timeboxes interpret drops as `contained`;
  calendar events interpret drops as `related`. Derived targets and self-drops are rejected.
- All-day and multi-day items remain openable and relationship-capable, but do not expose timed
  move/resize or issue timed inline writes.
- Every pointer operation has a form-based alternative through quick create or the item drawer.
- Empty, loading, stale, and failure notices are overlays. They must never replace or unmount the
  lane and hour grid.

### People Comparison

- The workspace and member selection determine an arbitrary lane set; the canvas does not impose a
  maximum or special two-person layout.
- Date lanes and people/resource lanes use the same fluid component. Neither axis introduces a
  named day/week mode or fixed visible count.
- Comparison reads include only personal layers explicitly shared into the selected workspace.
- `busy` items are a separate structural response variant with time bounds only. The web client
  must not receive hidden titles, item ids, layer ids, or provider metadata and then attempt to hide
  them cosmetically.
- `details` items open an immutable sheet sourced only from the already-authorized comparison
  response. Opening one must never request the owner-only `/v1/me/calendar/items/:id` endpoint.
- `busy` items render as opaque, non-openable static blocks rather than disabled or inert buttons.
  Workspace changes immediately clear the prior member list, lanes, selection, and open shared
  details before the next workspace resolves or its actor ids can seed a comparison request.

### Item Workspace Drawer

The workspace is the primary detail interaction for a calendar item.

Sections:

- Header: title, time, layer, source badge, provider link.
- Core fields: title, time/date/all-day, location, description.
- Sync status: clean, pending write, read-only, failed, conflict, needs reauth.
- Linked tasks: grouped by role.
- Contained and related calendar items.
- Task actions: create task, link existing task, detach, open task.
- Provider metadata: account, calendar/layer, organizer, attendees summary.

The task section starts as a linked-task stack but must be built inside the workspace shell so it can
grow into richer collaboration later.

## Item Kinds And Presentation

### Provider Event

Visuals:

- Calendar/provider icon.
- Layer color strip or tint.
- Account/calendar label in compact metadata.
- Edit affordances only when `permissions.canEditCore`.

Actions:

- Open workspace.
- Open in provider.
- Edit core fields when allowed.
- Link/create tasks.
- Retry or review conflict when applicable.

### Native Block

Visuals:

- Docket icon or block-kind icon.
- Native layer color.
- Distinct tone for focus, travel, do-not-schedule, tentative hold, planning.

Actions:

- Edit all fields.
- Delete block.
- Link/create tasks.

### Task Timebox

Visuals:

- Task/check icon.
- Org chip.
- Existing task done status when present.

Actions:

- Open task detail.
- Edit/clear timebox through daily-plan mutation path until task timeboxes are fully folded into
  calendar items.
- Remove from plan.

## Inline Editing

Inline timed editing includes body drag to move, a dedicated keyboard/pointer move affordance, and
direct start/end resize grips. The item drawer owns field editing and remains the non-pointer
alternative.

Do not show active drag/resize handles for:

- items without `permissions.canEditCore`,
- provider events where the user has only read-only OAuth scope,
- events whose provider access role forbids editing,
- conflict items until resolved,
- derived task timeboxes and availability blocks whose source model does not accept calendar-item
  bound writes,
- all-day or multi-day items,
- recurrence cases the adapter marks unsupported.

Optimistic behavior:

- Native blocks update immediately.
- Provider events patch the visible cache to a pending state, then reconcile.
- Overlapping optimistic writes serialize before taking cache snapshots.
- If an inline write fails, restore every affected cache and show the fixed application-owned copy
  `Could not update this item. Your previous time has been restored.` Exception, provider, and
  Problem `title`/`detail` text never become UI copy.

## Layer Controls

Layer controls should appear in calendar and settings contexts.

Controls:

- checkbox/toggle for visibility,
- swatch/color,
- title,
- provider/account label,
- editability badge,
- sync health indicator,
- last sync time,
- a fixed `Calendar sync issue` indicator when an error is present.

Stored `lastError` diagnostics are observability data, not UI copy. Their contents must never be
interpolated into labels, tooltips, alerts, or descriptions.

Layer states:

- visible,
- hidden,
- read-only,
- editable,
- needs reauth,
- sync error,
- watch expiring/expired.

## Settings UI

Expand the existing nested Google Calendar page.

Required sections:

- account cards grouped by Google identity,
- calendars/layers under each account,
- selected/visible toggles,
- write-scope status,
- "Enable calendar editing" re-consent action when needed,
- sync now,
- last sync time and fixed sync-health status,
- watch/channel health when implemented,
- explanation-free UI copy; no long in-app implementation notes.

Connected accounts should also distinguish access labels:

- Google Tasks,
- Calendar read,
- Calendar edit,
- Drive,
- Gmail.

Personal calendar behavior settings additionally own:

- default region-creation intent (`event` or `timebox`),
- default event destination layer,
- continuous pixels-per-hour value,
- minimum lane width,
- per-workspace layer sharing (`details` or `busy`), disabled until explicitly configured.

## Task Detail UI

Task detail should move beyond generic attachment cards for calendar relationships.

Add a calendar context section:

- linked calendar items,
- item role,
- time bounds,
- layer/account label,
- open item workspace,
- detach link when allowed.

Keep existing `calendar_event` attachments working during migration. New feature work should prefer
`CalendarItemTaskLink`.

## Empty, Error, And Edge States

- No provider accounts: show native block creation and connected-account path.
- No visible layers: show layer panel with all layers hidden, not a blank error.
- Reauth required: show account/layer warning and re-consent action.
- Read-only event: keep it openable and linkable, show an explicit `Read-only` indicator, and omit
  move/resize controls.
- Conflict: show item-level conflict banner and actions.
- Sync in progress: keep stale data on screen and show subtle progress.
- Provider outage: keep cached data visible with an application-owned status.
- Agenda/calendar read failure: keep the scheduling grid and locally available items mounted and
  show `Calendar updates are temporarily unavailable. Showing what we have.` as an overlay. Never
  surface server exception, provider, or Problem text as user copy.

## Accessibility And Interaction

- Every icon-only button needs an accessible label and tooltip where meaning is not obvious.
- Keyboard users can open the workspace and use arrow keys on the move and start/end resize
  controls. Vertical adjustments use the active snap; horizontal arrows move between eligible
  lanes only.
- Pointer movement below the activation threshold remains a click. Active gestures announce the
  item, lane, and proposed time through a stable live region and cancel cleanly with Escape.
- Relationship dragging uses a dedicated native-drag affordance so it cannot compete with timed
  move/resize gestures.
- Drag/resize also has a non-pointer alternative through the item drawer.
- Layer colors cannot be the only signal; include icon/badge/source text.
- Touch targets must remain stable and large enough on mobile.

## Data Layer Rules

- Components do not call `api.v1.*` directly except inside query/mutation definitions.
- Calendar read definitions live in a small data module or near the provider, following existing
  query layer rules.
- List/range reads normally use `useApiListQuery` to avoid blanking on navigation. People-member
  and comparison reads use `useApiQuery` instead: retaining workspace A data while workspace B
  loads would cross a privacy boundary and could send A's actor ids into B's request.
- Mutations use `useApiMutation`, optimistic patching, and rollback. Create and update/move
  mutations invalidate the complete `['me', 'calendar-items']` query family because an item can
  appear in a destination range that did not previously cache it.

## Acceptance Criteria

- Calendar views can render mixed item kinds without type-specific one-off branches scattered across
  unrelated components.
- Inline edit controls appear only when allowed.
- The visible date count and people/resource lane set remain viewport- and consumer-derived; no
  day/week mode or fixed lane count exists in the shared component.
- Zoom accepts every integer from 24 through 240 pixels per hour; 24, 72, and 144 are shortcuts,
  not separate rendering modes.
- Labels, snap, previews, and writes use one viewer-timezone path, and invalid DST gap/fold wall
  times do not mutate data. Existing exact fold instants remain intact and render with a
  disambiguating short zone name.
- Calendar and Agenda keep the current-time line live rather than freezing the mount-time instant.
- Simultaneous items remain individually visible in stable side-by-side columns.
- Editable timed items support pointer and keyboard move plus start/end resize, while all-day,
  multi-day, derived, conflicted, and permission-denied items do not issue timed writes.
- Read and mutation failures show only fixed application-owned copy while leaving the grid mounted.
- The item workspace can show multiple linked tasks and create another one.
- Read-only events remain useful and linkable.
- Layer toggles update the visible calendar without layout jumps.
- Settings shows per-account/layer write-readiness clearly.

## Deferred UI Affordances

The following were explicitly scoped out of this pass, not silently dropped — each is a known,
tracked follow-up rather than a gap in the acceptance criteria above:

- **Task-detail calendar context** (the "Task Detail UI" section above) is not built. No backend
  read exists for "calendar items linked to task X" — only the inverse (item → tasks). Task
  detail's `TaskAttachments.tsx` is unchanged; building this honestly requires a new backend read
  first (see `docs/engineering/specs/calendar-architecture.md`).
- **Linking an existing task is by pasted task id**, not a search/picker — no task-search/picker
  component exists in the codebase yet. This remains a validated drawer action; task rows can also
  be dragged directly onto canvas targets.
- **The item workspace's provider-metadata line omits the linked account's email** — showing it
  would need an extra connections fetch the drawer doesn't currently make; layer title, provider,
  and access role are shown instead.
