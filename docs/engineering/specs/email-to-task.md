# Docket — Email-to-Task & the Attachment Model

> Athena reads your mail, decides what work it implies, and **synthesizes a task** with the source
> email **attached as context**. The task is the real object; the email is an attachment — the
> first instance of a general, MIME-agnostic attachment abstraction.
>
> **Status**: backend complete (data model, attachment + suggestions APIs, Gmail mail-actions
> adapter, automation engine fully wired, funnel + synthesis + scheduled ingest sweep) — all
> tested and committed. Remaining: Athena LLM synthesizer (default is heuristic), seed-on-
> bootstrap wiring, and the web UI (triage suggestions lane, task-detail attachments, settings).
> **Source of truth for intent**: `docs/_archive/core/overview.md` §"Semantics-Aware Data
> Attachments"; this spec supersedes it for the engineering contract.

---

## 1. Why this exists

Sunsama's Gmail integration treats **the email as the task**: drag a message in, the subject
becomes the title, completing the task syncs state back to Gmail. That conflation breaks down
because one email is rarely one unit of work — a thread can imply several actions or none, and the
words in an email are rarely the action you actually need to take ("Software Engineering Interview"
→ _"Schedule the SWE interview with Google"_).

Docket inverts the relationship:

- The **task** is the real object you own and act on.
- The **email** is **context attached** to it — one attachment among several possible kinds.
- **Athena** does the synthesis (reads the thread, drafts an enriched task) and **proposes** it;
  nothing enters your task list until you confirm.

This is deliberately the first concrete use of a long-documented goal: _"using emails as
attachments for tasks or calendar events. If it has a MIME type, it can be represented in the
app."_ We therefore build a **general attachment abstraction** and prove it against two kinds in
v1 (`email` + plain `url`).

## 2. Conceptual model

Four stages, kept strictly separated. This separation already exists in the codebase and is
load-bearing — **observations are explicitly not tasks** (`apps/api/src/routes/observation-sync.ts`).

```
  PULL              AWARENESS                 PROPOSAL                    COMMITMENT
 ┌──────┐  ingest  ┌────────────┐  funnel +  ┌────────────┐  user      ┌──────────────────┐
 │Gmail │ ───────► │observation │ ─────────► │ suggestion │ ─confirms─► │ task + attachment│
 └──────┘  sweep   │ (per email)│  synthesize│ (not a task)│  in triage │  (real object)   │
                   └────────────┘            └────────────┘            └──────────────────┘
                                                                              │ lifecycle
                                                                              ▼
                                                                   automations → Gmail write-back
                                                                   (archive / mark-read / label)
```

### 2.1 Entities

- **Attachment** — a typed reference from a subject (a task, for now) to an external or stored
  resource. Polymorphic by `kind`:
  - `email` — an **integration-backed pointer**. The content stays in Gmail; we persist metadata +
    a snapshot snippet and fetch the full thread on demand via the already-granted read scope.
  - `url` — a **dumb pointer**: the pasted link plus fetched title/favicon. No integration, no
    blob.
    The model is kind-agnostic; future kinds (`file` via `BlobStore`, `drive`) slot in without schema
    reshaping.
- **Suggestion** (`emailSuggestion`) — a **proposed synthesized task that is not yet a task**. It
  carries the draft fields, a confidence score, and the attachment(s) it would create. It is the
  data embodiment of Athena's existing `propose_change(create_task)` action. Lives until **accepted**
  (→ materializes a task) or **dismissed**.
- **Automation** — a user-owned rule expressed as **data**, not code: `{ on, when, then }` where
  `on` matches an event, `when` is a declarative predicate, and `then` is a list of action
  commands. Two families fall out of the same model — _pipeline_ automations (auto-accept /
  auto-dismiss / route a suggestion) and _email-state_ automations (write back to Gmail across the
  task lifecycle) — but they are not special-cased; they are just rows with different `on`/`then`
  values. The engine is a composition of standard patterns (§7) so triggers, conditions, and
  actions are all open/extensible without touching it.

