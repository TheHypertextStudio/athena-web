# Activity Feed — the canonical cross-tool Event substrate

> **Status**: implemented (Phase 1); assistant consumers (Phase 2) in progress.
> **Supersedes**: the old `observation` / ambient-context-intelligence substrate.

## What it is, for a person

You work across many tools — Docket, Linear, GitHub, Slack, calendar, email. The feed gives
you _one place_ showing everything that concerns you, from every tool, in plain language
("Dani replied on your project", "you were assigned a pull request", "you were mentioned in
Slack"). Two properties make it good:

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

| Axis        | Type (`@docket/types`)                                                      | Notes                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verb        | `EventKind`                                                                 | closed enum: created/updated/status*change/completed/comment/mention/assignment/reaction/message/calendar*\*                                                                                                                                                                 |
| which thing | `EntityRef { kind, source, externalId, title?, url?, docketEntityId? }`     | `kind` is the closed `CanonicalEntityKind` — a Docket task, Linear issue, GitHub PR all map to `work_item`; this is what lets analogous things share one row                                                                                                                 |
| from where  | `SourceSystem { system, integrationId?, externalUrl? }`                     | typed attribution, replacing a free-text `provider` string                                                                                                                                                                                                                   |
| who         | `ActorRef { source, externalId, displayName?, avatarUrl?, docketActorId? }` |                                                                                                                                                                                                                                                                              |
| detail      | `EventDetail` (closed discriminated union on `schema`)                      | typed per source (`linear.issue`, `github.pull_request`, `slack.message`, `docket.state_change`) **plus a `generic` variant** so an unmapped-but-valid event still surfaces (degraded) instead of being dropped; the raw original stays in `inbound_event` for re-enrichment |

`docketEntityId` / `docketActorId` are reserved enrichment slots (resolve an external ref to
its Docket twin later); null today.

**Storage** (`@docket/db` `event` table): canonical columns are lean; `source_system` /
`integration_id` / `external_url` are flat columns (queried/joined); `entity_kind` is
denormalized from `entity.kind` for the headline filter "all `work_item` activity across
tools". One `event` log holds internal + external — legitimized by the _real shared contract_
above, not by a discriminator. The old near-dead `audit_event` stays a **separate compliance
ledger**; the feed reads `event` only.

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
| Per-tool source translation                    | **Adapter**                 | `packages/boundaries/src/real/observer-*.ts` behind the `Observer` port            |
| Picking the translator by `source.system`      | **Strategy (registry)**     | `packages/boundaries/src/select.ts` (`Record<system, factory>`)                    |
| `normalize`: typed detail builders → `generic` | **Chain of Responsibility** | inside each adapter's `normalize`                                                  |
| Substrate → consumers on commit                | **Observer / pub-sub**      | `apps/api/src/lib/event-bus.ts`                                                    |
| Per-entity-kind relevance routing              | **Strategy (registry)**     | `apps/api/src/consumers/routing.ts` (`OWNER_RULES` keyed on `CanonicalEntityKind`) |
| The append helper                              | **Facade**                  | `apps/api/src/routes/event-emit.ts` (`emitEvent`)                                  |
| Live delivery (poll now / SSE / NOTIFY later)  | **Bridge**                  | `stream-helpers`/`stream-sse` ↔ `event-bus`                                        |
| Pagination                                     | **Iterator**                | `apps/api/src/lib/list-cursor.ts` keyset cursor                                    |
| Drafted approval-gated agent actions (Phase 2) | **Command**                 | `session_activity` + `approval_status`                                             |

Deliberately **not** used (pattern-itis avoided): Visitor for kind-rendering (a `switch` on the
canonical kind suffices), Mediator (it's one-way fan-out), Decorator/Memento/Flyweight/Composite.
Governing principle: a registry of functions or a discriminated union + exhaustive `switch`,
never a class hierarchy when the variation is data-shaped.

## Adding a new tool (the scale payoff)

Touches only leaves: (1) an observer **Adapter** under `packages/boundaries/src/real/` with its
detail-builder chain ending in `generic`; (2) one new arm on the `EventDetail` union + the new
`system` string in `ObserverProvider`/`source_system`; (3) a mapping from the tool's native
object types onto the closed `EntityRef.kind` taxonomy inside that adapter. External-only
entities are covered by `routing.ts`'s default (no-owner) rule — **zero core changes** to
consumers, routing, the feed, pagination, or the assistant.
