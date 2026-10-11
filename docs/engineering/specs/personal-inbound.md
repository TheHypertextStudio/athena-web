# Personal inbound events

`POST /v1/me/inbound` is the authenticated ingress for personal app/device observations.
Provider webhooks keep their own URLs and authentication. Source registration, reads, deletion,
and consent remain resource operations. The Android contract is also documented in
`docket-android/docs/reference/notification-sync.md`.

## Wire contract

The `@docket/athena/inbound-contract` export owns the versioned schemas. The envelope is
`{ schemaVersion: 1, sourceId, events }`. A source is the caller's registered notification source;
the server resolves the hub from the session and rejects another person's source.

Each event is `{ id, type, occurredAt, payload }`. Supported types:

| Type                             | Payload                       | Identity/time rule                                   |
| -------------------------------- | ----------------------------- | ---------------------------------------------------- |
| `platform.notification.captured` | `DeviceNotificationIn`        | `id = payload.id`, `occurredAt = payload.capturedAt` |
| `platform.notification.removed`  | `DeviceNotificationRemovalIn` | `id = payload.id`, `occurredAt = payload.removedAt`  |

The reused platform-neutral content includes app identity, timestamps, conversation messages,
scrubbing/redaction/backfill flags, and a typed `android` details section. Limits remain 100 captures,
200 removals, 100 messages per capture, 50 lines, and 4,000 characters per text field; the HTTP body
limit is 8 MiB. Version 2 and invalid envelopes fail request validation. Unknown event types or invalid
payloads with readable IDs receive `invalid` receipts while valid siblings are processed.

The response is `{ events: [{ id, status }] }` in the original request order. Status meanings are
unchanged: `stored`, `duplicate`, `deleted`, `expired`, `orphaned`, and `invalid`; all settle the
corresponding queue entry. Content-free durable event receipts deduplicate IDs across event families within the person's hub,
even after notification expiry or deletion; account deletion cascades the receipts. Captures are stored before
removals, including when input order is reversed. The old notification batch route adapts to the same
handler and projects receipts into its original arrays. Existing rate limiting and `Retry-After`
apply to both routes.

## Consent and durable dispatch

`GET /v1/me/device-notifications/triage-settings` returns `{ enabled, enabledAt }`. An absent row
returns false/null. `PUT` accepts only `{ enabled: boolean }`. Activation time is recorded by the
server, repeated enable preserves it, and off/on starts a new window. Device sync and selected apps
remain separate from account-level triage consent.

A capture and its eligible pending reference commit in the same database transaction. Only newly
stored, non-redacted, non-backfilled, unexpired captures strictly after activation qualify. Removals,
rejected captures, duplicates, and historical sync never create triage work. Notification deletion
and expiry cascade to pending references; account export includes settings and references, and hub
account deletion cascades both tables.

The existing minute Athena scheduler drains at most 25 people per sweep with ownership
through leased claims and the existing generation/outbox infrastructure. Each person has at most one
active notification review, with at most 100 retained notifications per session. Assignment and
session creation are transactional; retries recover the same session ID after interruption. Leases
expire after 60 seconds, and the existing generation lease prevents concurrent model execution.

These are personal Athena job sessions with no workspace. `workLinkage: observation` is constrained
to server-created notification-triage jobs. It permits evaluating context before creating a task;
actual work still requires tracked work and existing workspace authority. Before execution, the
loop rechecks the owner, activation window, consent, deletion, and retention. Opt-out cancels pending
unstarted sessions and removes unassigned references. A later opt-in never replays them.

Notification text is explicitly untrusted, provenance-wrapped context, bounded below 96,000 characters
with per-entry budgets that retain every assigned ID. Recovery cancels a run when retained context
changes, preventing use of deleted or expired text in an older transcript.
Existing personal instructions, backend selection, tool permissions, and approval gates remain in
force. An unavailable configured backend fails visibly without cloud fallback. Results and approvals
use existing personal Athena sessions and surfaces. Quiet results persist without an inbox alert.

## Operations

`NOTIFICATION_TRIAGE_DISPATCH=enabled` enables scheduled dispatch. `paused` or an absent value stops
new dispatch while captures continue to be stored. The production workflow forwards the repository
variable with a `paused` default; operators set it to `enabled` after acceptance. The existing cron response exposes content-free
`claimed`, `dispatched`, and `failed` counters; notification content is never included in these metrics.
Apply migrations `0149_notification_triage` and `0150_personal_inbound_receipts` before enabling dispatch. Deploy the compatible server
before distributing Android. Local mock-model evidence does not establish provider or production
readiness; acceptance requires a correlated deployed listener → ingress → durable event → personal
Athena result, including lost-response and interrupted-dispatch recovery.