### 2.2 Cardinality & dedup

One email **thread** → at most one **suggestion** → at most one **task**. A task may carry many
attachments. Thread-level dedup reuses the existing `(sourceIntegrationId, externalId)` uniqueness
discipline already used for linked tasks (`task_source_uq`, `work.ts`).

### 2.3 Why suggestions are not tasks

The triage queue is defined as _unsorted tasks on triage-enabled teams_ (`use-triage.ts`). If a
suggestion were a task row, it would already be "in the list," contradicting _suggest, user
confirms_. So a suggestion is its own entity rendered in a **distinct triage lane**; accepting it
**materializes** a real task. This preserves the trust boundary while still giving the user one
place to process incoming work.

## 3. Data model (`packages/db/src/schema`)

Follows the conventions in `data-model.md` (ULID PKs, `auditColumns()`, `organization_id` tenant
boundary, `timestamptz`). Three new tables: `attachment`, `emailSuggestion`, and `automation_rule`.
Rules and thresholds are **data fetched at runtime** — never literals in code.

### 3.1 `attachment`

Mirrors the polymorphic `comment` table (`crosscutting.ts`, `subjectType` + `subjectId` + index)
and the provenance/ledger columns on `task`.

| Column                   | Type                                      | Notes                                                             |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| `...auditColumns()`      |                                           | `id`, `organizationId`, `createdBy`, timestamps, `archivedAt`     |
| `subjectType`            | `attachment_subject_type` enum (`task`)   | extensible; only `task` ships                                     |
| `subjectId`              | text notNull                              | the task id                                                       |
| `kind`                   | `attachment_kind` enum (`email` \| `url`) |                                                                   |
| `title`                  | text notNull                              | display label                                                     |
| `url`                    | text                                      | canonical external URL (open-in-Gmail / the link)                 |
| `sourceIntegrationId`    | text → `integration.id` (set null)        | null for `url`                                                    |
| `externalId`             | text                                      | Gmail thread id; null for `url`                                   |
| `metadata`               | jsonb                                     | kind-specific: `{ sender, subject, snippet, favicon, fetchedAt }` |
| `lastEmailStateAction`   | text                                      | action ledger (idempotency) — last write-back applied             |
| `lastEmailStateActionAt` | timestamptz                               |                                                                   |

Indexes: `attachment_subject_idx` on `(subjectType, subjectId)`; partial-unique
`attachment_source_uq` on `(sourceIntegrationId, externalId)` where `kind = 'email'` (dedup).

### 3.2 `emailSuggestion`

| Column                                      | Type                                                                    | Notes                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `...auditColumns()`                         |                                                                         |                                        |
| `integrationId`                             | text → `integration.id` (cascade)                                       | the Gmail connection                   |
| `externalThreadId`                          | text notNull                                                            | dedup key                              |
| `title` / `description`                     | text                                                                    | synthesized                            |
| `dueDate`                                   | timestamptz                                                             | extracted when stated                  |
| `priority`                                  | `task_priority` enum                                                    | synthesized                            |
| `suggestedProjectId` / `suggestedProgramId` | text (set null)                                                         | routing hints                          |
| `confidence`                                | integer (0–100)                                                         | funnel/auto-accept input               |
| `status`                                    | `email_suggestion_status` enum (`pending` \| `accepted` \| `dismissed`) |                                        |
| `emailMeta`                                 | jsonb                                                                   | snapshot for rendering without a fetch |
| `createdTaskId`                             | text → `task.id` (set null)                                             | set on accept                          |

Indexes: `email_suggestion_org_status_idx` on `(organizationId, status)`; unique
`email_suggestion_thread_uq` on `(organizationId, externalThreadId)` (one suggestion per thread).

### 3.3 `automation_rule`

A first-class, org-scoped table — rules are data, fetched at runtime, editable per row.

