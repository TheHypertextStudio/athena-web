# Layered Calendar Architecture Spec

> **Status**: Draft ready for implementation
> **Area**: API, DB, types, web data layer
> **Last Updated**: 2026-07-02

## Current State

Athena already has a user-scoped first-party Google Calendar surface:

- `packages/db/src/schema/calendar.ts`
  - `calendarConnection`
  - `calendarList`
  - `calendarEvent`
- `packages/types/src/calendar.ts` and `packages/types/src/agenda.ts`
- `apps/api/src/routes/me-calendar.ts`
- `apps/api/src/routes/agenda.ts`
- `apps/api/src/routes/google-calendar-sync.ts`
- `apps/web/src/components/settings/google-calendar-settings.tsx`
- `apps/web/src/components/agenda/*`

This current surface is valuable and should be migrated, not discarded. It is read-oriented:
calendar events can surface in the agenda and can create a native task with a `calendar_event`
attachment, but events are not editable and task relationships are not first-class.

## Target Domain Model

### CalendarConnection

Keep and generalize the current table.

Required shape:

- `id`
- `userId`
- `provider`: `google` initially; future `microsoft`, `caldav`, `apple`
- `externalAccountId`
- `accountEmail`
- `accountName`
- `accountPictureUrl`
- `status`: `connected | error | disconnected | reauth_required`
- `scopeState`: JSON or typed columns describing read/write scope availability
- `lastSyncedAt`
- `lastError`
- timestamps

Migration rule: existing `provider='google'` rows remain valid.

### CalendarLayer

New table. One renderable source of time items.

Suggested columns:

- `id`
- `userId`
- `connectionId` nullable for Docket-native layers
- `provider`: nullable or `docket | google | microsoft | caldav`
- `sourceKind`: `provider_calendar | native_blocks | task_timeboxes | availability`
- `externalLayerId`: provider calendar id when applicable
- `title`
- `description`
- `timezone`
- `color`
- `accessRole`
- `primary`
- `selected`
- `visibleByDefault`
- `editableCore`
- `editableAttendees`
- `syncToken`
- `watchChannelId`
- `watchResourceId`
- `watchToken`
- `watchExpiresAt`
- `lastSyncedAt`
- `lastError`
- timestamps

Migration rule: each existing `calendarList` row becomes one `CalendarLayer` with
`sourceKind='provider_calendar'`. A default Docket-native layer is created lazily for each user when
they create their first native block.

### CalendarItem

New table or renamed successor to `calendarEvent`.

Suggested columns:

- `id`
- `userId`
- `layerId`
- `connectionId` nullable for native blocks
- `kind`: `provider_event | native_block | task_timebox | availability_block`
- `provider`: nullable or provider literal
- `externalCalendarId`
- `externalEventId`
- `recurringEventId`
- `recurrenceInstanceKey`
- `status`: `confirmed | tentative | cancelled | busy | free | held | conflicted`
- `title`
- `description`
- `location`
- `htmlLink`
- `startsAt`
- `endsAt`
- `allDayStartDate`
- `allDayEndDate`
- `timezone`
- `organizer`
- `attendees`
- `providerRaw`
- `permissions`: denormalized permission snapshot
- `updatedExternalAt`
- `externalEtag`
- `externalSequence`
- `lastPushedAt`
- `syncState`: `clean | local_dirty | push_pending | conflict | provider_error`
- `conflict`
- `archivedAt`
- timestamps

Migration rule: existing `calendarEvent` rows become `kind='provider_event'` items.

### CalendarItemTaskLink

New table. Org-scoped bridge between user-scoped calendar items and org-scoped tasks.

Suggested columns:

- `calendarItemId`
- `taskId`
- `organizationId`
- `createdBy`
- `role`: `prep | agenda | follow_up | outcome | related`
- `sort`
- `note`
- `itemTitleSnapshot`
- `itemStartsAtSnapshot`
- `itemEndsAtSnapshot`
- timestamps

Constraints and indexes:

- Primary key: `(calendarItemId, taskId)`.
- Index: `(organizationId, taskId)`.
- Index: `(calendarItemId, organizationId)`.
- FK `taskId -> task.id ON DELETE CASCADE`.
- FK `organizationId -> organization.id ON DELETE CASCADE`.
- Calendar item delete should cascade or hard-delete links.

Security rule: every mutation validates both:

- `calendarItem.userId === session.user.id`
- the actor can view/contribute to the org task depending on operation

### CalendarItemWrite

New outbox table for provider-bound writes.

Suggested columns:

- `id`
- `userId`
- `calendarItemId`
- `connectionId`
- `provider`
- `operation`: `create | update | delete`
- `patch`
- `baseExternalEtag`
- `baseUpdatedExternalAt`
- `status`: `pending | applying | applied | failed | conflict`
- `attempts`
- `nextAttemptAt`
- `lastError`
- timestamps

