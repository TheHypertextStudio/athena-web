# Activity Feed — the canonical cross-tool Event substrate

> **Status**: implemented (Phase 1); assistant consumers (Phase 2) in progress.
> **Supersedes**: the old `observation` / ambient-context-intelligence substrate.
> **Also the internal reporting bus**: tracking, inbound mail, elicitations, agent milestones and
> metadata changes all report through it — see [The reporting vocabulary](#the-reporting-vocabulary).

## What it is, for a person

You work across many tools — Docket, Linear, GitHub, Google Calendar, Gmail, and Google Tasks. The feed gives
you _one place_ showing everything that concerns you, from every tool, in plain language
("Dani replied on your project", "you were assigned a pull request", "you received a Gmail signal"). Two properties make it good:

- **Similar things look the same regardless of source.** A Docket task, a Linear issue, and a
  GitHub PR are all _"a piece of work"_ — they render through one row, with a small badge for
  the tool they came from. No learning three layouts for the same thing.
- **Athena (the assistant) helps on top, but the feed stands on its own.** The assistant is a
  _consumer_ layered over the feed, never part of its plumbing.

## The model — one shape for "something happened"

Every event, from any tool (internal Docket action or external webhook), is translated at its
entry point into one canonical shape: **who** (`actor`) did **what** (`kind`) to **which
thing** (`entity`), **when** (`occurredAt`), **from where** (`source`), plus an optional typed
tool-specific pocket (`detail`).

| Axis        | Type (`@docket/types`)                                                      | Notes                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verb        | `EventKind`                                                                 | closed enum: created/status*change/completed/comment/mention/assignment/reaction/message/calendar*\*, plus the `timer_*`, `elicitation_*` and `agent_*` families and `email_received`/`field_change` (see [The reporting vocabulary](#the-reporting-vocabulary)) |
| which thing | `EntityRef { kind, source, externalId, title?, url?, docketEntityId? }`     | `kind` is the closed `CanonicalEntityKind` — a Docket task, Linear issue, GitHub PR all map to `work_item`; this is what lets analogous things share one row                                                                                                     |
| from where  | `SourceSystem { system, integrationId?, externalUrl? }`                     | typed attribution, replacing a free-text `provider` string                                                                                                                                                                                                       |
| who         | `ActorRef { source, externalId, displayName?, avatarUrl?, docketActorId? }` |                                                                                                                                                                                                                                                                  |
| detail      | `EventDetail` (closed discriminated union on `schema`)                      | typed per source (`linear.issue`, `github.pull_request`, `docket.state_change`) **plus a `generic` variant** so an unmapped-but-valid event still surfaces (degraded) instead of being dropped; the raw original stays in `inbound_event` for re-enrichment      |

`docketEntityId` / `docketActorId` resolve an external ref to its Docket twin. Both are filled
now — actors through `resolveExternalActor`, entities through `resolveExternalEntities`, which
matches an external subject against `task`, `project` and `cycle` on their
`(sourceIntegrationId, externalId)` mirror index, scoped to the delivering integration.

The resolved **entity** id lives on the event row as `event.docket_entity_id`, not inside the
`entity` jsonb, for two reasons. "Everything that happened to this thing, across every tool" is a
headline read and wants a btree index a jsonb probe cannot use; and four consumers read the jsonb
field, so filling it in would have been indistinguishable from switching all four on at once —
owner fan-out, search reindex, activity-document visibility and automation subject matching each
had to land separately. `event.entity_association` records how far resolution got: `pending` means
Docket could mirror this kind and has not yet (a re-association sweep retries these), `unmatched`
means no Docket table represents the kind at all, so a Slack thread is never re-checked. A CHECK
constraint ties `matched` to a non-null id in both directions.

Association is not retroactive for the **search index**: an activity document keeps the visibility
it was projected with. Reprojecting existing rows is an operator step, enqueue-only and safe to
repeat, run against the target database rather than from CI:

```bash
DATABASE_URL=<target> pnpm tsx scripts/search-backfill.ts event
```

**Storage** (`@docket/db` `event` table): canonical columns are lean; `source_system` /
`integration_id` / `external_url` are flat columns (queried/joined); `entity_kind` is
denormalized from `entity.kind` for the headline filter "all `work_item` activity across
tools". One `event` log holds internal + external — legitimized by the _real shared contract_
above, not by a discriminator. The old near-dead `audit_event` stays a **separate compliance
ledger**; the feed reads `event` only.

## The reporting vocabulary

Five features report through this bus, and they share one vocabulary rather than each inventing
their own. A verb earns its own `EventKind` only when a consumer must branch on it **without
decoding `detail`** — routing, notification policy, feed filters and automation `on` matchers all
read `kind` alone. Everything finer-grained rides in the typed `detail` arm, and no arm ever
restates the verb, so the two can never contradict each other.

| Feature                | Kinds                                                                                     | Subject (`EmitSubject.type` → `EntityRef.kind`)                                 | Detail arm               |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------ |
| Universal timer        | `timer_started` · `timer_paused` · `timer_resumed` · `timer_switched` · `timer_stopped`   | the tracked entity (`task` → `work_item`, …), or `time_record` (no `EntityRef`) | `docket.timer`           |
| Athena's inbound email | `email_received`                                                                          | `inbound_message` → `message`                                                   | `docket.inbound_email`   |
| Elicitations           | `elicitation_requested` · `elicitation_answered` · `elicitation_expired`                  | `agent_session` → `agent_session`                                               | `docket.elicitation`     |
| Spawned agents         | `agent_started` · `agent_progress` · `agent_blocked` · `agent_completed` · `agent_failed` | the work being done, else `agent_session`                                       | `docket.agent_milestone` |
| Task metadata changes  | `field_change`                                                                            | the edited entity (`task` → `work_item`, …)                                     | `docket.field_change`    |

Decisions worth stating once, because each is easy to get wrong independently:

- **A switch is one event.** `timer_switched` replaces a stop + start pair, so elapsed time can
  never be counted twice; the record left behind rides in `detail.previousTimeRecordId`.
- **A timeout is not an answer.** `elicitation_expired` is distinct from `elicitation_answered`
  and is emitted with **no actor** — nobody acted, a clock fired — so "a human decided this"
  stays provable after the fact.
- **One `field_change` per mutation, never per field.** Five fields moving in one edit would
  otherwise multiply notifications, live pushes, automation runs and reindex jobs by five; the
  whole edit travels as one row whose `detail.changes` carries every field, with
  `detail.fields` denormalized so a rule can match `contains 'dueDate'`. State transitions and
  assignments keep their own kinds (`status_change`, `completed`, `assignment`) and are never
  also reported as field changes. The durable per-entity history still lives in `audit_event`;
  both write the same `TaskActivityChange` shape, so the log and the feed cannot diverge.
- **Every agent reports through the same five verbs**, whether it is Athena, a registered
  third-party agent, or a subagent Athena spawned — which is what makes a consumer written today
  render an agent nobody has built yet.

### Recipient routing rules

`consumers/routing.ts` stays the only place that answers "who does this concern". Two policies sit
above its per-entity-kind registry:

- **Personal kinds** (`PERSONAL_EVENT_KINDS` — tracking) route to the acting person and to nobody
  else. A timer transition still lands on the tracked task so the item's own history reads
  correctly, but the task's assignee, lead and followers never see it: nobody gets a feed line
  because a colleague started a stopwatch. Athena still observes every one of them off the live bus.
- **Direct recipients** are delivered verbatim, exempt from the "never surface your own action to
  yourself" rule. A personal Athena run acts _as_ its owner, so its Actor resolves to that same
  user and ordinary routing would drop the one person who must answer its question. Producers use
  this only when they know the audience by construction; ambient relevance stays the router's job.

`StreamRelevance` gains `awaiting_you`, the strongest reason there is: work has **halted** until
this person acts. Only `elicitation_requested` and `agent_blocked` use it. `agent_progress`
addresses nobody at all — it belongs to the live stream and the session view, not to a personal
feed that would drown in it — while still being recorded and still reaching every live observer.

### Emitting one

A feature never assembles an event by hand. It calls its typed producer in
`apps/api/src/routes/event-emit.ts` (`emitTimerEvent`, `emitInboundEmail`,
`emitElicitationEvent`, `emitAgentMilestone`, `emitFieldChange`), each of which composes the
`kind`, subject, detail arm and recipients this contract specifies and forwards to the shared
`emitEvent` Facade. `emitEvent` itself remains available for domain events that already have a
kind (`created`, `completed`, `assignment`, …).

Dedupe is `(organizationId, subject, kind, occurrence-millisecond, dedupeToken)`. The optional
`dedupeToken` exists because millisecond resolution is right for domain events — emitting "task
completed" twice must collapse — and wrong for a legitimate burst, such as parallel subagents
reporting inside the same millisecond. It must always be a _stable_ discriminator, never a random
value, or dedupe stops protecting anything.

## Bounded contexts (one-way dependencies; the substrate never imports a consumer)

```
Ingestion (raw)        Internal emit
  inbound_event   ┐      event-emit.ts (Facade)
  observer port   ┘            │
        │  (Adapter+Strategy)  │
        ▼                      ▼
        └────►  event log  ◄───┘
                   │  (commit) ──► live bus (event-bus.ts → SSE)
                   ▼
           routing.ts (one resolver) ──► event_recipient
                   │
   feed reads ─────┴───────────────► stream.ts (firehose) · hub.ts /stream (personal)
   consumers (Phase 2): proactive drafting · notifications · multi-cadence summaries
```

## Design patterns (the structural backbone)

| Seam                                           | Pattern                     | Where                                                                              |
| ---------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| Per-tool source translation                    | **Adapter**                 | `packages/integrations/src/observer-*.ts` behind the `Observer` port               |
| Picking the translator by `source.system`      | **Strategy (registry)**     | `apps/api/src/container.ts` chooses the observer for each provider                 |
| `normalize`: typed detail builders → `generic` | **Chain of Responsibility** | inside each adapter's `normalize`                                                  |
| Substrate → consumers on commit                | **Observer / pub-sub**      | `apps/api/src/lib/event-bus.ts`                                                    |
| Per-entity-kind relevance routing              | **Strategy (registry)**     | `apps/api/src/consumers/routing.ts` (`OWNER_RULES` keyed on `CanonicalEntityKind`) |
| The append helper                              | **Facade**                  | `apps/api/src/routes/event-emit.ts` (`emitEvent`)                                  |
| Per-feature typed emission                     | **Factory Method**          | `event-emit.ts` producers (`emitTimerEvent`, `emitAgentMilestone`, …)              |
| Live delivery (poll now / SSE / NOTIFY later)  | **Bridge**                  | `stream-helpers`/`stream-sse` ↔ `event-bus`                                        |
| Pagination                                     | **Iterator**                | `apps/api/src/lib/list-cursor.ts` keyset cursor                                    |
| Drafted approval-gated agent actions (Phase 2) | **Command**                 | `session_activity` + `approval_status`                                             |

Deliberately **not** used (pattern-itis avoided): Visitor for kind-rendering (a `switch` on the
canonical kind suffices), Mediator (it's one-way fan-out), Decorator/Memento/Flyweight/Composite.
Governing principle: a registry of functions or a discriminated union + exhaustive `switch`,
never a class hierarchy when the variation is data-shaped.

## Adding a new internal producer

A Docket feature that wants to report joins the existing vocabulary before it invents one. In
order: (1) can an existing `kind` say it? Use it. (2) Does a consumer need to branch on it without
reading `detail`? Then it earns a `kind` — appended to `EventKind` in `@docket/types` **and** to
the `event_kind` pg enum in the same order, with an additive `ALTER TYPE … ADD VALUE` migration
(never a rename, never a removal: stored rows must keep parsing, and a migration that adds an enum
value must not also _use_ it — Postgres rejects that inside one transaction). (3) Add **one**
`EventDetail` arm, namespaced `docket.<feature>`, holding only what a consumer needs; anything
else belongs in the feature's own tables. (4) Add a typed producer in `event-emit.ts` so the
routing and dedupe decisions live here rather than at every call site. (5) If the subject is a new
kind of thing, add it to `CanonicalEntityKind` and give it an `OWNER_RULES` entry — an entity kind
with no rule simply yields no owners, which degrades rather than breaking.

## Adding a new tool (the scale payoff)

Touches only leaves: (1) an observer **Adapter** under `packages/integrations/src/` with its
detail-builder chain ending in `generic`; (2) a mapping from the active provider's native object
types onto the closed `EntityRef.kind` taxonomy inside that adapter. External-only entities are
covered by `routing.ts`'s default (no-owner) rule — **zero core changes** to consumers, routing,
the feed, pagination, or the assistant. The active external observers are GitHub and Linear;
Gmail and Google Calendar contribute through connector sync and the shared activity model.
