# Layered Calendar Architecture Spec

> **Status**: Implemented (V1) — schema, types, services, and web data layer below reflect what
> shipped; corrections from the original draft are called out inline.
> **Area**: API, DB, types, web data layer
> **Last Updated**: 2026-07-05

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
- `provider`: `google`
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
- `provider`: nullable or `docket | google`
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

- `CalendarProvider = 'docket' | 'google'`
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

- `POST /webhooks/calendar/:provider` (only `google` registered; others 404)
  - **Correction from the original draft**: mounted at `/webhooks/calendar/:provider`, outside
    the versioned `/v1` typed-RPC app and outside the OpenAPI spec — not
    `/v1/webhooks/calendar/google` as first drafted. This is a deliberate, approved design
    decision (recorded in the SDD execution plan): a provider push webhook is a public,
    unauthenticated edge validated by provider-specific headers (Google's `X-Goog-Channel-Id` /
    `X-Goog-Channel-Token` / `X-Goog-Resource-Id`), not a session-scoped or API-key-scoped typed
    route, so it does not belong in the versioned client-facing contract. It looks up the layer
    by channel id, validates the headers, no-ops on the `sync` confirmation ping, and otherwise
    calls `syncSingleLayer` (a bounded, single-layer sync) and awaits it before returning 200.

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
  - Google API mapping and write methods (`listLayers`, `pullChanges`, `pushItem`, `deleteItem`,
    `startWatch`/`stopWatch`).

**Corrections from the original draft, now implemented as designed (not just planned):**

- **Credential resolution** lives entirely behind the provider adapter boundary. The sync
  engine and outbox never reconstruct a provider-specific `raw` credential payload themselves —
  every call site (the pull engine, `syncSingleLayer`, the outbox's `attemptCalendarItemWrite`)
  resolves credentials through the same discover-then-resolve seam
  (`createDefaultCalendarSyncModules`/`createGoogleCalendarSyncModule`), so a future
  Google Calendar is the only external calendar adapter in the current provider allowlist.
- **Permission normalization** is a real, adapter-emitted `CalendarItemPermission` (`canEditCore`,
  `canDelete`, `readOnlyReason`) computed once per item and denormalized onto `calendarItem`,
  not re-derived ad hoc by each reader. `calendar-write.ts`'s `problemForReadOnlyReason` is an
  exhaustive switch over every `readOnlyReason` value (no `default` branch — a new reason added
  later without a case is a compile error), mapping each to the correct problem code
  (`InsufficientScopeError` for `provider_scope`, `ConflictError` for `conflict`,
  `CapabilityError` otherwise).

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