Purpose:

- Preserve local intent while provider writes are retried.
- Avoid doing provider I/O inside the only source of truth for local state.
- Make failed and conflicted writes inspectable.

## Public Types

Add to `@docket/types`:

- `CalendarProvider = 'docket' | 'google' | 'microsoft' | 'caldav'`
- `CalendarLayerSourceKind`
- `CalendarItemKind`
- `CalendarItemStatus`
- `CalendarItemPermission`
- `CalendarLayerOut`
- `CalendarItemOut`
- `CalendarRangeQuery`
- `CalendarItemCreate`
- `CalendarItemUpdate`
- `CalendarItemRemoved`
- `CalendarItemTaskLinkOut`
- `CalendarItemTaskLinkCreate`
- `CalendarSyncResultOut` expanded to layers/items/writes/conflicts

`CalendarItemOut` must include enough information for any calendar view:

- identity and layer identity
- normalized display fields
- time/all-day bounds
- source/provider metadata
- permissions
- sync/conflict state
- linked task summaries visible to the current user

## API Surface

Session-scoped personal routes:

- `GET /v1/me/calendar`
  - Keep as summary/settings aggregate for backwards compatibility.
- `GET /v1/me/calendar/layers`
  - List all layers for the signed-in user.
- `PATCH /v1/me/calendar/layers/:id`
  - Update visibility, title/color for native layers, and provider layer selection flags.
- `GET /v1/me/calendar/items?start=&end=&layerIds=&kinds=`
  - Range read for calendar views.
- `GET /v1/me/calendar/items/:id`
  - Detail read for workspace drawer.
- `POST /v1/me/calendar/items`
  - Create Docket-native block.
- `PATCH /v1/me/calendar/items/:id`
  - Patch core fields.
- `DELETE /v1/me/calendar/items/:id`
  - Delete native item or request provider delete when allowed.
- `POST /v1/me/calendar/items/:id/tasks`
  - Link existing task or create-and-link a task.
- `DELETE /v1/me/calendar/items/:id/tasks/:taskId`
  - Detach task link.
- `POST /v1/me/calendar/sync`
  - Run provider-neutral sync for one or all connections.

Non-RPC external edge:

- `POST /v1/webhooks/calendar/google`
  - Receives Google channel notifications, validates channel token, records an inbound sync hint,
    and returns quickly.

Compatibility route:

- `GET /v1/agenda`
  - Should call the new calendar read service and continue returning `AgendaOut` until the web UI
    fully migrates to `CalendarItemOut`.

## Services

Implement as small units rather than expanding route files:

- `calendar-permissions.ts`
  - Resolves `canView`, `canEditCore`, `canDelete`, `requiresReauth`, and provider reason strings.
- `calendar-read.ts`
  - Range queries, layer filters, task link hydration.
- `calendar-write.ts`
  - Native block writes and external event local patch plus outbox creation.
- `calendar-task-links.ts`
  - Link/create/detach task operations with org authorization.
- `calendar-sync-engine.ts`
  - Provider-neutral sync orchestration and lease handling.
- `calendar-google-adapter.ts`
  - Google API mapping and write methods.

## Data Layer Requirements

Web reads and writes must follow `docs/engineering/specs/data-layer.md`.

Add query keys:

- `queryKeys.calendarLayers()`
- `queryKeys.calendarItems(rangeKey)`
- `queryKeys.calendarItem(itemId)`
- `queryKeys.calendarSettings()`

All calendar UI must use `apiQueryOptions`, `useApiQuery` or `useApiListQuery`, and
`useApiMutation`. Provider writes should optimistically patch visible item caches only when the
client has enough data to represent the next state.

## Migration Strategy

1. Add new tables and types while keeping old table exports available.
2. Backfill `calendarLayer` and `calendarItem` from `calendarList` and `calendarEvent`.
3. Update read services to read the new tables.
4. Keep serializers for `CalendarEventOut` and `AgendaOut` until callers are migrated.
5. Move existing Google sync to the adapter/engine and write into `calendarItem`.
6. Retire old table reads only after web and tests no longer depend on them.

## Security Invariants

- A user can only read calendar connections/layers/items where `userId` matches the session.
- A user can only link a task after org membership and capability checks.
- A calendar range read can include task summaries only after task visibility filtering.
- Webhook payloads never directly mutate calendar items; they enqueue or trigger a sync pass.
- Provider tokens are never returned to the client or stored in docs/logs.

## Open Implementation Defaults

- Treat Google push notifications as hints; scheduled incremental sync remains authoritative.
- For conflicts, store both local intended patch and provider snapshot in `conflict`.
- For recurring events, V1 edits only single materialized instances unless the provider adapter
  explicitly supports series edits.
- Native blocks are Docket-owned and do not require org selection unless linked to tasks.
