# MCP Notifications — Implementation Spec (area: `mcp-notifications`)

> **Status:** shipped. Supersedes `mcp-surface.md` §4.4 and the `logging` /
> `resources.subscribe` bullets in §5. §1 describes the state of the code _before_ this work and is
> kept because the constraints it names still govern the design.
>
> **Scope.** The server→client notification channel: sessions, the GET/SSE stream,
> `resources/subscribe`, `notifications/resources/updated`, the three `list_changed`
> notifications, and `logging`. It does NOT cover the tool surface (see `mcp-surface.md`).

---

## 1. Why this was not a one-line change

The three capabilities were declared and unimplemented, then withdrawn, because all three needed the
same missing thing: a way for the server to push a frame to a client after the request that
created the server has ended. Four facts block that today.

| Fact                                 | Where                                                        | Consequence                                                                                                |
| ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Transport is stateless               | `mcp/server.ts` — `sessionIdGenerator: undefined`            | The SDK refuses to reuse a transport (`_hasHandledRequest` guard); a server instance dies with its request |
| Every response tears down the server | `mcp/server.ts` `responseWithCleanup`                        | Correct today, fatal once a session must outlive a request                                                 |
| No cross-instance transport          | `deploy.yml` — `--max-instances=10`, no affinity             | A write served by instance B cannot reach an SSE stream held by instance A                                 |
| No pub/sub of any kind               | no Redis, no `LISTEN/NOTIFY`, `MCP_SESSION_STORE_URL` unread | Nothing to carry the write→notify hop                                                                      |

`event-bus.ts` is in-process only and keyed by `userId`, so it cannot carry this either.

---

## 2. Architecture

**Postgres carries the fan-out. No new dependency.** Postgres is already in dev (`docker-compose`)
and prod, and `LISTEN/NOTIFY` needs no schema migration to route messages.

**Requests stay stateless; only the notification channel is stateful.** This is the decision that
makes the design work on Cloud Run. The SDK's stateful transport keeps `_initialized`, the session
id, and per-request streams in process memory, which would require every POST for a session to
land on the instance holding it — unachievable without reliable session affinity, which
header-based MCP clients do not provide. So:

- **POST** keeps today's per-request server + stateless transport. Any instance can serve it.
- **GET** opens a long-lived SSE stream that this server owns directly: an interval heartbeat and
  abort wiring, with frames enqueued onto the `ReadableStream` straight from the notify callback.
  (An earlier draft copied `routes/stream-sse.ts`'s pending-buffer + wake-promise loop; the stream's
  own queue already is that buffer, and the per-iteration timeout it needed leaked a live timer for
  every frame that arrived before the heartbeat.)
- **Session and subscription state lives in Postgres**, so any instance can read it.
- **Writes `pg_notify`**; whichever instance holds the stream pushes the frame.

```
POST /mcp (any instance)          GET /mcp (instance A, long-lived)
   │ validate Mcp-Session-Id           │ LISTEN mcp_notify
   │ handle statelessly                │ holds SSE open
   ▼                                   ▲
 mcp_session / mcp_subscription        │ pg_notify('mcp_notify', {sessionId, frame})
 (Postgres)                            │
                                  write on ANY instance
```

### 2.1 Frames are emitted directly

Because the notification channel is ours rather than the SDK transport's, `server.sendResourceUpdated()`
and friends are not used. The frames are plain JSON-RPC and are written to the SSE stream directly:

```json
{"jsonrpc":"2.0","method":"notifications/resources/updated","params":{"uri":"docket://<org>/task/<id>"}}
{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}
{"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","logger":"docket","data":{...}}}
```

This also sidesteps `assertNotificationCapability`, which throws for undeclared capabilities, and
`sendLoggingMessage`, which silently no-ops when `logging` is undeclared.

---

## 3. Schema

New island, `packages/db/src/schema/mcp.ts`. Session state is operational, not domain data, so it
does not touch the work tables.

```
mcpSession       id (the Mcp-Session-Id), principalKey, userId?, agentActorId?,
                 protocolVersion, logLevel, createdAt, lastSeenAt, endedAt
mcpSubscription  sessionId (FK, cascade), uri, createdAt
                 unique (sessionId, uri); index on uri
```

