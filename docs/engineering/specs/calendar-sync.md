# Calendar Sync And Provider Write-Back Spec

> **Status**: Draft ready for implementation
> **Area**: Connectors, calendar providers, sync, OAuth
> **Last Updated**: 2026-07-02

## Goal

Calendar sync must support both inbound provider changes and outbound Docket edits while preserving
local intent, provider constraints, and user trust. Sync should be provider-neutral, with Google
Calendar as the first adapter.

## Existing Repo Facts

- Google accounts are linked through Better Auth.
- The current Google OAuth scope includes `calendar.readonly`, not an editable calendar scope.
- Current Google Calendar sync polls calendar lists and events over a fixed time window.
- Google events are cached in a user-scoped table and shown in agenda views.
- Google Tasks already has two-way sync concepts: external updated timestamp, etag, write-back
  adapter, and reconciliation logic.

## Provider Adapter Contract

Create a calendar-specific adapter interface. Do not overload the task `WritableConnector` API.

Required methods:

```ts
interface CalendarProviderAdapter {
  listLayers(input: CalendarProviderInput): Promise<ProviderCalendarLayer[]>;
  pullChanges(input: CalendarPullInput): Promise<CalendarPullResult>;
  pushItem(input: CalendarPushInput): Promise<CalendarPushResult>;
  deleteItem(input: CalendarDeleteInput): Promise<CalendarDeleteResult>;
  startWatch?(input: CalendarWatchInput): Promise<CalendarWatchResult>;
  stopWatch?(input: CalendarStopWatchInput): Promise<void>;
}
```

Adapter responsibilities:

- Convert provider calendars to `CalendarLayer`.
- Convert provider events to `CalendarItem`.
- Preserve provider identity, etag, update timestamp, recurrence identity, permissions, and deep
  link.
- Map provider errors into Docket problem codes.
- Decide whether a write is supported for the current provider, layer, and event.

## OAuth And Scope Upgrade

Google Calendar editing is not available with the current `calendar.readonly` scope.

Required behavior:

- Existing users with read-only grants keep read/sync functionality.
- UI surfaces show `Read-only grant` and a re-consent action before enabling external event edits.
- The server checks stored scopes before attempting provider writes.
- Calendar write-back should request a least-privilege editable scope such as a Google Calendar
  events scope rather than over-broad account access.
- Failed scope checks return a structured problem code, not a generic provider failure.

Implementation notes:

- Update `packages/auth/src/auth-builder.ts` only when the product is ready to ask every new Google
  linker for the write scope.
- If incremental re-consent is supported in the current auth flow, prefer an explicit "Enable
  calendar editing" action on Google Calendar settings.
- `apps/web/src/components/settings/identity-providers.ts` must label read-only Calendar and
  editable Calendar distinctly.

## Inbound Sync

### Full Sync

Full sync runs when:

- a connection is first discovered,
- no sync token exists,
- a sync token is invalid,
- the user manually requests reset/resync,
- the provider adapter requires a baseline refresh.

Google full sync:

- List all calendars from `/users/me/calendarList`.
- Upsert selected calendars as layers.
- Pull events for the supported window.
- Store provider etag/update timestamp.
- Store provider access roles and event edit permissions.

### Incremental Sync

Incremental sync runs when:

- scheduled sweep finds a due calendar connection/layer,
- a provider push notification hints that a resource changed,
- the user presses Sync.

Google incremental sync:

- Use per-calendar `syncToken` after a baseline sync.
- On token invalidation, clear the layer token and perform a full sync for that layer.
- Treat cancelled events as tombstones and archive local items.
- Do not treat absence from a page as deletion unless the provider explicitly sends a deletion or
  tombstone.

### Push Notifications

Google watch channels:

- Register watches per selected external calendar.
- Store channel id, resource id, token, and expiration on the layer.
- Renew before expiration during scheduled sync.
- Validate inbound channel token and resource id.
- Treat notification as a sync hint; do not trust it as the data payload.
- Return quickly from the webhook route.

## Outbound Writes

External item edits should be local-first but provider-honest.

Write flow:

1. Validate session user owns the calendar item.
2. Resolve item permissions.
3. If native block, update Docket state directly.
4. If provider event, patch local item into `push_pending` state and create `CalendarItemWrite`.
5. Attempt provider write immediately for foreground mutations when possible.
6. Store provider response anchors on success.
7. Reconcile visible caches through invalidation.
8. On provider conflict, mark item `conflict` and preserve local intended patch.
9. On retryable failure, leave outbox row pending with backoff.
10. On permanent failure, mark row failed and item provider-error.

Core editable fields:

- `title`
- `startsAt`
- `endsAt`
- `allDayStartDate`
- `allDayEndDate`
- `timezone`
- `location`
- `description`

V1 excluded fields:

- attendees,
- recurrence rule edits,
- conferencing,
- reminders,
- provider notification-send policy.

## Conflict Policy

Conflict inputs:

- local intended patch,
- local base etag/update timestamp,
- current provider etag/update timestamp,
- current provider item snapshot.

Rules:

- If provider etag/update timestamp still matches the base, push can proceed.
- If provider changed after the base and local changed too, mark conflict.
- Docket must not silently overwrite remote provider changes.
- Conflict state should be visible in item workspace and settings/sync health.
- A later conflict resolution UI can choose provider version, local version, or field merge.

V1 may ship with a simple "Open in provider" and "Retry with local changes" action if full field
merge is not implemented.

## Leases And Reliability

Calendar sync should copy the connector sync engine's reliability model:

- per-connection or per-layer lease,
- durable sync run/outcome row or equivalent audit trail,
- no overlapping syncs for the same layer,
- recover stale leases after a timeout,
- persist manual and scheduled sync failures,
- notify or surface reauth-required state when credentials fail.

Outbox writes need:

- bounded retry count,
- exponential or fixed backoff,
- provider error classification,
- no infinite tight retry loops.

## Native Blocks

Native Docket blocks bypass provider sync:

- writes update `CalendarItem` directly,
- no outbox row is created,
- conflict state is not used,
- deleted native blocks are archived or hard-deleted according to product retention policy.

## Future Outlook Adapter

The adapter boundary must allow Microsoft Graph support without schema rewrites.

Expected mapping:

- Graph calendars map to `CalendarLayer`.
- Graph events map to `CalendarItem`.
- Delta links map to layer sync cursors.
- Graph change notifications map to sync hints.
- Graph event PATCH maps to `pushItem`.
- Graph etag/changeKey values map to external concurrency anchors.

## Provider Source References

- Google Calendar sync guide: <https://developers.google.com/workspace/calendar/api/guides/sync>
- Google push notifications: <https://developers.google.com/workspace/calendar/api/guides/push>
- Google Calendar authorization scopes: <https://developers.google.com/workspace/calendar/api/auth>
- Google Events update endpoint: <https://developers.google.com/workspace/calendar/api/v3/reference/events/update>
- Microsoft Graph event delta: <https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0>
- Microsoft Graph event update: <https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0>

## Acceptance Criteria

- Read-only Google accounts still sync and render after migration.
- Editable Google accounts can push core field edits to Google.
- Scope-limited accounts return an actionable write-scope-required response.
- Invalid Google sync tokens trigger full resync for only the affected layer.
- Push notifications trigger sync but do not directly mutate stored items.
- Provider conflicts are represented in durable state and surfaced to the UI.
- Native blocks do not depend on provider sync.
- Scheduled sync cannot double-run the same layer concurrently.