| Column              | Type                          | Notes                                                                      |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `...auditColumns()` |                               | `id`, `organizationId`, `createdBy`, timestamps, `archivedAt`              |
| `name`              | text notNull                  | human label                                                                |
| `enabled`           | boolean notNull default true  | per-rule on/off                                                            |
| `on`                | jsonb notNull                 | event match — `{ kind?, subjectType? }` against the observation vocabulary |
| `when`              | jsonb notNull                 | the `Predicate` Composite tree (declarative condition)                     |
| `then`              | jsonb notNull                 | ordered `ActionSpec[]` — `{ type, params }` commands                       |
| `isSeed`            | boolean notNull default false | distinguishes shipped-default rows from user-authored                      |

Indexes: `automation_rule_org_idx` on `(organizationId)`; partial `automation_rule_enabled_idx` on
`(organizationId)` where `enabled`. **Default rules ship as seed rows** (a seed step), never as code
branches. The **funnel confidence threshold** is a runtime config value (org/integration config),
also not a literal.

## 4. Wire DTOs (`packages/types/src`)

New slice files, colocating schema + types (no `*-types.ts`):

- `attachment.ts` — `AttachmentKind`, `AttachmentSubjectType`, `AttachmentCreate`, `AttachmentOut`,
  `AttachmentRemoved`. Add `AttachmentId` to `primitives.ts`. Surface `attachments: AttachmentOut[]`
  on `TaskDetail` (`task.ts`).
- `email-suggestion.ts` — `EmailSuggestionOut`, `EmailSuggestionStatus`, `SuggestionAcceptBody`
  (optional field overrides applied at accept time), `SuggestionDismissed`.
- `automation.ts` — `AutomationEventMatch` (`on`), `Predicate` (the `when` Composite grammar),
  `ActionSpec` (the `then` Command), `AutomationRule`, `AutomationRuleOut`/`Create`/`Update`. The
  predicate grammar is fixed; the data it carries is open.

**DTO rules** (project memory): never combine `.nullable().optional()` — pick one; ban hidden
`??`/`||` defaults.

## 5. The Connector port: a mail-actions capability (`packages/boundaries`)

Gmail is read-only today; write-back is added as a **capability discovered exactly like
`asWritable()`** — no disruption to existing providers.

```ts
// ports/connector.ts
interface Connector {
  // …existing…
  asMailActor?(): MailActions | undefined; // undefined for non-mail providers
}

type MailAction = 'archive' | 'markRead' | 'markUnread' | 'applyLabel' | 'removeLabel' | 'trash';

interface MailActions {
  applyMailAction(input: {
    provider: ConnectorProvider;
    connectionId: string;
    threadId: string;
    action: MailAction;
    label?: string;
  }): Promise<void>;
  fetchThread(input: { connectionId: string; threadId: string }): Promise<MailThread>;
}
```

- **Real** (`real/connector-google.ts`): `applyMailAction` → Gmail `users.threads.modify` /
  `users.messages.modify` (label add/remove incl. `UNREAD`/`INBOX`) and `threads.trash`;
  `fetchThread` → `threads.get`. Gmail joins write-_capable_ discovery but stays **out of**
  `WRITE_BACK_PROVIDERS` (that set is about _task_ push; mail actions are a separate capability).
- **Mock**: record-only no-op — records the `(threadId, action)` so tests assert intent without I/O.
  Keeps the app runnable against zero external accounts (`selectAdapter` local/test path).

## 6. The pipeline (API + cron)

1. **Ingest sweep** — Gmail pull on a cadence. Reuses `connector-google.ts:importGmail` (already
   lists threads) and the lease/idempotency discipline of `sweepConnectorSync`
   (`integration-sync.ts`). Each new thread → an `observation`, deduped by `(organizationId,
dedupeKey)`.
2. **Funnel (cost control)** — a **cheap classifier** (heuristics or Haiku) scores task-worthiness;
   most mail drops here for ~free. The threshold is a runtime config value (not a literal). Only
   survivors reach synthesis.
