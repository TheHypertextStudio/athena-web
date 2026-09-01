:

# Docket MCP Surface — Implementation Spec (area: `mcp-surface`)

> **Hosts:** `docket.app` below is a placeholder for an apex Docket has not bought yet.
> Production answers on `docket.hypertext.studio` / `docket-api.hypertext.studio` /
> `docket-admin.hypertext.studio` today — see [`domains.md` §0](../domains.md).

> **Status:** implementation-grade. Built against MCP spec **2025-11-25** (authorization, tools, resources, tasks, lifecycle), Better Auth **1.6.14** (`mcp`/`oidcProvider` plugins), the Docket engineering plan §4, and the data model in §5. All facts re-verified against current MCP + Better Auth docs on 2026-06-05.
>
> **Scope of this area.** The `/mcp` HTTP endpoint and transport; the complete **tool** list (mutations) with Zod input/output and annotations; the **resource + resource-template** list (reads) and the `docket://` URI scheme; **auth wiring** (PRM RFC 9728, AS metadata RFC 8414, audience binding RFC 8707, scope set, no token passthrough); and **capability negotiation**. It does NOT define the provider-side agent runtime (see `agents-sessions`), the DB schema (see `data-model`), or the human REST/RPC API (see `api-surface`) — but it calls into all three.

---

## 1. Architecture & Roles

```
 MCP Client (Claude, Athena's planner, 3rd-party)
        │  Streamable HTTP (POST + GET-SSE) · Authorization: Bearer <token>
        ▼
 apps/api  (Hono 4.x · OAuth 2.1 RESOURCE SERVER)
   ├─ /mcp                              ← MCP server (this area)
   ├─ /.well-known/oauth-protected-resource[/mcp]   ← PRM (RFC 9728)
   ├─ /.well-known/oauth-authorization-server       ← AS metadata (RFC 8414)
   └─ /api/auth/*                       ← Better Auth (OAuth 2.1 AUTHORIZATION SERVER)
        │
        ▼
   @docket/db (Drizzle/Postgres)  ←  ALL reads/writes go through the service layer,
                                     scoped by the verified token's principal + grants
```

- **Resource Server (RS):** the `/mcp` endpoint in `apps/api`. Validates Bearer tokens, enforces audience + scope + per-org grants, executes tools/resources against the same service layer the REST API uses.
- **Authorization Server (AS):** Better Auth mounted at `/api/auth` (same `apps/api` deploy). Issues tokens via the `oidcProvider()` + `mcp()` plugins, runs PKCE/S256, hosts the consent screen, supports CIMD.
- **Single AS, multi-tenant RS.** There is exactly one AS. Org isolation is enforced **inside the RS** from the verified token's `sub` (→ `User`) and the `Actor`/`Grant` rows for the requested org — never from anything the client asserts (engineering plan §4 "Multi-tenant safety"). The token carries **global** scopes; the **org** is a per-call argument that is authorized at execution time.

### 1.1 Transport (Streamable HTTP, 2025-11-25)

- Use the official `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` mounted under a Hono route. Do **not** hand-roll SSE/session/resumability (engineering plan §4).
- **One endpoint, `/mcp`**, supporting `POST` (JSON-RPC requests/notifications, may upgrade to SSE) and `GET` (server→client SSE stream). The deprecated HTTP+SSE (two-endpoint) transport is **forbidden**.
- **Session mode:** ~~stateful~~ **RESOLVED: shipped stateless.** The implementation uses `sessionIdGenerator: undefined` — one fresh server + transport per request, no `Mcp-Session-Id`, no Redis event store (`apps/api/src/mcp/server.ts`). Cross-request `resources/subscribe` notifications therefore cannot exist; long agent runs use the Tasks capability (behind `MCP_TASKS_ENABLED` + `MCP_SESSION_STORE_URL`) and clients poll resources. The original stateful+Redis design remains a possible future upgrade if resumable SSE becomes a requirement.
- **Protocol version header:** the RS MUST honor `MCP-Protocol-Version: 2025-11-25` on every non-initialize request; reject unknown versions with HTTP 400 (SDK handles this).
- **Origin validation (MUST, DNS-rebinding):** a missing `Origin` is valid for native clients. When
  an `Origin` is present, accept an exact HTTPS origin, or local HTTP loopback outside production;
  reject malformed values and non-loopback HTTP before auth work. This is a protocol safety check,
  not a deployment-time client or vendor approval list. Bind the listener to the platform host
  only.
- **CORS:** registered **before** the Better Auth handler (engineering plan §2); expose `Authorization`, `WWW-Authenticate`, `Mcp-Session-Id`, `MCP-Protocol-Version`.

---

