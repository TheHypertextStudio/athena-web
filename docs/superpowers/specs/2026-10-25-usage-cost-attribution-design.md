# Usage and cost attribution

## Purpose

The operator can see, for every user and workspace, how much of each metered resource they consume
and what it costs, so unit economics against the $8 Docket Pro price are known before growth
rather than discovered after it.

The resource view shows blob bytes and total database size
([admin-resource-routes.ts](../../../apps/api/src/routes/admin-resource-routes.ts)) and Athena token
totals grouped by model, surface and kind
([admin-athena-usage-routes.ts](../../../apps/api/src/routes/admin-athena-usage-routes.ts)). The Costs view adds daily resource quantities attributed by person and workspace, effective-dated
prices, and separate caused-by and payer lenses. Missing measurements and prices remain visible.

## Principles

1. **One ledger.** Every metered resource lands in the same table with the same keys, so a new
   resource is a new meter and never a new report.
2. **Quantities are facts, prices are opinions.** The ledger stores quantities. Dollar cost is
   computed at read time from an effective-dated rate card, so a price change reprices history
   correctly and a missing price never reads as zero.
3. **Unseen is not free.** A quantity a provider does not report (including a Lattice generation
   without usage, or a store whose size is not recorded) is counted as an unmeasured event and
   reported beside the total. This is the rule `agent_session_run` already follows.
4. **Two lenses, one dataset.** Cost is shown by who caused it and by who pays. The toggle changes
   attribution at read time and never changes the stored data.
5. **Overhead stays visible.** Shared fixed costs and unattributable remainders are a named line.
   They are not spread into per-user figures.

## Attribution

Each ledger row carries `user_id` (the person whose activity caused it, when the source records
one) and `organization_id` (the workspace it happened in, when there is one).

- **Caused by** groups by `user_id`. Rows with no recorded person group under their workspace as
  "Workspace" cost, and rows with neither group under "Unattributed".
- **Pays** groups by billing owner. AI usage is paid by the person who owns the session, wherever
  it ran. Everything else in a workspace is split equally among the workspace's active human actors
  holding the `owner` role. A personal workspace has one member and one payer. A workspace with no
  owner stays visible under its own key.

The payer is resolved when the report is read, from current ownership. Transferring ownership
therefore reprices history under the new owner. That is accepted for now; a stored payer is a
later change if the distinction starts to matter.

## Data model

All tables live in `packages/db/src/schema/usage-cost.ts`. Migration
`0181_usage_cost_ledger.sql` creates the ledger; migration 0180 was already allocated. Instant
columns use `timestamptz`; the ledger day is a UTC date.

### `usage_rate`

The rate card. One row is the price of one unit of one resource from a date forward.

| Column                     | Meaning                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `id`                       | ULID                                                                        |
| `resource`                 | Resource key, for example `ai_input_tokens`                                 |
| `dimension`                | Model name, table name or store name; empty string when the rate is general |
| `micros_per_million_units` | Price in millionths of a US dollar per million units                        |
| `effective_from`           | The first instant the price applies                                         |
| `note`                     | Where the price came from, shown beside it                                  |
| `created_at`               |                                                                             |

Unique on `(resource, dimension, effective_from)`. The rate for a usage row is the latest one for
its `(resource, dimension)` at or before the row's day, falling back to the same resource with an
empty dimension. No match means the row is unpriced.

Micro-dollars per million units supports integer token prices: a $0.075 per
million token price is `75000`, while $0.35 per decimal gigabyte-month over a 30-day month is about `11.666667`.
The current integer rate field cannot represent this exactly; fractional storage rates need a
precision change before they can be entered without distortion. `11667` would overstate that
storage price by 1,000 times.

### `usage_daily`

| Column              | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `id`                | ULID                                                           |
| `day`               | UTC date                                                       |
| `user_id`           | Causing person, nullable, `ON DELETE SET NULL`                 |
| `organization_id`   | Workspace, nullable, `ON DELETE SET NULL`                      |
| `resource`          | Resource key                                                   |
| `dimension`         | Model, table or store; empty string when none                  |
| `quantity`          | Units for the day (a flow) or units held at snapshot (a stock) |
| `unmeasured_events` | Events in the day that could not be quantified                 |
| `updated_at`        |                                                                |

