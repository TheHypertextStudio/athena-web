# Docket is the hub

> **Requirement:** GEN-18 (launch-blocker) — "Docket must act architecturally as the hub for all
> productivity work — every integration passes through Docket rather than connecting external
> systems to each other."
>
> **Acceptance:** "An architecture document names Docket as the hub and inventories every connector;
> for each connector, code inspection shows it reads/writes Docket's canonical entities, and there is
> zero code path where two external systems exchange work data without a Docket entity in between."

---

## The claim

**Docket is the hub for all productivity work.** Every external system attaches to Docket as a spoke,
and no two spokes touch. Work data entering Docket from any external system lands in a Docket
canonical entity before anything else happens to it; work data leaving Docket for any external system
is read out of a Docket canonical entity. There is no adapter, no sync, and no automation that pipes
one provider's payload to another provider.

This is not an aspiration — it is a property the code currently has, and this document records the
inspection that establishes it, with file:line for every claim. Where the property is enforced by a
type or a guard rather than by convention, that is called out, because a guard is what keeps the
property true under future edits.

`docs/engineering/architecture.md` uses the word "Hub" for something else — the personal cross-org
cockpit surface. That is a _product surface_ named Hub; this document is about the _architecture_
being hub-and-spoke. They are different concepts and this sentence exists so nobody conflates them.

---

## Docket's canonical entities

The entities every connector reads and writes. The closed taxonomy lives in
`packages/types/src/event.ts:90–96`:

```ts
export const DOCKET_ENTITY_KIND: Readonly<Record<string, CanonicalEntityKind>> = {
  task: 'work_item',
  project: 'project',
  program: 'program',
  initiative: 'initiative',
  cycle: 'cycle',
};
```

Plus the substrate rows every spoke writes through:

| Entity                             | Table                             | Role                                                           |
| ---------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `task`                             | `packages/db/src/schema` (`task`) | The canonical work item. Every connector's import target.      |
| `event`                            | `event`                           | The canonical activity record. Every observer's target.        |
| `inbound_event`                    | `inbound_event`                   | The durable write-ahead inbox every webhook lands in first.    |
| `integration`                      | `crosscutting.ts:423`             | The org-scoped connection row. Owns the credential binding.    |
| `attachment`                       | `attachment`                      | Binds an external artefact (an email thread) to a Docket task. |
| `calendar_event` / `calendar_item` | calendar schema                   | Canonical calendar rows.                                       |
| `email_suggestion`                 | `email_suggestion`                | Canonical pre-task record for mail-derived work.               |

---

## Connector inventory

Five providers implement the Connector port. The list is a single `as const` tuple, so it is
countable rather than scattered — `packages/types/src/provider-catalog.ts:14`:

```ts
export const CONNECTOR_PROVIDER_IDS = ['gmail', 'gtasks', 'calendar', 'github', 'linear'] as const;
```

`PROVIDER_CATALOG` (`provider-catalog.ts:55–113`) is `satisfies Record<DirectoryProviderId,
ProviderCatalogEntry>`, so adding a provider id without filling in its capability metadata is a
compile error. Likewise `PROVIDER_CLIENT_FACTORIES` (`packages/integrations/src/real-connector.ts:98`)
is `Record<ConnectorProvider, …>`: a new provider forces a client entry at compile time, not a
runtime throw.

### 1 — Work connectors (the Connector port)

| #   | External system | Provider id | Docket entities it reads/writes                     | Proof                                                                             |
| --- | --------------- | ----------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | GitHub          | `github`    | `task` (import + reconcile), `integration`          | `real-connector.ts:80`, `integration-sync.ts:383`, `integration-reconcile.ts:304` |
| 2   | Linear          | `linear`    | `task`, `integration`                               | `real-connector.ts:81`, same spine                                                |
| 3   | Gmail           | `gmail`     | `email_suggestion`, `attachment`, `task`            | `synthesize.ts:140`, `handlers.ts:76–105`                                         |
| 4   | Google Calendar | `calendar`  | `calendar_event`, `calendar_item`, `calendar_layer` | `calendar-sync-engine.ts:469, 575, 628`                                           |
| 5   | Google Tasks    | `gtasks`    | `task` (the only two-way connector)                 | `real-connector.ts:84`, `integration-reconcile.ts:360, 393, 447`                  |