3. **Synthesize** — feed the thread to Athena (`createAndRunFromPrompt` → `propose_change`
   `create_task`, model `claude-opus-4-8`). Persist an `emailSuggestion` (+ pending attachment
   drafts). **Full enrichment**: title, description, dueDate, project/program, priority, subtasks.
4. **Automations observe the stream** — every step above emits an `observation`; the automation
   engine (§7) observes that stream and fires matching rules (auto-accept / auto-dismiss / pre-route
   on a `suggestion.created` observation; archive on a `task.completed` observation). The pipeline
   does not call automations directly — it just emits events.
5. **Confirm** — surfaced inline in triage. Accept materializes the task (reusing `capture.ts`
   landing logic: default team, first workflow state, current cycle, caller as assignee), creates
   the attachment rows, and emits an observation that accept-time rules can react to (e.g. remove
   from `INBOX`).
6. **Lifecycle write-back** — driven entirely by rules observing `task.completed` / `task.archived`
   observations for tasks with an email attachment (e.g. archive the thread). The attachment action
   ledger (an idempotency **Decorator** around mail commands) guarantees no double-acting.

## 7. Automation engine — a composition of patterns (no hardcoded policy)

The engine is deliberately **not** a bespoke system with a baked-in event enum, action union, or
default rules. It is a composition of standard GoF patterns so triggers, conditions, and actions are
all open/extensible and **all policy lives in data**, not code.