- `principalKey` mirrors `mcp/principal.ts` — the user id or the agent Actor id. **Every request
  carrying a session id must re-resolve its own principal and match it against this column.** The
  current design's identity-pinning safety property is held only by per-request construction; a
  session table must re-establish it explicitly or a stolen session id crosses identities.
- `logLevel` backs `logging/setLevel`, default `info`.
- Sessions are reaped on a `lastSeenAt` cutoff by `POST /internal/cron/expired-sessions-sweep`,
  which already sweeps Better Auth sessions — not a timer, because Cloud Run throttles CPU between
  requests so nothing timer-driven runs reliably. `lastSeenAt` is stamped by the same `UPDATE …
RETURNING` that validates a presented session, so an active session costs no extra write.

---

## 4. Behavior

### 4.1 Session lifecycle

| Step              | Behavior                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `initialize` POST | Mint a session id, insert `mcpSession`, return it in the `Mcp-Session-Id` response header                                                                                                                                                              |
| Later POST        | If `Mcp-Session-Id` present: row must exist, not be ended, and its `principalKey` must equal the caller's. Mismatch → 404 (existence-hiding, not 403). Absent header stays legal — a client may remain sessionless and simply receive no notifications |
| `DELETE /mcp`     | Stamp `endedAt`, drop subscriptions, close any local stream. **Requires adding `DELETE` to the route, which is registered for `POST`/`GET` only today**                                                                                                |
| Idle              | Reaped past the `lastSeenAt` cutoff                                                                                                                                                                                                                    |

### 4.2 The GET stream

One stream per session; a second GET returns 409, matching the SDK's own rule. Emits a heartbeat
comment every 25s (the interval `stream-sse.ts` already uses to survive proxy reaping) and closes
on `c.req.raw.signal` abort. On open, the holding instance registers the session locally and begins
`LISTEN mcp_notify`.

Teardown is idempotent: a client disconnect and a reader cancel can both fire for one stream, and
only the abort path closes the controller. The `LISTEN` subscription is **not** dropped when the
last stream closes — it is started once per process and held for its lifetime, because the cost is
one connection and the alternative is churning it every time a client reconnects. A payload for a
session this instance does not hold is simply ignored, which is the common case under
`--max-instances=10`.

### 4.3 `resources/subscribe`

The SDK ships `SubscribeRequestSchema` and `UnsubscribeRequestSchema` but **registers no handlers**
for either, so both are ours, installed the way `catalog.installListHandlers` installs the list
handlers.

- `subscribe` authorizes the URI exactly as `resources/read` does — same `scopedActor` +
  `authorize('view', …)` path — so subscribing never reveals the existence of something the caller
  could not read. It then upserts `mcpSubscription`.
- Subscribable URIs are the entity template and the Hub resources.
- `unsubscribe` deletes the row. Both are idempotent.

### 4.4 What triggers `resources/updated`

`enqueueSearchUpsert(orgId, sourceTable, entityId)` is the hook point: it already sits on ~40 write
paths across both the MCP tool layer and the RPC routes, and its arguments map onto a
`docket://{org}/{type}/{id}` URI. The notify goes **inside** it (and `enqueueSearchDelete`) rather
than beside every call site, so a future write path cannot forget it.

The mapping is `entityUri()` in `mcp/resources.ts`, beside the readable-type list that defines the
scheme — not a template string on the write path. `source_table` and resource type are not always
the same word (`agent_session` addresses as `session`), and a table absent from that map is simply
not announced, so the builder and the parser have to agree or subscriptions silently never fire.

**This is the layering compromise in the design.** The search indexer is not the natural owner of
an entity-changed event; a neutral post-commit hook would be, and `lib/event-bus.ts` already names
Postgres `LISTEN/NOTIFY` as its own documented follow-up. Riding the write-through was chosen for
coverage — 40 call sites versus 17 for `emitEvent` — at the cost of `search/` depending on `mcp/`.
Folding both into one `entityChanged` facade, and giving the web SSE stream the same cross-instance
fan-out it still lacks, is the right next move and is deliberately out of scope here.

