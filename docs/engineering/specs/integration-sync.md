# Integration Sync — the leased spine

> **Status**: Shipped (M4 of the email-to-task productization).
> **Last Updated**: 2026-07-10
> **Owners**: Platform

One spine runs every background pull against an external provider. Both purposes — the
connector **task mirror** and the **email-to-task ingest** — share the same lease, run
history, honest status handling, and reauth surfacing, implemented exactly once in
`apps/api/src/routes/integration-sync.ts`.

## 1. The spine: `runLeasedSync(row, {actorId, trigger, purpose}, execute)`

For one integration it:

1. **Claims the lease** — `integration.sync_started_at`, atomically; a fresh lease held by
   another run returns `null` (skipped, not failed). Stale leases (`LEASE_STALE_MS`, 15 min
   — a process that died mid-run) are reclaimed.
2. **Persists a purposed `sync_run` row** (`status: running`, `trigger`, `purpose`) — every
   attempt leaves a durable, auditable trace; nothing about a run is ephemeral.
3. **Resolves the provider + OAuth token** (`resolveConnectorToken`, auto-refresh via
   Better Auth). A failed resolution finishes the run as a **reauth failure** (below).
4. **Runs the executor** — the purpose-specific pull. Throwing is the failure channel: a
   `ConnectorError` with `kind: 'auth'` is a reauth failure; anything else a plain failure.
   Returning `{processed, total}` finishes the run as succeeded.
5. **Records the outcome truthfully** on both the run and the integration:
   - success → `integration.status='connected'`, `lastSyncStatus/lastSyncedAt` stamped,
     lease cleared;
   - failure → `integration.status='error'`, `lastError/lastErrorAt` stamped, lease
     cleared, and — only when the connection was _previously healthy_ — an inbox
     notification to the owner (`connector_needs_reauth` or `connector_sync_failed`), so a
     silently-broken background connector is impossible but a persistently-broken one
     doesn't spam.

## 2. The two purposes

| Purpose        | Entry point                                                         | Executor does                                                                           | Cron                               |
| -------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------- |
| `task_sync`    | `runSync` / `sweepConnectorSync`                                    | `importWork` → `reconcileTasks` (mirror + optional write-back)                          | `/internal/cron/sync-connectors`   |
| `email_ingest` | `sweepEmailSuggestions` (`apps/api/src/lib/email-to-task/sweep.ts`) | mail-capability `listThreads` (cursored) → funnel → synthesis → `email_suggestion` rows | `/internal/cron/email-suggestions` |

Selection differs by design:

- `task_sync` sweeps `syncMode='mirror'` integrations on their `syncCadenceMinutes`,
  **excluding mail-capable providers** (a mailbox is not a task list; double-pulling would
  race the ingest for the lease).
- `email_ingest` sweeps mail-capable providers (`MAIL_CAPABLE_PROVIDERS` manifest) whose
  `config.emailToTask = {enabled: true, threshold}` — strictly opt-in, no hidden default.

Because both purposes share the per-integration lease, a task sync and an email ingest can
never run concurrently against the same integration.

### 2.1 Linear identity, activation, and webhook rules

Linear connections are account-specific and org-scoped:

- A user may link several Better Auth `linear` account rows, including identities whose provider
  email differs from the Docket account email. Every Docket integration binds to one exact
  `externalAccountId`; token refresh, scope checks, and viewer labels all resolve that row rather
  than whichever Linear grant happens to be first.
- Settings renders every linked identity and every Linear integration. An unbound legacy Linear row
  may be bound once; a bound row cannot be silently rebound. An identity cannot be unlinked while
  any Docket connection uses it, and credential removal requires passkey step-up.
- Verification resolves and persists Linear's organization id, slug, and name. One Linear workspace
  may be connected only once inside a Docket organization, even when two OAuth identities can see
  it; the check and health update run at `SERIALIZABLE` isolation.
- On first successful verification, every discovered Linear team is mapped to the Docket org's
  earliest active team and `runSync` executes immediately. The first settings response therefore
  reflects the real initial import, and Linear issues already exist as native linked Docket tasks.
- A signed Linear delivery is fanned out once per matching Docket organization (deduping multiple
  rows inside one org). Draining an `Issue` delivery requests a leased incremental `runSync` before
  projecting activity, so issue changes repair the native task mirror near-real-time; the ordinary
  scheduled sweep remains the missed/out-of-order webhook backstop. Provider-triggered repair uses
  the existing `scheduled` trigger discriminator to avoid a database-enum migration for an
  operational source distinction that does not change sync semantics.

## 3. Cursor storage (`integration.sync_state`)

Incremental listing state lives in the integration's `sync_state` jsonb, validated as
`IntegrationSyncState` (`@docket/types`): `{ mail: { cursor, updatedAt } }`. Rules:

- **Opaque**: cursors are provider-owned resume tokens (Gmail `historyId`, Graph
  `deltaLink`) — the app never parses them, only echoes them into `listThreads`.
- **Lease-guarded writes**: the cursor is advanced inside the executor, i.e. strictly under
  the lease — concurrent sweeps cannot interleave cursor updates.
- **Expiry recovery**: a `cursorExpired` page triggers exactly one cursorless full re-pull
  (see `mail-providers.md` §4). Idempotent ingest (unique thread index + Message-ID check)
  makes re-seen threads no-ops.
- **Corrupt/absent state** falls back to a full pull (logged), never a wedged integration.

## 4. Failure surfacing (needs-reauth)

A revoked/expired grant is never silent: the token failure (or a thrown auth-kind
`ConnectorError`) flips `integration.status` to `error`, stamps `lastError`, records the
failed `sync_run`, and notifies the owner once (`connector_needs_reauth`, linking to the
connections settings page). This applies identically to both purposes — the email ingest
inherited it by moving onto the spine (previously it silently `continue`d).

## 5. Observability

Every pull is a `sync_run` row: purpose, trigger, processed/total counts, error, timings —
queryable per integration (`GET /v1/orgs/:orgId/integrations/:id/runs`, `SyncRunOut` now
carries `purpose`). Sweep-level counters are logged by each cron handler.

## 6. Invariants (tested)

- One live run per integration (lease claim races return `null`).
- Every attempt has a `sync_run` row; every row terminates `succeeded`/`failed`.
- Success never reported without the executor completing (no false "connected").
- Owner notified exactly once per healthy→broken transition.
- Cursor advances only on a successful listing, only under the lease.
- Mail-capable providers never appear in `task_sync` sweeps; non-opted-in mail
  integrations never appear in `email_ingest` sweeps.
