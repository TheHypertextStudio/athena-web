# Device notification sync

> **Reader**: an engineer changing how the server stores what a person's phone syncs, or building
> the Athena tools that read it. After reading, you should know where each rule lives, what every
> upload answer means, how deletions and expiry travel, and which decisions were made on purpose.
> **Status**: server half shipped 2026-09-23 (`DEVICE-NOTIFICATIONS-001`). The Android client's
> copy of the contract is `docs/reference/notification-sync.md` in docket-android.

The Android app indexes the notifications a person receives so Athena can use them as context.
Sync copies what the phone indexed to Docket's servers, so Athena can read it from anywhere (the
next milestone) and so a notification can wake Athena (the one after). The phone is the only
writer: the server keeps a mirror of what each device uploads, plus the deletions the person makes.
It is context for Athena, not a notification history product.

## Ownership

| Concern                           | Module                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Wire contract and limits          | `domains/athena/src/contracts/device-notification.ts` (`./device-notification-contract`) |
| Tables                            | `packages/db/src/schema/device-notification.ts` (migration 0143)                         |
| Register, list, delete, deletions | `apps/api/src/services/device-notifications/store.ts`                                    |
| Upload batches                    | `apps/api/src/services/device-notifications/ingest.ts`                                   |
| Upload rate limit                 | `apps/api/src/services/device-notifications/upload-window.ts`                            |
| Expiry                            | `apps/api/src/services/device-notifications/expiry.ts`                                   |
| Routes                            | `apps/api/src/routes/me-device-notifications.ts`                                         |
| Body limit                        | `apps/api/src/app.ts`, `MAX_DEVICE_NOTIFICATION_BATCH_BYTES` in `lib/http-limits.ts`     |
| Daily expiry sweep                | `POST /cron/expired-drafts-sweep` in `apps/api/src/routes/cron.ts`                       |
| Account export                    | `apps/api/src/account/export-device-notifications.ts` → `personal.deviceNotifications`   |

## Data

Everything belongs to the person's hub and nothing is organization data. The phone mints every id,
so keys are composite, `(hub_id, id)`, and children point at parents through `(hub_id, …)` foreign
keys: one install used by two accounts is two sources, and an id one person's phone chose can never
reach another person's row. Deleting the account deletes the hub, which cascades through all of it.

| Table                               | One row per                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `device_notification_source`        | Registered install, keyed `(hub_id, id)`: label, platform, retention days, consent and last-seen time      |
| `device_notification`               | Captured notification, keyed `(hub_id, id)`, with `received_at` and `expires_at`                           |
| `device_notification_message`       | Conversation message, keyed `(hub_id, id)` and unique on `(hub_id, identity)`                              |
| `device_notification_removal`       | Removal of a notification from the shade, unique on `(hub_id, notification_id)`                            |
| `device_notification_deletion`      | Deletion time for everything (`app_id` null) or one app, unique `NULLS NOT DISTINCT` on `(hub_id, app_id)` |
| `device_notification_upload_window` | The person's current hourly upload window                                                                  |

`expires_at` is `captured_at` plus the source's retention when the row was stored. Changing a
device's retention applies to uploads from then on; stored rows keep their expiry.

Two GIN expression indexes prepare full-text search for Athena's tools: one over a notification's
title, thread title, subtitle, body, and lines, one over message text. Both use the `simple`
configuration, because notification text arrives in any language. Nothing reads them yet.

## Endpoints

All six are session-only `/v1/me` routes. The hub is resolved from the session, never from the
request. Times on the wire are Unix milliseconds.

- `PUT /v1/me/device-notification-sources/{deviceId}` registers the install or updates its label,
  retention (1..3650 days), and consent time, and returns the source (`deviceId`, `platform`,
  `label`, `retentionDays`, `syncConsentedAt`, `lastSeenAt`, `createdAt`, `updatedAt`).
- `GET /v1/me/device-notification-sources/{deviceId}` reads a registered source back, or `404`.
  Not part of the Android contract; it exists so the registration has a reader.
- `POST /v1/me/device-notifications/batches` uploads at most 100 notifications and 200 removals.
- `GET /v1/me/device-notifications/deletions` returns `{ deletedBefore, apps[] }`.
- `DELETE /v1/me/device-notifications[?appId=][&before=]` deletes everything, or one app's
  entries, captured at or before the deletion time, from every device, records that time, and
  returns `{ deleted }`. The deletion time is `before` (Unix ms) clamped to now, or now.