Lookup and publish are a single statement — `select pg_notify(...) from mcp_subscription where uri
= $1` — so a write with no subscribers costs one indexed probe that emits nothing, and one with
subscribers costs no more. This runs on every entity write in the product, so the zero-subscriber
case is the one that had to be cheap; the call is also not awaited by the write path. **Delivery is best-effort**: a notification lost to a dropped stream
is not replayed, and clients must treat `updated` as a hint to re-read, never as the data itself.
Resumability (`Last-Event-ID` + an event store) is deliberately out of scope; the entity read is
always authoritative.

### 4.5 `list_changed`

The catalog is fixed for the life of a deploy, so these fire in exactly one situation: the tool
list is principal- and org-aware, so a **grant change** can add or remove tools for a live session.
`notifications/tools/list_changed` is emitted to that principal's sessions when their grants
change. Resource and prompt lists are static and their notifications are never emitted — the
capability is declared because the client may re-list at will, which is always safe.

### 4.6 `logging`

`logging/setLevel` persists to `mcpSession.logLevel`. The server emits `notifications/message` at or
above that level for events the caller can act on. It never logs tokens, credentials, or another
principal's data.

Level filtering is a `WHERE` clause, not a read-then-decide: `notifyLog` selects `pg_notify(...)`
from `mcp_session` constrained to the severities at or above the requested one, so a session that
does not want a level produces zero rows and no frame in a single round trip. The severity order
comes from the `log_level` pgEnum's own `enumValues` — comparison is by index, so a second
hand-maintained copy of the list would be a silent wrong-severity bug.

**Only one emitter is wired today**: a `tools/call` refused for insufficient scope, sent as
`warning` from the transport preflight. The 403 already carries the step-up challenge, but a client
watching the stream also learns which scope it lacked without correlating an HTTP status back to
the call. The other events named above are not yet emitted.

---

## 5. Capabilities restored

```jsonc
{
  "tools": { "listChanged": true },
  "resources": { "subscribe": true, "listChanged": true },
  "prompts": { "listChanged": true },
  "completions": {},
  "logging": {},
  "tasks": { ... }   // when MCP_TASKS_ENABLED
}
```

The guard test added when these were withdrawn inverts: it must now assert they are present and
that a subscribe → write → frame round trip actually delivers.

---

## 6. Verification

Covered by `apps/api/tests/mcp/mcp-notifications.test.ts` (11 tests) unless noted.

| #   | Property                                                                                                                                                          | Covered                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | **Round trip.** Subscribe a task URI, write the task, receive `resources/updated` with that URI                                                                   | yes                                                                           |
| 2   | **Cross-instance.** A `pg_notify` from a connection that never saw the GET still reaches the stream — the assertion that the design survives `--max-instances=10` | yes                                                                           |
| 3   | **Identity pinning.** A second principal presenting a stolen `Mcp-Session-Id` gets 404 and no frame                                                               | yes                                                                           |
| 4   | **Authorization.** Subscribing to an unreadable resource fails exactly as reading it does, and writes no subscription row                                         | yes                                                                           |
| 5   | **Lifecycle.** `DELETE` ends the session and drops its subscriptions; an idle session past the cutoff is reaped; a second GET returns 409                         | yes                                                                           |
| 6   | **`list_changed`.** A grant change reaches the affected principal's live sessions, by role and by actor                                                           | yes                                                                           |
| 7   | **Level filtering.** A session set to `warning` receives no `info` frame                                                                                          | yes                                                                           |
| 8   | **Heartbeat.** A stream idle past 25s stays open                                                                                                                  | **no** — would cost 25s of wall clock per run; the interval is not injectable |

Item 8 is the one behavior here taken on inspection rather than test. Making `HEARTBEAT_MS`
injectable purely to assert it is the obvious fix if a proxy ever reaps a connection in practice.

Not covered anywhere, and worth knowing: there is no end-to-end test against a real MCP client over
OAuth. Everything above drives `mcpHandler` directly.
