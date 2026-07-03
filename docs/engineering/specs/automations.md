# Automations

> **Status**: Engine + wiring shipped (M1); generic action handlers, enablement, and rule
> seeding-on-toggle shipped (M5). A visual rule builder is a later milestone.
> **Last Updated**: 2026-07-02
> **Owners**: Platform
> **Supersedes**: `email-to-task.md` §7, which described the engine when it was email-only.
> This spec is canonical for the app-wide system.

Automations let an organization declare **rules as data** — `{ on, when, then }` — that react
to anything happening in Docket: internal domain events (a task completed, a suggestion
created) and external events arriving through integrations (a Linear issue, a GitHub PR, a
Slack message). No policy lives in code: adding a trigger, condition, or action never edits
the engine.

## 1. Architecture at a glance

```
 emitEvent (internal)  ──┐                          ┌─→ matches(on)      [engine.ts]
                         ├─→ projection  ──→ rules ─┼─→ evaluate(when)   [predicate.ts]
 sweepInboundEvents ─────┘   [runtime.ts]           └─→ dispatch(then)   [registry.ts]
 (external drain)                                        └─→ action handlers [handlers.ts]
```

- **Observer** — both event write paths call `runAutomationsForEvent` immediately after the
  canonical `event` row commits (`apps/api/src/routes/event-emit.ts` for `docket`-source
  events, `apps/api/src/routes/event-sync.ts` for drained external webhooks). Firing is
  once-per-committed-event: duplicate inserts (dedupe-key conflicts) never fire.
- **Projection** — the engine never reads raw emit inputs or DB rows; each write path
  projects into one canonical `AutomationEvent` shape (`apps/api/src/lib/automation/event.ts`).
- **Interpreter** — `when` is a Composite predicate tree evaluated over the projected event
  (`predicate.ts`).
- **Strategy registry** — `then` actions are Commands dispatched by `type` to registered
  handlers (`registry.ts`, `handlers.ts`). An unregistered action is a logged no-op, never a
  throw.

## 2. The `AutomationEvent` projection

Defined in `apps/api/src/lib/automation/event.ts`. Every predicate path and `on` field
resolves against this shape — it is the **only** contract rule authors program against.

| Field            | Type   | Populated by                          | Meaning                                                                                                                                                                                                            |
| ---------------- | ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `organizationId` | string | both                                  | Rule scoping — rules only ever see their own org's events.                                                                                                                                                         |
| `kind`           | string | both                                  | The canonical event verb (`created`, `completed`, `status_change`, `assignment`, `comment`, …).                                                                                                                    |
| `source`         | string | both                                  | Origin tool: `docket` for internal emits; `linear` / `github` / `slack` / … for drained events.                                                                                                                    |
| `subjectType?`   | string | internal; external only when resolved | Docket entity type (`task`, `email_suggestion`, `project`, `initiative`, `cycle`, …).                                                                                                                              |
| `subjectId?`     | string | with `subjectType`                    | The Docket entity id.                                                                                                                                                                                              |
| `entityKind?`    | string | when known                            | Canonical kind (`work_item`, `project`, `program`, `initiative`, `cycle`, `thread`, `message`, …) — how rules address external events, since a Linear issue and a Docket task both project as `work_item`.         |
| `subjectTitle?`  | string | when known                            | Display title.                                                                                                                                                                                                     |
| `detail`         | record | both; `{}` when none                  | The event's typed `EventDetail` pocket, flattened. E.g. `detail.category` / `detail.confidence` on `docket.email_suggestion`, `detail.toState` on `docket.state_change`, `detail.merged` on `github.pull_request`. |
| `actorId?`       | string | internal                              | The acting Docket actor.                                                                                                                                                                                           |
| `occurredAt`     | Date   | both                                  | Injected firing time (handlers never call `Date.now()`).                                                                                                                                                           |

**The two write paths** (`apps/api/src/lib/automation/runtime.ts`):

- `projectEmitInput(input, occurredAt)` — internal events. `source: 'docket'`;
  `subjectType`/`subjectId` from the emit subject; `entityKind` via the shared
  `DOCKET_ENTITY_KIND` map (`@docket/types`).
- `projectInboundDraft(input)` — drained external events. `subjectType`/`subjectId` are
  present only when enrichment resolved the external entity to a Docket one; otherwise rules
  address the event via `source` + `entityKind` + `detail.*`.

## 3. Rule grammar