## 2. Auth Wiring (OAuth 2.1)

### 2.1 Better Auth config (`@docket/auth`)

```ts
// packages/auth — composed in the single betterAuth() instance.
import { betterAuth } from 'better-auth';
import { mcp, oidcProvider } from 'better-auth/plugins';

export const auth = betterAuth({
  // ...db (drizzleAdapter), passkey, sso, scim, stripe, socialProviders...
  plugins: [
    oidcProvider({
      loginPage: '/sign-in',
      // PKCE + S256 are enforced; CIMD advertised (see §2.4).
      // Token aud MUST be bound to the RFC 8707 `resource` param (verify; open issue).
    }),
    mcp({
      loginPage: '/sign-in',
      resource: 'https://api.docket.app/mcp', // canonical RS URI (per-env value)
      oidcConfig: {
        accessTokenExpiresIn: 60 * 15, // 15 min — short-lived (spec SHOULD)
        refreshTokenExpiresIn: 60 * 60 * 24 * 30,
        scopes: [
          // the Docket MCP scope set, flat/global
          'work:read',
          'work:write',
          'agents:run',
          'connectors:link',
        ],
        defaultScope: 'work:read',
      },
    }),
    // nextCookies() MUST be last in the full config.
  ],
});
```

> **Note on plugin choice (resolves engineering open decision).** Use `oidcProvider()` **and** `mcp()` together. `mcp()` is built on the OIDC provider and adds the MCP-specific discovery helpers; the OIDC provider owns the `oauthApplication/oauthAccessToken/oauthConsent` tables and the consent UI. `mcp()` alone is insufficient because Docket also acts as a general OIDC provider for first-party apps.

### 2.2 Scope set (the four Docket MCP scopes)

| Scope             | Grants (token-level capability)                                       | Maps to Actor grant capabilities (RS-enforced per org)              |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `work:read`       | Read any work-layer entity the principal can see.                     | `view` on the resolved resource.                                    |
| `work:write`      | Create/update/move/assign/comment/post-update/run-view/link_external. | `contribute`/`assign`/`comment`/`manage` (per tool — see §3 table). |
| `agents:run`      | Trigger agent sessions, approve/reject agent actions.                 | `manage` on the target + approver-eligibility check.                |
| `connectors:link` | Link external resources / initiate connector OAuth.                   | `manage` on the Integration + `contribute` on the linked entity.    |

**Two-layer authorization (mandatory).** A token scope is **necessary but not sufficient**. Every tool/resource call ALSO resolves the caller's `Actor` in the target `organization_id` and checks the granular `Grant` cascade (`view/comment/contribute/assign/manage`, data-model §5 "Permission / Grant"). Scopes gate _capability class_; grants gate _which org/resource_. A token with `work:write` still gets HTTP 403 / `isError` if the principal lacks `contribute` on that task.

**Why global (not org-qualified) scopes:** the product model is "one global `User`, org access via `Actor` membership." Org-qualifying scopes (`work:write:org_<id>`) would bloat the consent screen and require re-consent on every new membership. Org is a _call argument_, authorized at execution. (See open issue.)

### 2.3 Discovery routes (RS-served)

Mount these in `apps/api` using the `mcp()` plugin helpers:

```ts
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from 'better-auth/plugins';

// AS metadata (RFC 8414) — proxied from Better Auth's OIDC config.
app.get('/.well-known/oauth-authorization-server', (c) => oAuthDiscoveryMetadata(auth)(c.req.raw));

// Protected Resource Metadata (RFC 9728).
app.get('/.well-known/oauth-protected-resource', (c) =>
  oAuthProtectedResourceMetadata(auth)(c.req.raw),
);
// AND the sub-path form for the /mcp endpoint (RFC 9728 §3.1):
app.get('/.well-known/oauth-protected-resource/mcp', (c) =>
  oAuthProtectedResourceMetadata(auth)(c.req.raw),
);
```

**PRM document (RFC 9728) — required fields:**

```jsonc
{
  "resource": "https://api.docket.app/mcp", // canonical RS URI (no trailing slash)
  "authorization_servers": ["https://api.docket.app"], // the single Docket AS issuer
  "scopes_supported": [
    "work:read",
    "work:write",
    "agents:run",
    "connectors:link",
    "offline_access",
  ],
  "bearer_methods_supported": ["header"],
}
```

`offline_access` is listed even though it is not a Docket capability. RFC 9728 §2 defines `scopes_supported` as the scope values "used in authorization requests to the authorization server for this resource" — not the resource's own capabilities — and the AS mints a refresh token **only** when the granted set contains it. A client that intersects this document with the `WWW-Authenticate` hint before building its authorize URL would otherwise drop it and end up with a 15-minute connection and no renewal path. This document, the AS metadata, and both challenges (§2.6) describe one authorization request and MUST advertise the same set.