Unique on `(day, coalesce(user_id, ''), coalesce(organization_id, ''), resource, dimension)`.
Rows are written by upsert, so recomputing a day replaces it. Setting null on user deletion means
account purge leaves unlinked totals that identify no one. Both keys are real foreign keys, so the
purge list of no-FK `user_id` tables needs no entry.

### `usage_meter_run`

One row per meter (`ai_tokens`, `postgres_storage`, `object_storage`) holding when it last
succeeded, when it last ran and whether the last run failed. A pass over a quiet day writes no
ledger rows, so the ledger alone cannot tell "ran and found nothing" from "did not run".

### Resources

| Key                     | Kind  | Unit     | Source                                    |
| ----------------------- | ----- | -------- | ----------------------------------------- |
| `ai_input_tokens`       | flow  | token    | `agent_session_run.input_tokens`          |
| `ai_output_tokens`      | flow  | token    | `agent_session_run.output_tokens`         |
| `ai_cache_read_tokens`  | flow  | token    | `agent_session_run.cache_read_tokens`     |
| `ai_cache_write_tokens` | flow  | token    | `agent_session_run.cache_creation_tokens` |
| `postgres_bytes`        | stock | byte-day | nightly per-table size snapshot           |
| `object_bytes`          | stock | byte-day | sum of recorded blob sizes                |

A stock row holds the bytes present at the nightly snapshot and counts as one byte-day. Cost for a
month is the sum of its daily rows priced per byte-day.

Later phases add `api_requests`, `api_wall_ms`, `cron_runs`, `emails_sent`, `emails_received`,
`phone_minutes`, `sms_sent` and `payment_fee_micros` as further keys in the same table.

## Meters (phase 1)

### AI tokens

Derived from persisted `agent_session_run` totals and `agent_delegation` terminal results. Interactive
turns accumulate reported counts in the transaction that retains their transcript; durable results
retain their receipt timestamp with the terminal payload. The nightly pass never calls a provider.
A rollup pass selects started runs whose completion (falling back to start time) falls in the
window and groups them by day, causing person, workspace and model. Queued runs are excluded.

- Causing person is `agent_session.owner_user_id`. Workspace is `context_organization_id`, falling
  back to `organization_id` for registered agents. A registered-agent run has no person and groups
  under its workspace.
- A run with null token columns adds to `unmeasured_events` and no quantity.
- The pass recomputes the previous three days on every run, because generations finish late.

The caller audit below distinguishes canonical session execution from direct provider calls.
Template tailoring uses session runs and must not be counted twice. Direct model calls outside
those records require separate capture in phase 1.5; host elicitation is not itself a Docket model
call.

### Provider caller audit

The audit follows production call sites and container bindings, including direct Messages API
adapters that bypass `collectProviderTurn` entirely. Capture status describes the source;
this table does not establish deployed acceptance.

| Caller                                    | Execution path                                                                  | Current usage persistence                        | Coverage and remaining work                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Interactive Athena                        | `agent/loop.ts` → `collectProviderTurn`                                         | `addRunUsage` in the generation transaction      | Reported Lattice counts pass through both adapter boundaries; correction calls are accumulated |
| Template tailoring                        | `agent/template-tailoring-delivery.ts` → generation admission and session loop  | Same session-run meter                           | No independent meter; avoid double counting                                                    |
| Daily-plan assessment                     | `services/daily-plan-assessment.ts` → `streamTurn`                              | Direct call record after draining terminal usage | Person attribution for the cross-workspace assessment                                          |
| Destination review                        | `mcp/work-destination-review-tool.ts` → `streamTurn`                            | Direct call record                               | Caller and task workspace                                                                      |
| Phone replies                             | `routes/voice-responder.ts` → `streamTurn`                                      | Direct call record                               | Voice-session person and workspace                                                             |
| Email-to-task synthesis                   | `lib/email-to-task/synthesize.ts` → `RealTaskSynthesizer`                       | Direct call record before domain parsing         | Source actor person and receiving workspace                                                    |
| Task-description expansion                | Container `taskExpander` → `RealTaskSynthesizer`                                | Direct call record before domain parsing         | Authenticated requester and task workspace                                                     |
| Daily digest and highlight reconciliation | `routes/daily-digest.ts`, `services/highlights/reconcile.ts` → `RealSummarizer` | Direct call record before domain parsing         | Day owner; measured malformed output is retained                                               |
| MCP elicitation                           | `mcp/elicit.ts` → host elicitation                                              | No Docket provider call                          | No provider meter; no sampling call found in API/domain production sources                     |
| Durable Lattice delegation                | `agent/lattice-delegations.ts` → sealed relay result                            | Retained terminal usage rolled up by receipt day | Missing counts remain unmeasured; placeholder compute counters do not establish measured zero  |

