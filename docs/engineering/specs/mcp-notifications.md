# MCP Notifications — Implementation Spec (area: `mcp-notifications`)

> **Status:** implementation-grade. Supersedes `mcp-surface.md` §4.4 and the `logging` /
> `resources.subscribe` bullets in §5.
>
> **Scope.** The server→client notification channel: sessions, the GET/SSE stream,
> `resources/subscribe`, `notifications/resources/updated`, the three `list_changed`
> notifications, and `logging`. It does NOT cover the tool surface (see `mcp-surface.md`).

---

## 1. Why this is not a one-line change

The three capabilities were declared and unimplemented, then withdrawn, because all three need the
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
- **GET** opens a long-lived SSE stream that this server owns directly, modelled on
  `routes/stream-sse.ts` (heartbeat, abort wiring, buffer + notify loop).
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
- Sessions are reaped on a `lastSeenAt` cutoff by the existing cron sweep, not a timer —
  Cloud Run throttles CPU between requests, so nothing timer-driven runs reliably.

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
on `c.req.raw.signal` abort. On open, the holding instance registers the session locally and
begins `LISTEN mcp_notify`; on close it deregisters and stops if it holds no other streams.

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
paths across both the MCP tool layer and the RPC routes, and its arguments map 1:1 onto a
`docket://{org}/{type}/{id}` URI. The notify goes **inside** it (and `enqueueSearchDelete`) rather
than beside every call site, so a future write path cannot forget it.

The emitting instance resolves subscribers with one indexed query on `mcpSubscription.uri` and
`pg_notify`s once per session. **Delivery is best-effort**: a notification lost to a dropped stream
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

`logging/setLevel` persists to `mcpSession.logLevel`. The server emits `notifications/message` at
or above that level for events the caller can act on: a tool refused by scope, a resolution that
hit an ambiguity, a truncated result set. It never logs tokens, credentials, or another
principal's data.

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

1. **Round trip.** Open a GET stream, `resources/subscribe` a task URI, mutate the task through a
   tool, assert the `notifications/resources/updated` frame arrives with that URI.
2. **Cross-instance.** Same, but `pg_notify` from a second connection that never saw the GET —
   this is the assertion that the design actually solves the deployment constraint.
3. **Identity pinning.** A second principal presenting a stolen `Mcp-Session-Id` gets 404, and
   never receives a frame for the original principal's subscription.
4. **Authorization.** Subscribing to a resource the caller cannot read fails identically to
   reading it, and produces no subscription row.
5. **Lifecycle.** `DELETE /mcp` ends the session and drops its subscriptions; an idle session past
   the cutoff is reaped; a second GET for one session returns 409.
6. **Heartbeat.** A stream held open past the heartbeat interval stays open.
7. **Level filtering.** `logging/setLevel: warning` suppresses `info` frames.