**AS metadata (RFC 8414) — required fields the RS depends on:** `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint` (DCR fallback), `code_challenge_methods_supported: ["S256"]` (MUST be present — clients refuse otherwise), `scopes_supported`, `client_id_metadata_document_supported: true` (CIMD; §2.4), `token_endpoint_auth_methods_supported`. Served at the OIDC well-known too (`/.well-known/openid-configuration`) for client interop.

### 2.4 Client registration: CIMD primary, DCR fallback

Per spec §"Client Registration Approaches", the priority order is pre-registration → **CIMD** → **DCR** → manual. Docket:

- **Advertises CIMD** via `client_id_metadata_document_supported: true` in AS metadata. The AS
  fetches the client's HTTPS `client_id` document, validates `client_id` === URL exactly, validates
  `redirect_uris`, rejects private/link-local/non-public destinations, caps time and response size,
  disables redirects, and pins the validated address for the fetch. Any client that satisfies the
  protocol and network rules can register; no vendor or hostname list grants trust. DCR has been
  downgraded to MAY in 2025-11-25 (engineering plan §0).
- **Keeps DCR (`/register`, RFC 7591)** enabled as a MAY-level fallback for backwards compatibility (Better Auth `oidcProvider` provides it).
- First-party clients (Athena planner, Docket web) are **pre-registered** with fixed `client_id`s.

> **RESOLVED:** Better Auth 1.6.14 does NOT validate URL-form `client_id`s — its authorize handler
> resolves clients by exact `client_id` lookup only. The thin CIMD shim exists
> (`apps/api/src/mcp/cimd.ts`: fetch + validate + SSRF guard + upsert into `oauth_application`) and
> `cimdAuthorizeMiddleware` is mounted ahead of `/api/auth/mcp/authorize` in
> `apps/api/src/server.ts`.
>
> **Consent enforcement (net-new, discovered live):** Better Auth's `mcp()` authorize only routes through the consent page when the client sends `prompt=consent` — otherwise it silently mints a code for any registered client. `mcpConsentGuard` (`apps/api/src/mcp/consent-guard.ts`, mounted beside the CIMD preflight) 302s consent-less authorize requests back with `prompt=consent` unless a stored `oauth_consent` row already covers the requested scopes, restoring consent-once-per-scope-set semantics.

### 2.5 Token validation (RS, on every request — MUST)

`withMcpAuth(auth, handler)` wraps `/mcp`; inside, `auth.api.getMcpSession({ headers })` returns `{ accessToken, userId, scopes, clientId }`. The RS additionally enforces:

1. **Bearer present** in `Authorization` header (never query string). Missing/invalid → **401** with `WWW-Authenticate` (see §2.6).
2. **Audience binding (RFC 8707):** the token's `aud` MUST equal the canonical RS URI (`MCP_RESOURCE_URL`). Reject mismatches → 401. (**RESOLVED:** Better Auth's `getMcpSession` resolves tokens bound to the configured `resource`; verified live by the `mcp-connect` e2e flow, which mints a real token and exercises the RS with it.)
3. **Issuer:** token `iss` MUST equal the Docket AS issuer. **No token passthrough** — the RS MUST NOT accept tokens minted for GitHub/Drive/Linear, and MUST NOT forward the client's token downstream. Downstream connector calls use **separately-issued** Integration credentials (`Integration.connection.credentials_ref`, data-model §5).
4. **Scope check** for the requested operation (§2.2 table). Insufficient scope at runtime → **403** with step-up `WWW-Authenticate` (§2.6).
5. **Principal resolution:** map `sub`/`userId` → `User`. For org-scoped operations, resolve the human `Actor` for `(user_id, organization_id)`; if no membership row exists → 403. Then evaluate the `Grant` cascade. **Nothing is read from client-asserted org/user fields.**

### 2.6 `WWW-Authenticate` challenges

**401 (no/invalid token):**

```
WWW-Authenticate: Bearer resource_metadata="https://api.docket.app/.well-known/oauth-protected-resource/mcp",
                         scope="work:read work:write agents:run connectors:link offline_access"
```

The challenge advertises the **full** connect set, not a `work:read` baseline. A client asks for exactly what it is told to ask for, so a narrower hint connects it read-only — and because a client's granted set is fixed at registration/consent time, "read-only for now, escalate later" is not recoverable in practice. One consent screen listing everything is both more honest to the user and the only reliable path. Including `offline_access` stretches RFC 6750 §3 (which scopes the attribute to what is _required_ to access the resource); it is deliberate, for the renewal reason in §2.3.