Every one of these goes through **one** spine. `runSync`
(`apps/api/src/routes/integration-sync.ts:332`) wraps `runLeasedSync` (`:275`) and does exactly two
things with provider data:

```
integration-sync.ts:383   const items: ImportedItem[] = await connector.importWork({…});
integration-sync.ts:391   const tally = await reconcileTasks(row.organizationId, opts.actorId, row, teamId, items, {…});
```

`reconcileTasks` (`apps/api/src/routes/integration-reconcile.ts:190`) is where provider payloads
become Docket rows. It selects the integration's existing linked tasks from `task`
(`:212–222`, filtered by `organizationId`, `source='linked'`, `sourceIntegrationId`), plans a per-item
action, and applies it against `task` — `insertLinked` inserts (`:304`), `applyPull` updates (`:332`).
Write-back to the provider is the reverse direction and reads _from_ the Docket row: `pushTask`
(`:360`, `:393`, `:447`) is called with the local task's fields, never with another provider's payload.

Capability is discovered structurally, not by provider name: `asWritable()`
(`real-connector.ts:218`) and `asMailActor()` (`:234`) return `undefined` unless the provider client
implements the corresponding interface. So "who may write back" and "who may act on a mailbox" are
type facts, not string comparisons that could drift.

### 2 — Activity observers (inbound webhooks)

Two are live. `WEBHOOK_PROVIDER_IDS = ['github', 'linear']` (`provider-catalog.ts:19`), and exactly
two ingest routes are registered:

```
apps/api/src/routes/ingest.ts:131   .post('/linear',  (c) => ingestWebhook(c, 'linear'))
apps/api/src/routes/ingest.ts:132   .post('/github',  (c) => ingestWebhook(c, 'github'));
```

mounted at `/internal/ingest` (`apps/api/src/server.ts:96`), outside the public typed API.

The path is strictly two-stage and both stages are Docket entities:

1. **Persist first.** `ingest.ts:111` inserts the raw payload into `inbound_event`, deduped on
   `(provider, externalEventId)` (`:122`). The webhook returns after the durable write; nothing
   provider-facing happens on the request thread.
2. **Normalize into `event`.** The drain (`apps/api/src/routes/event-sync.ts:190`) resolves the
   provider's `Observer` adapter, normalizes to a canonical draft, and inserts an `event` row inside a
   transaction (`:259–281`), fanning out recipients in the same transaction (`:292`).

Two adapters exist in `packages/integrations/src` but are **not wired**, and this inventory records
that rather than implying coverage:

- `observer-slack.ts` — exported from the package index, and Slack OAuth connect exists
  (`apps/api/src/routes/integrations-slack.ts`), but there is no `/slack` ingest route and
  `buildObserver` (`apps/api/src/container.ts:225–236`) has no `slack` case; it throws
  `No active observer implementation for legacy provider`.
- `observer-discord.ts` — present in the package but **not exported** from
  `packages/integrations/src/index.ts` and referenced only by its own test
  (`packages/integrations/tests/observers/observer-discord.test.ts`).

Neither is a hub violation — an unwired adapter moves no data — but calling them "connectors" would
overstate the inventory.

### 3 — Calendar sync modules

One: Google. `createDefaultCalendarSyncModules`
(`apps/api/src/routes/calendar-sync-modules.ts:27`) returns `{ google: createGoogleCalendarSyncModule(input) }`.
The engine (`calendar-sync-engine.ts`) is provider-neutral and writes only Docket calendar rows:
`calendar_layer` (`:469`), `calendar_event` (`:575`), `calendar_item` (`:628`).

### 4 — Remote MCP servers

User-added MCP servers attach as `provider='mcp'` rows on the same `integration` table
(`apps/api/src/routes/integrations-mcp.ts:61–66`, which scopes every lookup by
`organizationId` **and** `provider='mcp'`), with credentials in `integration_credential`. They are
tool surfaces Athena calls, not work-data sync paths: nothing in the MCP router writes `task`,
`project`, or `event`.

### 5 — The Linear Agent platform

