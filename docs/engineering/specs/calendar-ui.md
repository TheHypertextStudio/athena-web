# Layered Calendar UI Spec

> **Status**: Implemented (V1) — see "Deferred UI Affordances" for what shipped narrower than
> this spec describes.
> **Area**: Web app, agenda, settings, task detail
> **Last Updated**: 2026-07-05

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

Introduce a fuller calendar view when implementation reaches UI slice.

Required controls:

- day/week mode,
- layer toggle panel,
- today/previous/next navigation,
- inline edit enable/disable toggle,
- create native block action,
- visible sync/reauth/conflict status.

Layout:

- Dense operational interface, not a marketing layout.
- Timeline grid with stable row/hour dimensions.
- Items colored by layer with icons for source/kind.
- Overlapping items should form stable columns or stacks without hiding text.
- All text must fit in cards across mobile and desktop.

### Item Workspace Drawer

The workspace is the primary detail interaction for a calendar item.

Sections:

- Header: title, time, layer, source badge, provider link.
- Core fields: title, time/date/all-day, location, description.
- Sync status: clean, pending write, read-only, failed, conflict, needs reauth.
- Linked tasks: grouped by role.
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

Inline editing includes:

- drag to move timed items,
- resize start/end,
- quick edit popover for title, time, location, description,
- all-day toggle when supported.

Do not show active drag/resize handles for:

- items without `permissions.canEditCore`,
- provider events where the user has only read-only OAuth scope,
- events whose provider access role forbids editing,
- conflict items until resolved,
- recurrence cases the adapter marks unsupported.

Optimistic behavior:

- Native blocks update immediately.
- Provider events patch the visible cache to a pending state, then reconcile.
- If provider write fails, restore or mark failed according to the mutation result.

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
- per-layer error if present.

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
- last sync and error details,
- watch/channel health when implemented,
- explanation-free UI copy; no long in-app implementation notes.

Connected accounts should also distinguish access labels:

- Google Tasks,
- Calendar read,
- Calendar edit,
- Drive,
- Gmail.

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
- Read-only event: show disabled edit controls with provider reason.
- Conflict: show item-level conflict banner and actions.
- Sync in progress: keep stale data on screen and show subtle progress.
- Provider outage: keep cached data visible with last error.

## Accessibility And Interaction

- Every icon-only button needs an accessible label and tooltip where meaning is not obvious.
- Keyboard users can open workspace, move focus through fields, and submit edits.
- Drag/resize must have non-pointer alternatives through edit forms.
- Layer colors cannot be the only signal; include icon/badge/source text.
- Touch targets must remain stable and large enough on mobile.

## Data Layer Rules

- Components do not call `api.v1.*` directly except inside query/mutation definitions.
- Calendar read definitions live in a small data module or near the provider, following existing
  query layer rules.
- List/range reads use `useApiListQuery` to avoid blanking on navigation.
- Mutations use `useApiMutation`, optimistic patching, rollback, and targeted invalidation.

## Acceptance Criteria

- Calendar views can render mixed item kinds without type-specific one-off branches scattered across
  unrelated components.
- Inline edit controls appear only when allowed.
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
- **"Enable calendar editing" re-consent action** renders as a labeled, disabled "coming soon"
  button in Google Calendar settings — there is no backend re-consent endpoint yet (see
  `docs/engineering/specs/calendar-sync.md`'s OAuth section).
- **Week view has no drag/resize.** The day timeline (`calendar-timeline.tsx`) supports real
  pointer-drag move/resize, snapped to 15 minutes; the week grid (`calendar-week-grid.tsx`) is
  deliberately a read-only-by-gesture 7-column stack — every card still opens the item workspace,
  whose inline core-fields form is the non-pointer edit path for both views.
- **Linking an existing task is by pasted task id**, not a search/picker — no task-search/picker
  component exists in the codebase yet. This is a real, validated call (`TaskId.safeParse`), not
  fabricated data.
- **`/calendar` is not wired into the app shell's primary navigation** (`HomeNavKey` in
  `@docket/ui/components`) — it is reachable only by direct URL today.
- **The item workspace's provider-metadata line omits the linked account's email** — showing it
  would need an extra connections fetch the drawer doesn't currently make; layer title, provider,
  and access role are shown instead.
- **The agenda rail is not yet wired to the new `calendar_item` normalizer seam.** `AgendaEntry`
  gained an additive `'calendar_item'` source and a `calendar-item-card.tsx`-matching render
  branch, but `AgendaProvider` still sources only from the Hub `today`/`agenda` reads
  (`agendaDef`/`planDef`), not `calendarItemsDef` — the seam is prepared and renders correctly
  when exercised, but nothing in the live agenda rail's data source calls into it yet. The Today
  page's "next up" reads `Hub.today.calendar` directly and is unaffected either way.