**403 (insufficient_scope, runtime step-up):** include the scopes needed for _this_ operation plus already-granted relevant scopes (spec "Recommended approach"):

```
WWW-Authenticate: Bearer error="insufficient_scope",
                         scope="work:read work:write",
                         resource_metadata="https://api.docket.app/.well-known/oauth-protected-resource/mcp",
                         error_description="Posting an update requires work:write"
```

This is how an agent that started **read-only** (engineering plan / product §4) escalates: a write tool returns 403 → client runs step-up authorization → re-calls with `work:write`. `offline_access` is carried forward in the `scope` list when — and only when — the token already holds it, so a step-up never silently downgrades a durable connection to a non-renewable one.

**Step-up is a fallback, not the primary path.** It requires the client to run a full re-authorization: a refresh grant can only ever narrow the scope set, never widen it. Treat the §2.6 401 hint as the mechanism that gets a client fully authorized, and step-up as recovery for clients that ignored it.

---

## 3. Tools (mutations)

### 3.1 Conventions

- **Naming:** `snake_case`, verb-first, ≤128 chars (spec §"Tool Names"). Allowed chars: `[A-Za-z0-9_.-]`.
- **`inputSchema` / `outputSchema`:** authored as **Zod** in the retired contract package, converted to JSON Schema 2020-12 via `zod-to-json-schema` (or Zod 4 native `z.toJSONSchema`). `outputSchema` is provided for **every** tool; the result MUST populate `structuredContent` AND a serialized-JSON `TextContent` block (spec §"Structured Content", backwards compat).
- **`orgId` argument:** every org-scoped tool takes `orgId` = the Organization **id**, which `workspaces` supplies. An earlier draft of this spec mandated the slug; the code has always taken the id, and `workspaces` returning both closed the discoverability gap that the slug was meant to solve.
- **Names work wherever ids do**, for every _other_ reference: `assignee: "Sarah"`, `project: "Platform Migration"`, `state: "In Review"` all resolve server-side (`descriptors.ts`). Matching runs exact → prefix → substring and accepts only an unambiguous hit. An ambiguous name elicits when the client can answer, and otherwise comes back listing the candidates. Task titles are deliberately **not** resolvable — they repeat too often to name one by.
- **Annotations (verified defaults from `ToolAnnotations`):** `readOnlyHint` default `false`; `destructiveHint` default `true` (meaningful only when not read-only); `idempotentHint` default `false`; `openWorldHint` default `true`. Every Docket mutation sets `openWorldHint: false` (closed world — Docket's own DB) **except** `link_external` and `run_agent` (they touch external systems → `true`). We set all four explicitly to avoid relying on defaults.
- **Errors:** input/validation/business errors → tool result with `isError: true` + actionable text (spec §"Tool Execution Errors"). Unknown tool / malformed → JSON-RPC protocol error. Insufficient scope/grant → JSON-RPC error is NOT used; instead return HTTP 403 at the transport layer for token-scope failures, and `isError:true` for per-resource grant failures (so the model can self-correct, e.g. by requesting access).
- **Idempotency keys:** create-tools accept an optional `idempotency_key` (UUID); replaying with the same key returns the original result (enables safe retries on flaky SSE). Marked `idempotentHint: true` when present-semantics hold.

### 3.2 The tool surface

Fifteen tools, named for what someone is trying to do rather than for the row they touch. The
earlier draft of this section listed twenty-six that mapped roughly 1:1 onto SQL statements; that
surface could not express ordinary sentences ("reassign Sarah's open work to me" needed a name→id
lookup, a filtered query, and a bulk write, and offered none of the three) and was replaced.

| Tool             | readOnly | destructive | idempotent | openWorld | Scope             | Widget          |
| ---------------- | :------: | :---------: | :--------: | :-------: | ----------------- | --------------- |
| `workspaces`     |  **T**   |      F      |     T      |     F     | `work:read`       | —               |
| `list_work`      |  **T**   |      F      |     T      |     F     | `work:read`       | `work-list`     |
| `find`           |  **T**   |      F      |     T      |     F     | `work:read`       | —               |
| `get`            |  **T**   |      F      |     T      |     F     | `work:read`       | —               |
| `brief`          |  **T**   |      F      |     T      |     F     | `work:read`       | —               |
| `retrospect`     |  **T**   |      F      |     T      |     F     | `work:read`       | —               |
| `capture`        |    F     |      F      |     F      |     F     | `work:write`      | `change-report` |
| `organize`       |    F     |      F      |   **T**    |     F     | `work:write`      | `change-report` |
| `update`         |    F     |    **T**    |     T      |     F     | `work:write`      | `change-report` |
| `link`           |    F     |    **T**    |     T      |     F     | `work:write`      | —               |
| `archive`        |    F     |    **T**    |     T      |     F     | `work:write`      | `change-report` |
| `comment`        |    F     |      F      |     F      |     F     | `work:write`      | —               |
| `report_status`  |    F     |      F      |     F      |     F     | `work:write`      | —               |
| `plan_day`       |    F     |      F      |     T      |     F     | `work:write`      | —               |
| `undo`           |    F     |    **T**    |     T      |     F     | `work:write`      | —               |
| `link_external`  |    F     |      F      |     T      |   **T**   | `connectors:link` | —               |
| `run_agent`      |    F     |      F      |     F      |   **T**   | `agents:run`      | —               |
| `manage_session` |    F     |    **T**    |     T      |     F     | `agents:run`      | —               |

Two more are registered only for a user principal, never a workspace one, because they act on a
private delegation rather than on shared work:

| Tool                               | readOnly | destructive | idempotent | openWorld | Scope        | Widget |
| ---------------------------------- | :------: | :---------: | :--------: | :-------: | ------------ | ------ |
| `pause_athena_assignment_trigger`  |    F     |      F      |     T      |     F     | `work:write` | —      |
| `remove_athena_assignment_trigger` |    F     |    **T**    |     T      |     F     | `work:write` | —      |

Both match on the caller's own `assignmentId` and `triggerId`; another user's ids return
`not_found` rather than a distinguishable error, and trigger scope is inherited from the assignment
and cannot be widened through them.

Notes on the less obvious entries:

- **`organize` is idempotent** because it reconciles: it matches each item against what already
  exists _in its parent's scope_ and creates only the rest, so re-running a plan does not duplicate
  it. Matching is never org-wide for anything with a parent — two projects called "Rollout" under
  different programs are two projects.
- **`update`, `archive`, and `undo` are destructive** in the annotation's sense: they rewrite or
  remove existing state in bulk, and a client should show the caller what will happen. `link` is
  marked destructive because `remove: true` takes a relation away.
- **Reads are tools, not resources**, when they take rich query arguments; resources are for reads
  addressable by URI. `workspaces` is the bootstrap: every other tool needs an `orgId`, and it is
  the only one that does not.
- **Every write records a change set** and returns a `changeSetId` for `undo`. Undo is a reverse
  replay with conflict detection, not a rollback — anything edited by someone else since is
  reported as skipped rather than clobbered.
- **A task's `state` is comparable across teams through its `stateType`.** `state` holds a key from
  one status set, which the workspace or a forked team can rename at will, so two teams can call
  the same stage `doing` and `in_flight`. `list_work` and `get` therefore return `stateType`
  alongside it — the canonical `backlog | unstarted | started | completed | canceled` category —
  and that is what a status glyph, a cross-team comparison, or any grouping must key off. Statuses
  are now workspace-defined (`statuses.md`), so the set of keys a client may meet is genuinely
  open and `stateType` is the one field every status is guaranteed to carry. `stateType` always
  resolves: `task.status_id` names the status row and a composite FK over
  `(status_id, state, organization_id)` holds the stored key equal to that row's key, so the
  category is always there to read. **Superseded:** the caveat that `stateType` is "absent, rather
  than guessed, when the owning team no longer lists the stored key" — a task whose key names
  nothing can no longer be written, and `0087_sour_post.sql` repaired the rows that predated the
  constraint. `workflow-states.ts` resolves the set once per distinct team per page, never once per
  row.

**Authoritative definitions live in the code, not here.** Every tool carries a `.describe()` on
every field and an `outputSchema`, so restating them in prose guarantees drift. See
`apps/api/src/mcp/` — one module per tool — and `TOOL_SCOPE` in `scope.ts`, which
`tests/mcp/mcp-scope.test.ts` asserts covers every registered tool, so a rename fails loudly.

### 3.2.1 Widgets (MCP Apps, SEP-1865)

Tools with a widget declare it via `_meta["io.modelcontextprotocol/ui"].resourceUri`, pointing at a
`ui://docket/*` resource served as `text/html;profile=mcp-app`. A host that does not implement the
extension ignores the key and renders the JSON, so a widget can never make the surface worse.

- `change-report` — what a write did, as before → after per item, plus what it could not touch and
  why, plus the undo for that change set. It shows diffs rather than end states because writes
  execute immediately, making this the only place the change is checkable.
- `work-list` — the count and first rows of a matched set, so it can be scanned before it is acted
  on. No filters, no sort, no text entry: the scope came from a sentence, and changing it is
  another sentence.

Documents are self-contained (the host serves them under a deny-all CSP) and take all colour from
`hostContext.styles.variables`. See `apps/api/src/mcp/apps/`.

### 3.3 Where the definitions actually live

This section used to carry the retired contract package fragment sketch and then ~350 lines of per-tool
input/output/annotation definitions. Both are deleted rather than updated, because both had already
drifted from the code in ways that mattered: the sketch typed ids as `z.string().uuid()` (they are
Crockford-base32 ULIDs, branded per entity in `domain-local ID modules`) and used
`snake_case` field names the API never spoke, while the tool definitions described a surface that
no longer exists — `run_view`, `start_connector_link`, `trigger_agent_session`,
`add_to_daily_plan`, and the fourteen per-field task tools.

A prose copy of a schema is a second source of truth that nothing verifies, and this file is the
evidence for what happens to one. The code is the specification:

| What                                    | Where                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Every tool's input/output + annotations | `apps/api/src/mcp/*-tool.ts`, `write-tools.ts`, `view-plan-tools.ts`, `content-tools.ts`, `session-tools.ts` |
| Scope per tool                          | `TOOL_SCOPE` in `apps/api/src/mcp/scope.ts`                                                                  |
| Branded ids and shared enums            | `domain-local ID modules` and its siblings                                                                   |
| Name→id resolution                      | `apps/api/src/mcp/descriptors.ts`                                                                            |
| Change sets and undo                    | `apps/api/src/mcp/change-set.ts`                                                                             |
| Widgets                                 | `apps/api/src/mcp/apps/`                                                                                     |

Every field carries a `.describe()` and every tool an `outputSchema`, so `tools/list` is itself the
readable, always-current contract — `pnpm --filter @docket/api test` fails if `TOOL_SCOPE` misses a
registered tool, which is the one invariant this file used to assert in prose and could not check.

#### Remote MCP outbound network boundary

Every real remote MCP request uses the central `@docket/integrations` network boundary. This
includes organization and personal preview, connection verification/reconnect, OAuth discovery,
registration, token exchange/refresh, and agent toolbox calls. Production endpoints are HTTPS-only;
there is no request-level allowlist or private-network bypass. Deterministic tests inject a fake
resolver and transport directly into the boundary instead of weakening production policy.

Before each request and redirect hop, the boundary resolves every address for the hostname and
rejects the destination if any result is loopback, private/RFC 1918, CGNAT, link-local, multicast,
reserved, unspecified, or a non-public IPv6 address (including IPv4-mapped IPv6 forms). The chosen
validated address is pinned into the TLS connection while preserving the original hostname for
SNI and certificate verification, preventing a second DNS lookup from rebinding the request.
Redirects are manual, capped at three, and strip authorization on an origin change. Connect and
overall deadlines plus response-header and response-body size limits bound every call.

---

## 4. Resources & Resource Templates (reads)

### 4.1 URI scheme

```
docket://{org}/{type}/{id}
```

- `{org}` = Organization **slug** (Personal space = `personal`). Embedding the org in the URI keeps tenancy explicit and human-legible, and the RS still re-authorizes from the token (the URI is never trusted for access — only for addressing).
- `{type}` ∈ `task | project | program | initiative | cycle | team | update | comment | session | agent | view`.
- `{id}` = entity UUID.
- Custom scheme (RFC 3986 compliant). Resources are **non-fetchable** — clients MUST read via `resources/read` (spec discourages `https://` unless the client can fetch directly). The mutation tools return both this `uri` and an `https://app.docket.app/...` deep `url` for human navigation.

### 4.2 Static resources (`resources/list`)

Listed eagerly (cheap, navigational entry points), org-scoped to what the principal can see; paginated:

| URI                      | Backing entity             | Notes                                                                                         |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------- |
| `docket://{org}`         | Organization               | Org summary + vocabulary skin + counts.                                                       |
| `docket://{org}/inbox`   | Notification set           | The user's unread/unacted items **for this org** (cross-org Inbox is the Hub resource below). |
| `docket://hub/today`     | Daily Plan (today)         | Hub-scoped; cross-org; `{org}` literal `hub`.                                                 |
| `docket://hub/inbox`     | Notification (all orgs)    | The cross-org Inbox.                                                                          |
| `docket://hub/portfolio` | Programs+Projects timeline | Cross-org roadmap.                                                                            |

> Hub resources use the literal `hub` in the `{org}` slot. They are authorized purely by `sub` (Hub is 1:1 with User).

### 4.3 Resource templates (`resources/templates/list`, RFC 6570)

Each `{var}` is completable via the **completion API** (§5 capabilities). `mimeType: "application/json"` for all (the read returns a JSON document = the entity projection).

| `uriTemplate`                    | name          | Read returns                                                                                                                                                                                                                                               |
| -------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docket://{org}/task/{id}`       | Task          | Full task: state, assignee, delegate, project/program/milestone/cycle, dependencies (blocking + blocked-by, each with the other task's project), subtasks, labels, provenance, comment+activity stream.                                                    |
| `docket://{org}/project/{id}`    | Project       | Overview, weighted-progress %, health, milestones with their tasks, linked initiatives, latest update.                                                                                                                                                     |
| `docket://{org}/program/{id}`    | Program       | Health + flow snapshot, projects, ongoing tasks grouped by cycle, linked initiatives. **No % bar.**                                                                                                                                                        |
| `docket://{org}/initiative/{id}` | Initiative    | Auto-derived rolled-up health, child-distribution, associated projects/programs.                                                                                                                                                                           |
| `docket://{org}/cycle/{id}`      | Cycle         | Window, burn-up (planned vs done), capacity, scope changes, carryover, tasks grouped by Project/Program.                                                                                                                                                   |
| `docket://{org}/team/{id}`       | Team          | `workflow_states`, cycles, triage queue summary, members (human Actors).                                                                                                                                                                                   |
| `docket://{org}/update/{id}`     | Update        | Author, subject ref, health, body, timestamp.                                                                                                                                                                                                              |
| `docket://{org}/comment/{id}`    | Comment       | Author Actor, subject ref, body, thread parent.                                                                                                                                                                                                            |
| `docket://{org}/session/{id}`    | Agent Session | status, agent, task ref, trigger, accountability (`agent` + `initiator`), and the **Session Activity** stream (`thought/action/response/elicitation/error`, with per-action approval status). **No compute/cost** (provider owns it). Subscribable (§4.4). |
| `docket://{org}/agent/{id}`      | Agent         | provider connection (endpoint/protocol — **no credentials**), `grants[]`, `approval_policy`, accountable owner, guidance.                                                                                                                                  |
| `docket://{org}/view/{id}`       | Saved View    | View definition (permission-filtered); executing a stored view is not supported; `list_work` takes filters as arguments.                                                                                                                                   |

**`resources/read` contract:** returns `contents: [{ uri, mimeType: "application/json", text: <JSON projection> }]`. The projection is a **Zod-validated** read DTO in the retired contract package (one per type) so the shape is stable. Not-found → JSON-RPC `-32002`; no-grant → `-32002` (do NOT leak existence to unauthorized callers — return not-found, not forbidden).

### 4.4 Subscriptions

> **RESOLVED: shipped — see [`mcp-notifications.md`](mcp-notifications.md), which supersedes this
> section.** Subscriptions are real. The request path stays stateless (§1.1 still holds), and the
> notification channel is a separate session-scoped SSE stream the server owns directly, fed by
> Postgres `LISTEN/NOTIFY` so a write served by one Cloud Run instance reaches a stream held by
> another. Sessions and subscriptions live in `mcp_session` / `mcp_subscription`. Delivery is
> best-effort and un-replayed: a frame is a hint to re-read, never the data itself.

- Advertise `resources.subscribe: true` and `resources.listChanged: true`.
- **Subscribable:** `docket://{org}/session/{id}` (live agent activity — the highest-value subscription; powers a client watching a running session), `docket://{org}/task/{id}`, and the Hub `inbox`/`today` resources (new approvals/notifications).
- On change, the RS emits `notifications/resources/updated { uri }`. Internally, the service layer publishes entity-change events (the same events that drive the web app's realtime); the MCP transport fans them to subscribed sessions over their SSE stream.
- `notifications/resources/list_changed` fires when the set of visible entities changes materially (e.g. a new project the principal can now see) — debounced.

---

## 5. Capability Negotiation (what Docket advertises)

On `initialize`, the RS advertises:

```jsonc
{
  "protocolVersion": "2025-11-25",
  "serverInfo": { "name": "docket", "title": "Docket", "version": "<build>" },
  "capabilities": {
    "tools": { "listChanged": true }, // fires when a grant change alters the caller's tool set
    "resources": { "subscribe": true, "listChanged": true }, // see mcp-notifications.md
    "prompts": { "listChanged": true },
    "completions": {}, // arg autocompletion for resource-template vars + tool enums
    "logging": {}, // notifications/message, level per session
    "tasks": {
      // EXPERIMENTAL — for long agent runs / big views
      "list": {},
      "cancel": {},
      "requests": { "tools": { "call": {} } },
    },
  },
}
```

- **`tools.listChanged: true`** — the available tool set is **principal- and org-aware**: a client whose token lacks `agents:run` does not see the agent tools; connectors not yet linked hide `link_external` for unsupported subjects. When grants/connectors change mid-session, the RS emits `notifications/tools/list_changed`.
- **`prompts`:** advertised (`prompts.listChanged: true`) — the implementation registers workspace-context bootstrap prompts (`apps/api/src/mcp/prompts.ts`), superseding this spec's original "deferred in v1" stance.
- **`completions: {}`** — implement `completion/complete` for: resource-template `{id}` vars (return matching entities the principal can see, by recent/active), `{org}` (the principal's org slugs), and tool enum args (e.g. `team`, `state` from the team's `workflow_states`, `provider`).
- **`logging: {}`** — **RESOLVED: shipped.** `logging/setLevel` persists to `mcp_session.log_level` and `notifications/message` frames go out over the session's stream ([`mcp-notifications.md`](mcp-notifications.md) §4.6). Never log tokens, credentials, or another principal's data.
- **`tasks`** — declare `tasks.requests.tools.call` so clients MAY augment `run_agent` / `list_work` calls as tasks. Tasks are **authorization-context-bound** (spec security): `tasks/get|result|cancel|list` MUST reject task IDs not owned by the requestor's token context. Adopt behind a feature flag (open issue: experimental churn).
- **Pagination:** honor `cursor`/`nextCursor` on `tools/list`, `resources/list`, `resources/templates/list`, `tasks/list`, and inside `list_work`/`find`.
- **Lifecycle utilities:** support `ping`, progress (`notifications/progress` with the request's `progressToken`), and cancellation (`notifications/cancelled`).

---

## 6. Build Checklist (this area)

1. Mount `StreamableHTTPServerTransport` at `/mcp` in `apps/api` — **per-request, not stateful**:
   session and subscription state lives in Postgres and the notify hop rides `LISTEN/NOTIFY`,
   because Cloud Run runs `--max-instances=10` with no session affinity and there is no Redis (see
   `mcp-notifications.md`); wire `withMcpAuth(auth, …)`; register CORS + vendor-neutral Origin
   validation **before** the handler.
2. Serve PRM at `/.well-known/oauth-protected-resource` **and** `/.well-known/oauth-protected-resource/mcp`. AS metadata: Better Auth serves the live document at `<issuer>/api/auth/.well-known/oauth-authorization-server` (relative to its base path, NOT the RFC 8414 root); the RS-level `/.well-known/oauth-authorization-server` 307-redirects there. Confirm `code_challenge_methods_supported:["S256"]` and `client_id_metadata_document_supported:true` appear.
3. Register the 4 scopes in `mcp().oidcConfig.scopes`; implement the token-validation middleware: bearer → `getMcpSession` → audience(`aud`==RS URI) → issuer → scope → principal(`sub`→User→Actor) → grant cascade. Emit the two `WWW-Authenticate` challenge forms.
4. Author every tool's Zod input/output + annotations; register with `outputSchema` (JSON Schema 2020-12) and `structuredContent`+text results; gate each by scope (table §3.2) AND grant.
5. Implement the `docket://` resource reader (Zod read DTOs), `resources/list`, `resources/templates/list`, `resources/read`, `resources/subscribe`, and the `updated`/`list_changed` notification fan-out from the service-layer event bus.
6. Implement `completion/complete`, `logging`, `ping`/progress/cancel; gate `tasks` behind `MCP_TASKS_ENABLED`.
7. Enforce **no downstream token passthrough**: connector resolution in `link_external` uses `Integration.credentials_ref`, never the inbound token.
8. Env contract (validated in `@docket/env`, dev mirrors prod): **DONE, on-by-default.**
   `MCP_ISSUER_URL`/`MCP_RESOURCE_URL`/`OIDC_LOGIN_PAGE_URL` derive automatically from the required
   `API_URL`/`WEB_URL` (`packages/env/src/api.ts`) — no client-list configuration is needed for the
   AS/RS to mount in any deploy. If using Tasks, `MCP_SESSION_STORE_URL` (Redis) and
   `MCP_TASKS_ENABLED` are explicit, along with the shared `BETTER_AUTH_URL`/secret/DB vars.
9. Playwright/integration: **DONE** — `apps/web/e2e/mcp-connect.spec.ts` (discover PRM/AS → DCR register → consent → PKCE token → Bearer read → 403 step-up → `capture`) and `apps/web/e2e/mcp-session.spec.ts` (`run_agent` → observe the approval gate on the session resource → `manage_session` with `action: 'approve'`; polling instead of subscribe, per the per-request transport). Both run in the CI `e2e` job.
10. **Open:** no rate limit on `/mcp`. The API has no rate-limiting infrastructure and the deployment has no shared store, so a per-instance limiter would give false assurance; it needs its own design pass.