### Direct model-call capture (phase 1.5)

Direct calls retain one `ai_call_usage` record per provider invocation, independently of the
session-run meter. Migration 0188 adds the append-only source with a timezone-aware receipt time,
source key, optional person/workspace, backend/model and nullable token counts. It stores no prompt
or generated content. Provider errors and interrupted streams remain unmeasured; a response with
reported counts remains measured even if later output parsing fails. Deterministic development
turns are excluded. Template tailoring continues to use its canonical session run only.

The API binds attribution per asynchronous invocation for the direct Messages adapters, so shared
container instances cannot mix concurrent callers. Daily-plan assessment, destination review and
phone reply streams capture terminal usage; assessment drains past its tool result before returning.
Email synthesis resolves the source actor's person and retains the receiving workspace; task
expansion uses its authenticated requester and workspace. Cross-workspace daily assessments,
digests and highlight narration belong to the requesting person without inventing a workspace.
The existing nightly AI meter combines these records with session and durable Lattice sources
before replacing a window, preserving the own-hardware dimension and idempotent recomputation.
Persistence failures emit a server error event while preserving the provider's original outcome;
they are an accounting gap to investigate, not evidence of measured zero.

The durable command requests `tool_use_session` through `buildAgentTaskCommand`. Its collected
payload must be checked against that contract before reading text-generation usage or treating a
compute counter as verified. The inspected daemon implementation's agent-task result builders return
`providerId`, `model`, `outputText` and a `computeCounter`, but no `usage`; the counter's output-token
value is explicitly zero. That value cannot establish measured zero model usage. This is source
inspection, not confirmation of the owner's installed daemon version. Capture counts when supplied
and retain an unmeasured event otherwise. Own-hardware volume needs a distinct ledger dimension
from hosted model usage.

Interactive runs retain `usage_backend` separately from the provider model. Ledger dimensions use
`lattice:<model>` for own hardware, including `lattice:` for an unknown model. A general hosted-token
rate never falls back onto this namespace; pricing it requires an explicit own-hardware rate.
Durable results use their first decrypted `result_received_at`, so later approval or acknowledgement
does not move the usage day. Legacy results without a receipt timestamp use submission time as a
historical approximation. Both sources merge before atomic window replacement. A correction turn
with an unreported constituent call remains unmeasured because its complete token total is unknown.
Migration 0187 adds the backend and receipt fields without rewriting existing token measurements.

### Postgres storage

A nightly job attributes bytes held per `(workspace, table)` and per `(person, table)`:

- Row bytes are `sum(pg_column_size(t.*))` grouped by owner, over the tables that dominate growth:
  `agent_session_transcript`, `event`, `inbound_event`, `audit_event`, `change_set_entry`,
  `search_document`, `athena_inbound_message` and the work tables (`task`, `project`, `initiative`,
  `program`, `comment`).
- Above one million rows a table is sampled with `TABLESAMPLE SYSTEM` and scaled up. The sample
  fraction is recorded so the figure can be audited.
- Tables are measured with the application's database role. A table with row-level security (the
  transcript table) is only fully counted when that role owns it or bypasses the policy; the
  phase 0 baseline confirms this in production before the figures are trusted.
