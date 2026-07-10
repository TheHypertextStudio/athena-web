# Calendar Sync And Provider Write-Back Spec

> **Status**: Implemented (V1) — inbound sync, outbound write-back, push hints, and scheduled
> sync are all live for Google; see "Shipped Constants And Behavior" for the concrete numbers
> and rules that landed.
> **Area**: Connectors, calendar providers, sync, OAuth
> **Last Updated**: 2026-07-05

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

- Google sign-in stays identity-only. Calendar settings uses Better Auth's incremental
  `linkSocial` scopes for `calendar.calendarlist.readonly` and `calendar.events`.
- The explicit "Enable calendar editing" action runs the same incremental consent flow and asks
  the user to choose the displayed Google account again.
- `apps/web/src/components/settings/identity-providers.ts` must label read-only Calendar and
  editable Calendar distinctly.

`CalendarConnectionOut.scopeState` remains the server-enforced source of truth after consent. A
canceled or insufficient grant stays read-only and never reaches the provider write pipeline.

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

## Shipped Constants And Behavior

The following are the concrete values and rules implemented in
`apps/api/src/routes/calendar-sync-engine.ts` and `apps/api/src/calendar/calendar-outbox.ts`.

- **Layer lease TTL**: `LEASE_TTL_MS = 5 * 60 * 1000` (5 minutes). A per-layer lease is claimed
  via a conditional `UPDATE ... WHERE sync_lease_expires_at IS NULL OR < now RETURNING id`; an
  already-leased layer is skipped silently (not an error) rather than blocking. The lease is
  released in a `finally`, including on error.
- **Outbox retry backoff**: `BASE_BACKOFF_MS = 60_000` (60s), `CAP_BACKOFF_MS = 3_600_000` (1h),
  `MAX_WRITE_ATTEMPTS = 8`. Backoff is exponential doubling capped at the ceiling:
  `Math.min(BASE_BACKOFF_MS * 2**(attempts-1), CAP_BACKOFF_MS)`. On the attempt that exhausts
  `MAX_WRITE_ATTEMPTS`, the outbox row's `status` converts from `'pending'` to `'failed'` and the
  item's `syncState` converts from `'push_pending'` to `'provider_error'` in the same persist call
  (the `attempts` count is threaded through so it lands correctly on the exhausting attempt, not
  one short).
- **Retry-write re-anchoring rule** (`retryCalendarItemWrite`): when the caller retries a
  conflicted or failed write with local changes, the retry re-anchors to
  `conflict.providerSnapshot.externalEtag` when that snapshot is present (clears the conflict,
  resets the write to `pending`/`attempts: 0`, reattempts in the foreground); when no usable
  snapshot exists, the write is marked `'failed'` with a clear `lastError` and the call throws
  `ConflictError` rather than guessing at a base to re-anchor to.
- **Push/watch config-gate behavior**: watch registration/renewal
  (`registerOrRenewWatches`/`callbackUrlFor`) is gated on the explicit `GOOGLE_CALENDAR_WEBHOOK_URL`
  env var — unset means zero adapter calls and a zero-tally no-op (never a hidden default
  callback URL), and the scheduled sweep still runs the full incremental pull regardless, so
  polling-only environments keep working. Per connection, a reauth failure skips only that
  connection's layers (tallied, not thrown); per selected layer, a watch is (re)registered when
  never registered, expired, or expiring within 30 minutes, and left untouched otherwise. Each
  layer's `startWatch` call and its follow-up column update are wrapped in a per-layer
  `try`/`catch` so one layer's transient failure cannot abort registration for the rest of the
  connection, the rest of the provider, or the caller — failures are tallied into
  `WatchRegistrationTally.errors`, never thrown out of the sweep.
- **Scheduled sweep isolation**: `sweepCalendarSync` wraps each user's full
  pull + outbox drain + watch-registration pass in a per-user `try`/`catch` in addition to every
  step's own internal per-item isolation, so one user's unexpected failure cannot abort the sweep
  for users later in iteration order; it is tallied as `` `${userId}: ${message}` `` and the loop
  continues. Wired as `POST /internal/cron/sync-calendars` (`*/10 * * * *` in
  `scripts/scheduler-setup.ts`) and into the local dev scheduler's tick loop.
- **Outbox drain is per-caller-scoped**: `drainDueCalendarItemWrites` takes a required `userId`
  and filters the due-writes query to that user — `POST /me/calendar/sync` never drains or reports
  on another user's pending writes, matching every other field on `CalendarSyncResultOut`.

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