A separate inbound edge (`apps/api/src/routes/ingest-linear-agent.ts`, mounted at the same
`/internal/ingest` prefix — `server.ts:101`) that writes Docket's `agent_session` /
`agent_session_run` rows and resolves a mirrored Docket `task` for the session brief
(`ingest-linear-agent.ts:43` imports `agentSession, agentSessionRun, db, integration, task`).

### 6 — Outbound channels (not work-data connectors)

Listed for completeness so the inventory is exhaustive, and marked as out of scope for the
external-to-external question because they carry _notifications_, never work data, and are all
one-directional:

| Channel          | Port                                                | Vendor binding                                                                                         |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Email            | `packages/integrations/src/mail.ts`                 | Resend, via `RESEND_API_KEY` (`scripts/production-secrets.ts:34`)                                      |
| SMS              | `packages/integrations/src/sms.ts:31` (`SmsSender`) | none — `SMS_ENDPOINT` / `SMS_API_KEY` / `SMS_FROM` (`packages/env/src/registry-vars-infra.ts:124–148`) |
| Web push         | `packages/integrations/src/push.ts`                 | VAPID                                                                                                  |
| Athena execution | `apps/runner`                                       | Cloudflare Queues / Workflows                                                                          |

---

## The external-to-external search

GEN-18's sharpest clause is the negative one: _zero_ code paths where two external systems exchange
work data without a Docket entity in between. Establishing a negative needs an enumerable search
space, so the search was run over the two chokepoints every provider call must pass through.

### Search 1 — every site that constructs a provider client

```
$ grep -rn 'connectorFor(\|createProviderClient(' apps/api/src --include='*.ts'
apps/api/src/lib/automation/runtime.ts:79        const mail = connectorFor(provider, token.token).asMailActor?.();
apps/api/src/lib/email-to-task/sweep.ts:85       const mail = connectorFor(ctx.provider, ctx.token).asMailActor?.();
apps/api/src/routes/integration-sync.ts:340      const connector = connectorFor(provider, token);
apps/api/src/routes/integration-provider.ts:439  export function connectorFor(…)          ← the factory itself
apps/api/src/routes/email-suggestions.ts:135     const mail = connectorFor(provider, token.token).asMailActor?.();
apps/api/src/routes/integrations.ts:375          (await connectorFor(provider, tokenResult.token).listContainers?.({
apps/api/src/routes/integrations.ts:564          const connector = connectorFor(provider, tokenResult.token);
apps/api/src/routes/integrations.ts:697          items = await connectorFor(provider, tokenResult.token).importWork({
```

Seven call sites plus the factory. Classified:

| Site                          | What triggers it                                        | What is between it and any other provider       |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `integration-sync.ts:340`     | scheduled/manual sync of **one** integration row        | `importWork` → `reconcileTasks` → `task`        |
| `integrations.ts:697`         | user-initiated import of **one** integration            | same spine → `task`                             |
| `integrations.ts:375`, `:564` | user opening the connections directory / a health check | read-only; no cross-provider data               |
| `email-suggestions.ts:135`    | a user opening a Docket `email_suggestion` row          | reads the thread for **that** Docket row        |
| `email-to-task/sweep.ts:85`   | scheduled mailbox pull for **one** mail integration     | writes `email_suggestion` (`synthesize.ts:140`) |
| `automation/runtime.ts:79`    | a committed Docket `event` row (see below)              | `event` → `task` → `attachment`                 |

Each site holds exactly **one** provider token, resolved from exactly one `integration` row. There is
no scope anywhere in the API that holds two provider tokens at once — the seven `resolveConnectorToken`
call sites live in five files, each resolving a single integration's grant.

### Search 2 — every outbound provider write

```
$ grep -rn 'applyMailAction(\|\.pushTask(\|asWritable()\|asMailActor()' apps/api/src packages/integrations/src
apps/api/src/lib/automation/runtime.ts:87            await mail.applyMailAction({…});
apps/api/src/routes/integration-reconcile.ts:360     const result = await writable.pushTask({…});
apps/api/src/routes/integration-reconcile.ts:393     await writable.pushTask({…});
apps/api/src/routes/integration-reconcile.ts:447     const result = await writable.pushTask({…});
…(the rest are port definitions and adapter implementations, not call sites)
```

Four call sites. The three `pushTask` calls are inside `reconcileTasks` and their arguments are the
**local Docket task's** fields. The one `applyMailAction` is the interesting one, examined next.