| Concern                    | Pattern                         | Consequence                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Triggers hear about events | **Observer**                    | The engine observes the existing `observation` stream (`emitObservation` is the Subject's notify; `event-bus.ts` is the in-process Subject). No new event enum — rules match on the observation `kind`/`subject.type` strings already in the system. |
| The `when` condition       | **Composite** + **Interpreter** | `Predicate` is a Composite tree (`and`/`or`/`not` nodes over `eq`/`neq`/`contains`/`gte`/`lte` leaves on JSON paths). A small Interpreter evaluates it against the observation. The grammar is fixed; the conditions are data.                       |
| The `then` actions         | **Command**                     | Each `ActionSpec { type, params }` is a Command — a request as data, decoupled from its receiver.                                                                                                                                                    |
| `type` → handler           | **Strategy** + registry         | Handlers register by `type` string (`mail.archive`, `suggestion.autoAccept`, `suggestion.dismiss`, `task.route`, …). Adding an action = `registerActionHandler`, never a core edit.                                                                  |
| Gmail verbs                | **Adapter**                     | `MailActions` (§5) adapts a generic `mail.*` command to Gmail's real API. The closed verb set reflects reality, not policy.                                                                                                                          |
| Don't act twice            | **Decorator**                   | A ledger-checking Decorator wraps mail commands, reading/writing `attachment.lastEmailStateAction*`, so idempotency isn't copy-pasted into handlers.                                                                                                 |

**The pure core** (exhaustively unit-tested) is the Interpreter:

```ts
/** Evaluate a declarative predicate against an observation. Pure — no I/O. */
function evaluate(predicate: Predicate, event: ObservationView): boolean;
```

**The dispatcher** is generic and knows nothing about email or mail verbs:

```ts
/** For one observation: match enabled rules → Interpret `when` → dispatch each `then` Command. */
async function runAutomations(
  event: ObservationView,
  rules: AutomationRule[],
  registry: Registry,
): Promise<void>;
```

**Trigger delivery** is synchronous through the existing internal-event path now (Observer reacting
after the observation commits); the delivery mechanism sits behind the Observer seam, so swapping to
a durable async drain later does not touch the engine.

**Defaults are data, not code:** the shipped rules (e.g. dismiss `category:promotions`, archive the
thread on `task.completed`) are **seed rows** (`isSeed = true`) a user edits or deletes. The funnel
confidence threshold is a runtime config value. Nothing in this section is a literal in a code
branch — that is the whole point.

## 8. API routes (`apps/api/src/routes`)

- `attachments.ts` — mounted under tasks: `GET /tasks/:id/attachments`, `POST` (create a `url`/
  `email` attachment), `DELETE /:attachmentId`. Tenant isolation via existing `loadTask` /
  `assertRefInOrg` helpers.
- `email-suggestions.ts` — `GET` (pending queue), `POST /:id/accept`, `POST /:id/dismiss`.
- `automation-rules.ts` — CRUD over the `automation_rule` table (list/create/update/enable/delete),
  tenant-scoped. Seed defaults are normal rows surfaced here.
- A new secret-guarded, lease-guarded cron endpoint (or an extension of `sync-connectors`) for the
  Gmail ingest+synthesize sweep, same shape as the sweeps in `cron.ts` (`now` injected).

## 9. UX (`apps/web`)

- **Triage suggestions lane** — extend `use-triage.ts` + triage components with a distinct
  "Suggested by Athena" lane. Each row: synthesized task + collapsible email preview, with
  **accept / edit-then-accept / dismiss**. Accepting drops the suggestion and the materialized task
  flows into the normal queue. Machine-proposed provenance is always visible.
- **Task detail** — an attachments section. Email card: sender/subject/snippet, expand thread via
  on-demand `fetchThread`, open-in-Gmail. URL card: title/favicon/link. Honor the _no view-swapping_
  rule — fluid transitions, stable `view-transition-name`.
- **Settings** — automations editor under the integrations tab (`integrations-config.ts` already
  maps Gmail to a Mail icon).

## 10. Privacy & cost (scope is "whole inbox")

- Strictly **opt-in**: runs only for an org with a connected Gmail integration that enables
  email-to-task.
- The **two-stage funnel** bounds cost — cheap classifier first, Opus only on survivors.
- Store **minimal** email data (metadata + snippet); fetch full bodies **on demand** — never persist
  full bodies.
- Write-back is gated behind user-owned automation rules; the attachment action ledger prevents
  double-acting.

## 11. Build phases

1. **Attachment foundation** — `attachment` table + DTOs + `attachments.ts` + task-detail UI for the
   `url` kind. Proves the abstraction end-to-end, zero Gmail risk.
2. **Gmail mail-actions capability** — `MailActions` port + Google adapter + mock; render an `email`
   attachment with on-demand fetch.
3. **Suggestion + ingest/synthesize pipeline** — `emailSuggestion` table, sweep, triage lane,
   accept/dismiss.
4. **Automation engine** — `automation_rule` table + `evaluate`/`runAutomations` + Strategy
   registry of action handlers (`mail.*`, `suggestion.*`, `task.*`), Observer hook into the
   observation stream, idempotency Decorator, seed default rows, and the rules settings editor.

Each phase is independently shippable and testable; ordering puts the riskiest external surface
(Gmail writes) behind a working read-only core.

## 12. Verification

- **Unit**: the predicate Interpreter (`evaluate`) across every Composite node and leaf op against
  representative observations; the Strategy registry (unknown `type` → no-op + logged); attachment
  dedup; suggestion-accept → task materialization.
- **Boundary**: mock `MailActions` records the right ops on `task.completed`; real Google adapter
  shape-tested. App runs against mocks with zero external accounts.
- **Integration (API)**: `attachments.ts` + `email-suggestions.ts` route tests (tenant isolation,
  accept/dismiss, idempotent re-sweep doesn't duplicate). Extend
  `apps/api/tests/routes/harness.test.ts`.
- **E2E / manual**: seed the Gmail mock with fixture threads → run the sweep → a suggestion appears
  in triage → accept → task with email attachment exists → complete → mock records an `archive`.
- **PGlite caution**: dev DB is single-writer embedded PGlite — stop `pnpm dev` before any seeding
  sweep.

## 13. Out of scope for v1 (documented future)

- Real-time push via Gmail Pub/Sub `watch` + a `RealGmailObserver` + `/v1/ingest/gmail`. The
  pipeline is designed so push swaps in for the pull sweep without re-architecting.
- Additional attachment kinds: `file` (via the existing `BlobStore` port), `drive`.
- Replying to email from within Docket.