Rules are stored per-org in `automation_rule` (columns `eventMatch`/`condition`/`actions`)
and evaluated as `{ on, when, then }` (`packages/types/src/automation.ts`). CRUD is
`/v1/orgs/:orgId/automation-rules` (`apps/api/src/routes/automation-rules.ts`,
capability-guarded `manage`).

### `on` — event match

```jsonc
{ "kind": "completed", "subjectType": "task" }          // internal addressing
{ "kind": "completed", "entityKind": "work_item" }      // any source, incl. external
{ "source": "github", "kind": "status_change" }         // one source
{}                                                        // every event
```

Every present field must equal the event's value; an absent field is a wildcard.

### `when` — predicate (Composite / Interpreter)

```
Predicate := { op: 'and'|'or', nodes: Predicate[] }
           | { op: 'not', node: Predicate }
           | { op: 'eq'|'neq'|'contains'|'gte'|'lte', path: string, value: string|number|boolean }
```

`path` is a dotted path into the projected event (`detail.category`, `kind`,
`subjectTitle`). `contains` handles array-includes and substring; `gte`/`lte` are
number-only; `and` over `[]` is vacuously true (the "always" condition), `or` over `[]` is
false.

Examples:

```jsonc
{ "op": "eq", "path": "detail.category", "value": "promotions" }
{ "op": "and", "nodes": [
  { "op": "eq", "path": "entityKind", "value": "work_item" },
  { "op": "gte", "path": "detail.confidence", "value": 70 }
]}
```

### `then` — actions

An ordered list of Commands: `{ type: string, params: object }`. The engine dispatches each
to the registry; execution order is the list order; a failed action does not stop later ones
at the rule level (the whole run is best-effort — see §5).

## 4. Action catalog

Registered in `buildAutomationRegistry` (`apps/api/src/lib/automation/handlers.ts`). Every
handler validates its params and **no-ops loudly** (returns without effect) on a wrong
subject type or invalid params — rules can never throw domain errors.

| Type                                   | Params              | Subject            | Behavior                                                                                           | Idempotency                                                  |
| -------------------------------------- | ------------------- | ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `mail.archive`                         | `{}`                | `task`             | Archives the source email of the task's email attachment(s) via the integration's mail capability. | `attachment.lastEmailStateAction` ledger (last-action-wins). |
| `mail.markRead` / `mail.markUnread`    | `{}`                | `task`             | Read-state on the source thread.                                                                   | ledger                                                       |
| `mail.trash`                           | `{}`                | `task`             | Trashes the source thread.                                                                         | ledger                                                       |
| `mail.applyLabel` / `mail.removeLabel` | `{ label: string }` | `task`             | Provider label/category on the source thread; no-op without `label`.                               | ledger                                                       |
| `suggestion.dismiss`                   | `{}`                | `email_suggestion` | Sets the firing suggestion `pending → dismissed`.                                                  | status guard (`pending` only)                                |

| `task.setStatus` | `{ state: string }` | `task` | Moves the task to the workflow state via the shared transition lib (`lib/task-state.ts` — the same implementation as `POST /tasks/:id/status`; terminal states derive `completedAt`/`canceledAt`). Unknown state key → logged no-op. | shared lib; emitted event doesn't cascade (depth-1 cap) |
| `task.assign` | `{ assigneeId: string }` | `task` | Assigns to an **org** actor (cross-tenant ids are refused); emits `assignment`. | org-scope check |
| `task.setPriority` | `{ priority: Priority }` | `task` | Sets priority; params validated against the `Priority` enum. | last-write-wins |
| `task.applyLabel` | `{ labelId: string }` | `task` | Attaches an **org** label via the task-label join. | join PK + `onConflictDoNothing` |
| `notification.send` | `{ to: 'actor'\|'taskAssignee', title, summary? }` | any (task for `taskAssignee`) | Writes an `automation`-type inbox notification to the resolved user; links to the task when the subject is one. Agent actors (no user) → no-op. | inbox row per firing |
| `suggestion.autoAccept` | `{}` | `email_suggestion` | Materializes the pending suggestion through the shared accept lib (`lib/email-to-task/accept.ts` — the same path as the accept route: landing, email attachment, event). Non-pending → logged no-op. | `pending`-status guard |