- `GET /v1/me/device-notifications?appId=&cursor=&limit=` lists newest capture first, 1..200 per page
  (default 50), each notification with the messages first stored with it and its removal, and
  returns `{ items, nextCursor }`.

### Upload answers

Each item gets one result, in request order. Notifications are classified in this order:

| Status      | When                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| `invalid`   | The item fails `DeviceNotificationIn` (a wrong kind, a text field over 4,000 characters, …) |
| `duplicate` | Its id appeared earlier in the batch, or the person already has it                          |
| `expired`   | `captured_at + retention ≤ now`                                                             |
| `deleted`   | A delete of everything, or of its app, happened at or after its capture                     |
| `stored`    | Saved now                                                                                   |

Removals are `invalid`, `duplicate` (the id or its notification repeats in the batch, or is
already stored), `orphaned` (the person has no such notification, including one this batch did not
store), or `stored`. Notifications are processed before removals, so a removal may refer to a
notification uploaded in the same batch.

A message is stored once per person by `identity`, with the first stored notification that carried
it; later notifications that repeat it do not store it again, and the list shows it only under that
first notification. Messages are stored only with a notification stored now; a `duplicate`
notification's messages were stored the first time.

The request itself is parsed leniently — each item is its full schema or, failing that, anything
with an `id` — so one malformed item cannot fail the batch. The published reference shows the full
item schemas. Whole-request failures are Problem responses:

| Status | When                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `401`  | No session                                                                                                                 |
| `404`  | `deviceId` is not registered for this person (register it and retry)                                                       |
| `413`  | The body is over 8 MiB (halve the batch)                                                                                   |
| `422`  | The batch shape is malformed: more than 100 notifications or 200 removals, an item without an `id`, a malformed `deviceId` |
| `429`  | More than 240 batches in the person's current hour, with `Retry-After` in seconds                                          |

## Deletions and expiry

A delete's deletion time is when the person asked. The phone queues deletes and may send one long
after, so it passes that moment as `before`; the server uses `min(before, now)`, or now when
`before` is absent. The delete removes the scope's rows captured at or before that time at once
(messages and removals cascade) and leaves anything captured later, so what the phone captured while
the delete waited is neither wiped on the server nor answered `deleted` when it uploads, nor deleted
from the phone when it reads the time back. Late uploads captured at or before the time come back
`deleted`; phones read the times through the deletions endpoint and delete their own older entries,
so a delete anywhere removes the copy everywhere.

Deletion rows are one per scope per person. A later delete keeps the greater of the stored and the
new time, so a late-arriving delete with an earlier `before` never moves a scope's time backwards.
The rows are never pruned.

Expired rows are left out of every read at once and deleted two ways, neither a new worker: each
upload first deletes the uploader's own expired rows, and the existing daily
`expired-drafts-sweep` cron tick deletes everyone's, so a person who stops syncing still loses their
rows on schedule. The local dev scheduler runs the same sweep.

## Decisions

- **Registration is explicit.** The Docket task suggested registering on first upload; the Android
  contract instead registers with `PUT` before uploading and whenever retention changes, because
  retention and consent time are needed before the first row can be given an expiry. An upload from
  an unregistered device is `404`, and the phone's worker registers at the start of every run.
- **Deletion times, not per-item tombstones.** The phone deletes by scope (everything or one app),
  so one time per scope answers every late upload and every other device without a row per deleted
  notification. There is no delete-by-device endpoint in this contract.
- **The phone says when a delete happened.** A delete queued offline and sent later must not take
  what was captured in the meantime, so `before` carries the moment the person asked. It is
  clamped to now so a phone cannot record a deletion time in the future.
- **Clock skew.** A deletion time without `before`, and every clamp, is server time; capture times
  are phone time. A phone whose clock runs behind can have a notification captured just after such
  a delete answered `deleted`. The window is the skew, and the phone marks such an item uploaded
  rather than retrying.
- **8 MiB body limit.** Sized so a single notification at every field limit still fits, so halving
  on `413` always converges.
- **240 batches an hour.** A fixed hourly window stored in Postgres so it holds across instances.
  A phone batching a minute at a time uploads far less; the limit stops a runaway client.
- **Malformed batches are `422`.** Like every other validation failure in this API.
- **Encryption.** Production Postgres is Neon, which encrypts storage at rest. Content is not
  encrypted again in the application, because Athena's search needs Postgres full-text indexes over
  it; revisit if the threat model changes.
- **No content in logs.** Nothing on these paths logs notification text, and the response
  contract parse failure logs paths and issue codes only.
- **The list is for checking.** People and tests use it to see what the server holds. Athena's
  search tools are a later milestone.