- Each table's on-disk size (`pg_total_relation_size`, indexes and TOAST included) is split among
  owners in proportion to their `pg_column_size` row bytes, so the parts sum to the real size.
- The remainder of `pg_database_size` after attribution is written once per day with no person and
  no workspace, as `postgres_bytes` with dimension `unattributed`. The page shows it as its own
  line.

### Object storage

The sum of `byte_size` from `attachment` (kind `file`), `document_image` and
`billing_discount_evidence`, grouped by workspace and, where the row records a creator actor, by that
actor's person. Athena mail blobs and account exports record no size and are listed as known gaps
until a size is stored for them (phase 4 reconciles the whole bucket against its real total).

## Admin surface

Routes under `/admin/costs`, behind the staff middleware. Reads require the Finance tier or above.
Rate writes require the same and write an `operator_audit_event`.

- `GET /admin/costs?month=YYYY-MM&lens=caused|pays` returns people ranked by cost, each with total
  cost, unpriced quantity indicator, top resource, and unmeasured event count; plus a totals line
  that includes unattributed cost.
- `GET /admin/costs/holders/:key?month=...&lens=...` returns that person's cost by resource and by
  workspace, the month's daily series and a cumulative lifetime total.
- `GET /admin/costs/rates` and `POST /admin/costs/rates` read and add rate rows. Rates are
  append-only; correcting a price adds a row with a new effective date.

The page is `/costs` in the admin app and follows the app's list-row pattern: one aligned row per
person, a lens toggle and a month list in the header, the biggest resource named in each row. A
person's detail is a second level with resource rows. Price effective dates use the shared
DatePicker, recorded in `docs/design/audits/inventories/date-pickers.md`. Rows with unpriced quantities show the
quantity and the word "unpriced" in the cost column, never `$0`. There are no explanatory
paragraphs; empty states are a label and the action that fills them (add a rate).

## Jobs

`POST /internal/cron/usage-rollup`, guarded by `CRON_SECRET`, daily at 04:00 UTC. It runs the
token pass for the trailing three days and takes the storage snapshots for today. It is idempotent.
`scripts/scheduler-setup.ts` provisions it and the cron table in
[deployment.md](../../engineering/deployment.md) lists it.

## Errors

A failing meter fails its own pass and nothing else. The job reports per-meter success, the Costs
page shows the date of each meter's last successful pass, and a meter with no pass in 48 hours is
marked stale in the page. Nothing is shown as complete when a pass did not run.

## Testing

Tests live in `tests/` beside the code and assert behaviour and structure, not copy.

- Rate lookup: effective dating, dimension fallback, no match yields unpriced.
- Token rollup: attribution of owned and registered-agent runs, null tokens counted as unmeasured,
  idempotent recompute, late completion inside the window, and aggregation across result sources.
- Lattice: reported text/tool counts, correction-call totals, missing usage, retained receipt day,
  placeholder compute counters, and separation from hosted-model prices.
- Storage snapshot: index scaling, sampling scale-up, remainder line, per-owner grouping.
- Payer resolution: single owner, several owners split equally, personal workspace, user-owned run.
- Routes: staff tier gating, month and lens parameters, rate append-only behaviour and audit write.
- Account purge: usage rows survive with the person unlinked.

## Phases

0. Read-only baseline of production sizes and the last 30 days of tokens.
1. This document's meters, rate card, rollup job and Costs page.
   1.5. Usage capture for model calls outside session runs, from the phase 1 audit.
2. Request and wall-time metering per user and workspace; per-user background sync counts.
3. Email, phone and payment-fee meters.
4. Provider-invoice reconciliation, overhead allocation, revenue and margin, forecast scenarios,
   alerts.
5. Cost controls the data justifies: retention by data class, tiering cold transcripts and bodies to
   cheaper storage, per-plan allowances.

## Out of scope for phase 1

Revenue and margin, per-request metering, third-party meters, forecasts, alerts, user-facing usage
views and any retention or tiering change. Phase 1 measures; it changes no stored data.