### Search 3 — the closest thing to an external-to-external path, examined in full

There _is_ a path where a GitHub or Linear webhook causes a write to Gmail. It is the automation
engine, and it is the case GEN-18 is really asking about. Traced end to end:

1. A Linear/GitHub webhook lands in `inbound_event` (`ingest.ts:111`) — **Docket entity #1**.
2. The drain normalizes it and inserts an `event` row inside a transaction
   (`event-sync.ts:259–281`) — **Docket entity #2**.
3. Only if that insert returned a row (`if (!row) return null` on the dedupe conflict, `:283`;
   `if (result)` guards the follow-up, `:334`) does the drain project the event for the automation
   engine and run rules (`event-sync.ts:338–348`).
4. The mail handler's **first statement** refuses any event that did not resolve to a Docket entity:

   ```
   apps/api/src/lib/automation/handlers.ts:73    if (!event.subjectId) return;
   ```

   `subjectId` is only populated when the inbound draft resolved to a Docket entity id
   (`apps/api/src/lib/automation/event.ts:92–105`: `subjectType`/`subjectId` are spread in only when
   `docketEntityId !== null && entityKind !== null`).

5. The handler then loads `attachment` rows joined on that Docket task
   (`handlers.ts:83–91`: `subjectType='task'`, `subjectId=event.subjectId`, `kind='email'`) —
   **Docket entity #3** — and the thread id it archives is `attachment.externalId`
   (`handlers.ts:98`), i.e. a value stored on a Docket row, not a value read out of the Linear payload.
6. The applier re-resolves the target `integration` **scoped by the firing event's org**
   (`runtime.ts:55–62`), then calls `applyMailAction` (`:87`).

So the sequence is `Linear → inbound_event → event → task → attachment → Gmail`: **three** Docket
entities between the two external systems, and an early return that makes it structurally impossible
for an external event with no Docket entity to reach a provider write at all.

### Result

**Zero code paths found where two external systems exchange work data without a Docket entity in
between.** The property holds because of three structural facts, not because nobody has written the
bad code yet:

1. Provider clients are constructed only through one factory, and every call site holds exactly one
   token from exactly one org-scoped `integration` row.
2. Every inbound webhook is persisted before it is interpreted, so there is no in-request path from a
   provider payload to a provider call.
3. The only provider write reachable from an external event is guarded by `if (!event.subjectId)
return;` and sources its target from a Docket `attachment` row.

---

## Residual gaps (recorded, not fixed)

Product source is owned by other lanes; this document records what inspection found and fixes
nothing.

1. **Unwired observer adapters.** `observer-slack.ts` and `observer-discord.ts` exist without ingest
   routes (`ingest.ts:131–132` registers only `/linear` and `/github`; `container.ts:234` throws for
   any other provider). Slack OAuth connect is shipped, so a user can connect Slack and receive no
   events. Not a hub violation; an inventory honesty note.
2. **`gtasks` has no canonical `sourceSystem`.** `provider-catalog.ts:108–116` sets
   `sourceSystem: null` for Google Tasks, so its work syncs into `task` but never appears in the
   `event` stream with a source badge. A gap in activity attribution, not in the hub shape.
3. **One provider per calendar module.** `createDefaultCalendarSyncModules`
   (`calendar-sync-modules.ts:27`) returns Google only. The engine is provider-neutral, so this is a
   coverage gap rather than an architectural one.

None of the three creates a spoke-to-spoke path.

---

## How to re-run this inspection

```bash
# 1. The connector inventory is a single tuple; it cannot silently grow.
grep -n 'CONNECTOR_PROVIDER_IDS\|WEBHOOK_PROVIDER_IDS' packages/types/src/provider-catalog.ts

# 2. Every provider-client construction site.
grep -rn 'connectorFor(\|createProviderClient(' apps/api/src --include='*.ts'

# 3. Every outbound provider write.
grep -rn 'applyMailAction(\|\.pushTask(' apps/api/src packages/integrations/src --include='*.ts'

# 4. Every registered inbound webhook route.
grep -rn "\.post('/" apps/api/src/routes/ingest.ts
```

If (2) or (3) grows a call site, the new site has to be classified here before GEN-18 can be
re-asserted.