All mutating handlers reuse the **shared lib mutations** (`setTaskState`, `acceptSuggestion`)
so route behavior and automation behavior cannot diverge; events they emit are recorded and
fanned out but never trigger another rule pass (§5's depth-1 cap). `comment.create` remains
deliberately unimplemented — no shipped rule needs it, and polymorphic comment creation
(mention parsing, subject fan-out) adds surface without a driver.

### Shipped default rules (seeded, editable data — `rules-store.ts`)

1. **Archive the email when its task is completed** — `on {kind: completed, subjectType: task}`,
   `when` always, `then [mail.archive]`.
2. **Dismiss promotional email suggestions** — `on {kind: created, subjectType: email_suggestion}`,
   `when detail.category == 'promotions'`, `then [suggestion.dismiss]`.

Seeded once per org (`seedDefaultAutomationRules`, idempotent) as `isSeed` rows the user may
edit or delete.

## 5. Execution guarantees

- **Inline, post-commit, best-effort.** Rules run in-process immediately after the event
  row commits, inside the same never-throw envelope as the rest of the awareness path. A
  handler failure is logged (`[automation] rule run failed`) and never rolls back or 500s
  the domain mutation. Delivery is therefore **at-most-once**.
- **Once per committed event.** Duplicate emits (same dedupe key) don't insert and don't fire.
- **Depth-1 cascade cap (re-entrancy guard).** Handlers may emit events themselves; those
  events are recorded and fanned out normally but do **not** trigger another rule pass. An
  `AsyncLocalStorage` marker in `runtime.ts` suppresses nested `runAutomationsForEvent`
  calls, so `on completed → task.setStatus(done)` can never self-loop.
- **Mutating actions carry their own idempotency** (the mail ledger, status guards), so an
  occasional re-fire after a partial failure is safe.
- **Durable-drain seam.** Both call sites are one-line calls behind the projection
  functions. Swapping to a checkpointed async consumer (`apps/api/src/consumers/`) that
  reads committed `event` rows — at-least-once, lease-guarded like the inbound-event drain —
  replaces those two lines and touches nothing else. That is the intended evolution once a
  mutating action needs stronger guarantees than best-effort.

## 6. How to add a trigger

There is no trigger registry — **every `emitEvent` call site is already a trigger.** To make
a new domain event automatable:

1. Emit it: `emitEvent({ organizationId, kind, subject: { type, id, title }, detail?, … })`.
2. If it carries rule-relevant data, add a typed arm to `EventDetail`
   (`packages/types/src/event.ts`) rather than overloading `generic` — one new union arm, no
   migration.
3. Document the new `kind` × `subjectType` (and any `detail` paths) in §7's vocabulary table.

External events are automatable the moment an Observer normalizes them — the drain hook
projects every drafted event automatically.

## 7. Event vocabulary (what rules can match on today)

| `kind`                       | `subjectType` (internal)                                      | Emitted from                                       |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| `created`                    | `task`                                                        | task create; suggestion accept                     |
| `created`                    | `email_suggestion`                                            | synthesis (with `detail: docket.email_suggestion`) |
| `created`                    | `project`, `initiative`                                       | create routes                                      |
| `completed`, `status_change` | `task`                                                        | status routes (with `detail: docket.state_change`) |
| `status_change`              | `project`, `initiative`, and polymorphic via updates          | status/update routes                               |
| `assignment`                 | `task`                                                        | create/update with assignee                        |
| `comment`                    | polymorphic (`task`/`project`/`program`/`initiative`/`cycle`) | comments                                           |

External (via drain): `source ∈ {linear, github, slack, google_calendar}` with
`entityKind ∈ {work_item, thread, message, calendar_event, …}` and per-tool `detail` arms
(`linear.issue`, `github.pull_request`, `slack.message`).

## 8. How to add an action

1. Implement a handler `{ type, run(ctx, params) }` in
   `apps/api/src/lib/automation/handlers.ts` (or a sibling module) — validate `params` with a
   colocated Zod schema; read the event via `ctx.event`; guard the subject type; no-op on
   anything invalid.
2. Register it in `buildAutomationRegistry`. That's it — the engine, grammar, and storage
   never change.
3. Give it idempotency appropriate to its side effect (ledger stamp, status guard,
   `onConflictDoNothing`).
4. Add it to the catalog table in §4 and cover happy path + no-op guards in
   `apps/api/tests/routes/automation-engine-db.test.ts`.

## 9. Testing

- Pure: `apps/api/tests/lib/automation/{engine,predicate}.test.ts` (matcher + grammar),
  projection tests.
- DB: `apps/api/tests/routes/automation-engine-db.test.ts` (handlers against PGlite with a
  recording mail applier).
- Wiring: `event-emit`/`event-sync` tests assert a seeded rule's side effect fires from each
  write path, and that the re-entrancy cap holds.

All layers run with zero external accounts (mock connector / recording appliers).
