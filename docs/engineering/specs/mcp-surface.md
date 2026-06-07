:

# Docket MCP Surface — Implementation Spec (area: `mcp-surface`)

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
- **Session mode:** stateful. The transport issues an `Mcp-Session-Id` on `initialize`; subsequent requests echo it. Back the session + event store with **Redis** (resumability via `Last-Event-ID`) so long agent runs survive reconnects. (Open issue: confirm hosting can hold SSE; stateless + Tasks is the fallback.)
- **Protocol version header:** the RS MUST honor `MCP-Protocol-Version: 2025-11-25` on every non-initialize request; reject unknown versions with HTTP 400 (SDK handles this).
- **Origin validation (MUST, DNS-rebinding):** reject requests whose `Origin` is not in an allowlist (`https://app.docket.*`, `https://*.docket.*`, and configured client origins) before any auth work. Bind the listener to the platform host only.
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
  "scopes_supported": ["work:read", "work:write", "agents:run", "connectors:link"],
  "bearer_methods_supported": ["header"],
}
```

**AS metadata (RFC 8414) — required fields the RS depends on:** `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint` (DCR fallback), `code_challenge_methods_supported: ["S256"]` (MUST be present — clients refuse otherwise), `scopes_supported`, `client_id_metadata_document_supported: true` (CIMD; §2.4), `token_endpoint_auth_methods_supported`. Served at the OIDC well-known too (`/.well-known/openid-configuration`) for client interop.

### 2.4 Client registration: CIMD primary, DCR fallback

Per spec §"Client Registration Approaches", the priority order is pre-registration → **CIMD** → **DCR** → manual. Docket:

- **Advertises CIMD** via `client_id_metadata_document_supported: true` in AS metadata. The AS fetches the client's HTTPS `client_id` document, validates `client_id` === URL exactly, validates `redirect_uris`, and applies an **SSRF guard + domain trust policy** (allowlist for known clients; reject private/link-local hosts). DCR has been downgraded to MAY in 2025-11-25 (engineering plan §0).
- **Keeps DCR (`/register`, RFC 7591)** enabled as a MAY-level fallback for backwards compatibility (Better Auth `oidcProvider` provides it).
- First-party clients (Athena planner, Docket web) are **pre-registered** with fixed `client_id`s.

> **Open issue:** confirm Better Auth 1.6.14 natively emits `client_id_metadata_document_supported` and validates URL-form `client_id`s. If not, add a thin CIMD shim in the RS (net-new).

### 2.5 Token validation (RS, on every request — MUST)

`withMcpAuth(auth, handler)` wraps `/mcp`; inside, `auth.api.getMcpSession({ headers })` returns `{ accessToken, userId, scopes, clientId }`. The RS additionally enforces:

1. **Bearer present** in `Authorization` header (never query string). Missing/invalid → **401** with `WWW-Authenticate` (see §2.6).
2. **Audience binding (RFC 8707):** the token's `aud` MUST equal the canonical RS URI `https://api.docket.app/mcp`. Reject mismatches → 401. (If the AS does not stamp `aud` from `resource`, fall back to issuer+client binding + explicit resource allowlist — open issue.)
3. **Issuer:** token `iss` MUST equal the Docket AS issuer. **No token passthrough** — the RS MUST NOT accept tokens minted for GitHub/Drive/Linear, and MUST NOT forward the client's token downstream. Downstream connector calls use **separately-issued** Integration credentials (`Integration.connection.credentials_ref`, data-model §5).
4. **Scope check** for the requested operation (§2.2 table). Insufficient scope at runtime → **403** with step-up `WWW-Authenticate` (§2.6).
5. **Principal resolution:** map `sub`/`userId` → `User`. For org-scoped operations, resolve the human `Actor` for `(user_id, organization_id)`; if no membership row exists → 403. Then evaluate the `Grant` cascade. **Nothing is read from client-asserted org/user fields.**

### 2.6 `WWW-Authenticate` challenges

**401 (no/invalid token):**

```
WWW-Authenticate: Bearer resource_metadata="https://api.docket.app/.well-known/oauth-protected-resource/mcp",
                         scope="work:read"
```

**403 (insufficient_scope, runtime step-up):** include the scopes needed for _this_ operation plus already-granted relevant scopes (spec "Recommended approach"):

```
WWW-Authenticate: Bearer error="insufficient_scope",
                         scope="work:read work:write",
                         resource_metadata="https://api.docket.app/.well-known/oauth-protected-resource/mcp",
                         error_description="Posting an update requires work:write"
```

This is how an agent that started **read-only** (engineering plan / product §4) escalates: a write tool returns 403 → client runs step-up authorization → re-calls with `work:write`.

---

## 3. Tools (mutations)

### 3.1 Conventions

- **Naming:** `snake_case`, verb-first, ≤128 chars (spec §"Tool Names"). Allowed chars: `[A-Za-z0-9_.-]`.
- **`inputSchema` / `outputSchema`:** authored as **Zod** in `@docket/types`, converted to JSON Schema 2020-12 via `zod-to-json-schema` (or Zod 4 native `z.toJSONSchema`). `outputSchema` is provided for **every** tool; the result MUST populate `structuredContent` AND a serialized-JSON `TextContent` block (spec §"Structured Content", backwards compat).
- **`org` argument:** every org-scoped tool takes `org` = the **Organization slug** (matches `docket://{org}/...`; the RS resolves slug→id and authorizes). The Personal space slug is `personal`.
- **Annotations (verified defaults from `ToolAnnotations`):** `readOnlyHint` default `false`; `destructiveHint` default `true` (meaningful only when not read-only); `idempotentHint` default `false`; `openWorldHint` default `true`. Every Docket mutation sets `openWorldHint: false` (closed world — Docket's own DB) **except** `link_external` and `trigger_agent_session` (they touch external systems → `true`). We set all four explicitly to avoid relying on defaults.
- **Errors:** input/validation/business errors → tool result with `isError: true` + actionable text (spec §"Tool Execution Errors"). Unknown tool / malformed → JSON-RPC protocol error. Insufficient scope/grant → JSON-RPC error is NOT used; instead return HTTP 403 at the transport layer for token-scope failures, and `isError:true` for per-resource grant failures (so the model can self-correct, e.g. by requesting access).
- **Idempotency keys:** create-tools accept an optional `idempotency_key` (UUID); replaying with the same key returns the original result (enables safe retries on flaky SSE). Marked `idempotentHint: true` when present-semantics hold.

### 3.2 Annotation quick-reference

| Tool                     | readOnly | destructive | idempotent | openWorld | Scope             |
| ------------------------ | :------: | :---------: | :--------: | :-------: | ----------------- |
| `create_task`            |    F     |      F      |     F      |     F     | `work:write`      |
| `update_task`            |    F     |      F      |     T      |     F     | `work:write`      |
| `move_task`              |    F     |      F      |     T      |     F     | `work:write`      |
| `set_task_assignee`      |    F     |      F      |     T      |     F     | `work:write`      |
| `set_task_delegate`      |    F     |      F      |     T      |     F     | `work:write`      |
| `add_task_dependency`    |    F     |      F      |     T      |     F     | `work:write`      |
| `remove_task_dependency` |    F     |      T      |     T      |     F     | `work:write`      |
| `add_subtask`            |    F     |      F      |     F      |     F     | `work:write`      |
| `set_task_state`         |    F     |      F      |     T      |     F     | `work:write`      |
| `post_update`            |    F     |      F      |     F      |     F     | `work:write`      |
| `create_project`         |    F     |      F      |     F      |     F     | `work:write`      |
| `update_project`         |    F     |      F      |     T      |     F     | `work:write`      |
| `create_program`         |    F     |      F      |     F      |     F     | `work:write`      |
| `create_initiative`      |    F     |      F      |     F      |     F     | `work:write`      |
| `link_initiative`        |    F     |      F      |     T      |     F     | `work:write`      |
| `add_comment`            |    F     |      F      |     F      |     F     | `work:write`      |
| `link_external`          |    F     |      F      |     T      |   **T**   | `connectors:link` |
| `start_connector_link`   |    F     |      F      |     F      |   **T**   | `connectors:link` |
| `trigger_agent_session`  |    F     |      F      |     F      |   **T**   | `agents:run`      |
| `respond_to_session`     |    F     |      F      |     F      |     F     | `agents:run`      |
| `approve_action`         |    F     |      T      |     T      |     F     | `agents:run`      |
| `reject_action`          |    F     |      T      |     T      |     F     | `agents:run`      |
| `cancel_session`         |    F     |      T      |     T      |     F     | `agents:run`      |
| `run_view`               |  **T**   |      —      |     T      |     F     | `work:read`       |
| `search`                 |  **T**   |      —      |     T      |     F     | `work:read`       |
| `add_to_daily_plan`      |    F     |      F      |     T      |     F     | `work:write`      |

> `run_view` and `search` are _read_ operations exposed as **tools** (not resources) because they take rich query arguments — resources are for addressable-by-URI reads. They keep `readOnlyHint:true` and need only `work:read`.

### 3.3 Shared Zod fragments (`@docket/types`)

```ts
const Slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/);
const Id = z.string().uuid();
const ActorRef = z.object({ actor_id: Id }); // Human|Agent (assignable)
const Health = z.enum(['on_track', 'at_risk', 'off_track']);
const Priority = z.enum(['none', 'urgent', 'high', 'medium', 'low']);
const Idem = z.string().uuid().optional(); // idempotency_key

// Returned on most mutations — lets the model fetch the full entity as a resource.
const EntityRef = z.object({
  id: Id,
  type: z.enum([
    'task',
    'project',
    'program',
    'initiative',
    'cycle',
    'team',
    'update',
    'comment',
    'session',
    'agent',
    'view',
  ]),
  uri: z.string(), // docket://{org}/{type}/{id}
  url: z.string().url().optional(), // deep link into the web app
});
```

### 3.4 Tool definitions (input / output / annotations)

Only load-bearing schemas shown in full; the rest follow the same shape.

#### `create_task` — `work:write`

```ts
input: z.object({
  org: Slug,
  team: z.string(),                       // team key (e.g. "ENG") or id
  title: z.string().min(1),
  description: z.string().optional(),
  priority: Priority.default("none"),
  assignee: ActorRef.optional(),          // Human or Agent
  delegate: z.object({ agent_id: Id }).optional(),  // owner stays, agent does it
  project_id: Id.optional(),
  program_id: Id.optional(),
  milestone_id: Id.optional(),
  cycle_id: Id.optional(),
  parent_task_id: Id.optional(),
  due_date: z.string().date().optional(),
  labels: z.array(Id).optional(),
  idempotency_key: Idem,
})
output: z.object({ task: EntityRef, state: z.string() })
annotations: { title: "Create task", readOnlyHint:false, destructiveHint:false,
               idempotentHint:false, openWorldHint:false }
```

#### `update_task` — `work:write`

```ts
input: z.object({
  org: Slug, task_id: Id,
  patch: z.object({                       // all optional; only provided fields change
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: Priority.optional(),
    due_date: z.string().date().nullable().optional(),
    estimate: z.number().nullable().optional(),
    labels: z.array(Id).optional(),       // full replace
  }),
})
output: z.object({ task: EntityRef })
annotations: { title:"Update task", readOnlyHint:false, destructiveHint:false,
               idempotentHint:true, openWorldHint:false }
```

#### `move_task` — `work:write`

Reparent across Project / Program / Triage and/or re-cycle. Idempotent (same target = no-op).

```ts
input: z.object({
  org: Slug, task_id: Id,
  to: z.object({
    project_id: Id.nullable().optional(),   // null → detach from project
    program_id: Id.nullable().optional(),
    milestone_id: Id.nullable().optional(),
    cycle_id: Id.nullable().optional(),
    team: z.string().optional(),            // move between teams (re-keys state)
    triage: z.boolean().optional(),         // true → send to team Triage
  }),
})
output: z.object({ task: EntityRef })
annotations: { ...readOnly:F, destructive:F, idempotent:T, openWorld:F }
```

#### `set_task_assignee` — `work:write`

```ts
input: z.object({ org: Slug, task_id: Id, assignee: ActorRef.nullable() }) // null = unassign
output: z.object({ task: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:T, openWorld:F }
```

#### `set_task_delegate` — `work:write`

Hand the _doing_ to an agent while ownership stays (product §4). Setting a delegate MAY auto-open a session per the agent's `approval_policy` — but does NOT itself dispatch; use `trigger_agent_session`.

```ts
input: z.object({ org: Slug, task_id: Id, delegate: z.object({ agent_id: Id }).nullable() })
output: z.object({ task: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:T, openWorld:F }
```

#### `set_task_state` — `work:write`

```ts
input: z.object({ org: Slug, task_id: Id, state: z.string() })  // must be a state in the team's workflow_states
output: z.object({ task: EntityRef, state: z.string() })
annotations: { readOnly:F, destructive:F, idempotent:T, openWorld:F }
```

#### `add_task_dependency` / `remove_task_dependency` — `work:write`

Org-wide, cross-project, **acyclic** (`task_dependency` edges, data-model §5). The RS MUST reject edges that would create a cycle → `isError:true`.

```ts
// add
input: z.object({ org: Slug, blocking_task_id: Id, blocked_task_id: Id })
output: z.object({ blocking: EntityRef, blocked: EntityRef })
annotations(add): { readOnly:F, destructive:F, idempotent:T, openWorld:F }
// remove — destructive (drops an edge)
annotations(remove): { readOnly:F, destructive:T, idempotent:T, openWorld:F }
```

#### `add_subtask` — `work:write`

```ts
input: z.object({ org: Slug, parent_task_id: Id, title: z.string().min(1), idempotency_key: Idem })
output: z.object({ subtask: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:F }
```

#### `post_update` — `work:write`

A status post on a Project/Program/Initiative; latest update sets the subject's `health` (data-model §5 "Update").

```ts
input: z.object({
  org: Slug,
  subject: z.object({ type: z.enum(["project","program","initiative"]), id: Id }),
  health: Health,
  body: z.string().min(1),
})
output: z.object({ update: EntityRef, subject_health: Health })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:F }
```

#### `create_project` — `work:write`

```ts
input: z.object({
  org: Slug, name: z.string().min(1), description: z.string().optional(),
  lead: ActorRef.optional(), program_id: Id.optional(), team: z.string().optional(),
  start_date: z.string().date().optional(), target_date: z.string().date().optional(),
  initiative_ids: z.array(Id).optional(), idempotency_key: Idem,
})
output: z.object({ project: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:F }
```

#### `update_project` — `work:write`

```ts
input: z.object({ org: Slug, project_id: Id, patch: z.object({
  name: z.string().optional(), description: z.string().optional(),
  status: z.enum(["planned","active","completed","canceled"]).optional(),
  lead: ActorRef.nullable().optional(), program_id: Id.nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  target_date: z.string().date().nullable().optional(),
})})
output: z.object({ project: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:T, openWorld:F }
```

#### `create_program` — `work:write`

Status set `{active, paused, archived}` — **no `completed`** (programs never finish, data-model §5).

```ts
input: z.object({ org: Slug, name: z.string().min(1), description: z.string().optional(),
                  owner: ActorRef.optional(), initiative_ids: z.array(Id).optional(),
                  idempotency_key: Idem })
output: z.object({ program: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:F }
```

#### `create_initiative` — `work:write`

A theme; contains no work. Associates with Programs/Projects (m2m).

```ts
input: z.object({ org: Slug, name: z.string().min(1), description: z.string().optional(),
                  owner: ActorRef.optional(), target_date: z.string().date().optional(),
                  idempotency_key: Idem })
output: z.object({ initiative: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:F }
```

#### `link_initiative` — `work:write`

The m2m theme link (`initiative_project` / `initiative_program`).

```ts
input: z.object({ org: Slug, initiative_id: Id,
  target: z.object({ type: z.enum(["project","program"]), id: Id }),
  action: z.enum(["link","unlink"]).default("link") })
output: z.object({ initiative: EntityRef, target: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:T, openWorld:F }   // unlink is additive-reversible; not flagged destructive
```

#### `add_comment` — `work:write`

Agents post as their own Actor (data-model §5 "Comment"). This is also how a session's `response`/`elicitation` surfaces on a Task.

```ts
input: z.object({ org: Slug,
  subject: z.object({ type: z.enum(["task","project","program","initiative"]), id: Id }),
  body: z.string().min(1), parent_comment_id: Id.optional(), idempotency_key: Idem })
output: z.object({ comment: EntityRef })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:F }
```

#### `link_external` — `connectors:link` · **openWorld:true**

Attach external provenance (Drive doc, GitHub PR, Linear issue) to a Docket entity (data-model §5 "Provenance", "Integration"). The RS uses the org's **Integration credentials** to resolve metadata — **never** the client's token.

```ts
input: z.object({
  org: Slug,
  subject: z.object({ type: z.enum(["task","project"]), id: Id }),
  integration_id: Id,                       // an existing connected Integration in this org
  external_url: z.string().url(),
  role: z.enum(["work","context","signal","time","code"]).default("context"),
})
output: z.object({ subject: EntityRef, provenance: z.object({
  source: z.literal("linked"), external_id: z.string().optional(),
  external_url: z.string().url(), sync_mode: z.enum(["import","mirror"]) }) })
annotations: { readOnly:F, destructive:F, idempotent:T, openWorld:true }
```

#### `start_connector_link` — `connectors:link` · **openWorld:true**

Begin connecting a new external provider. Returns a **URL-mode elicitation** target (spec elicitation; engineering plan §4) so the user completes the connector's OAuth in a browser. Does NOT pass any Docket token to the provider.

```ts
input: z.object({ org: Slug, provider: z.enum(["github","google_drive","gmail",
                  "google_calendar","linear","jira","asana"]),
                  pattern: z.enum(["migration","connector"]) })
output: z.object({ integration_id: Id, authorize_url: z.string().url(),
                   status: z.enum(["pending","connected"]) })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:true }
```

#### `trigger_agent_session` — `agents:run` · **openWorld:true** · **task-augmentable**

Open a Session (data-model §5 "Agent Session"). The MCP tool's job is **create + return the session handle**; the provider dispatch + approval gating live in `agents-sessions`. `execution.taskSupport: "optional"` (long-running).

```ts
input: z.object({
  org: Slug, agent_id: Id,
  trigger: z.enum(["assignment","delegation","mention"]).default("delegation"),
  task_id: Id.optional(),
  prompt: z.string().optional(),            // free-form instruction for this run
})
output: z.object({
  session: EntityRef,                       // type:"session"
  status: z.enum(["pending","running","awaiting_input","awaiting_approval"]),
})
annotations: { title:"Run agent", readOnly:F, destructive:F, idempotent:F, openWorld:true }
execution: { taskSupport: "optional" }
```

#### `respond_to_session` — `agents:run`

Answer an agent's elicitation/question in a live session (mirrors the in-session reply box, product §8.6).

```ts
input: z.object({ org: Slug, session_id: Id, activity_id: Id, body: z.string().min(1) })
output: z.object({ session: EntityRef, status: z.string() })
annotations: { readOnly:F, destructive:F, idempotent:F, openWorld:F }
```

#### `approve_action` / `reject_action` — `agents:run` · **destructive:true**

Resolve a pending agent action under `act_with_approval`. The RS MUST verify the caller's Actor is the configured **approver** (assigner/delegator default; per-Org/Team `approval_routing` override — logic owned by `agents-sessions`). Approve → the action **applies**; reject → it's discarded. Both flagged `destructiveHint:true` (approve commits an external/irreversible effect; reject discards proposed work).

```ts
// approve
input: z.object({ org: Slug, session_id: Id, action_id: Id, note: z.string().optional() })
output: z.object({ session: EntityRef, action_id: Id,
                   result: z.enum(["applied","queued"]) })
// reject
input: z.object({ org: Slug, session_id: Id, action_id: Id, reason: z.string().optional() })
output: z.object({ session: EntityRef, action_id: Id, result: z.literal("rejected") })
annotations: { readOnly:F, destructive:true, idempotent:true, openWorld:F }
```

#### `cancel_session` — `agents:run` · **destructive:true**

```ts
input: z.object({ org: Slug, session_id: Id, reason: z.string().optional() })
output: z.object({ session: EntityRef, status: z.literal("canceled") })
annotations: { readOnly:F, destructive:true, idempotent:true, openWorld:F }
```

#### `run_view` — `work:read` · **task-augmentable (optional)**

Execute a saved View or an ad-hoc query; **permission-filtered** (a guest never sees hidden work, product §8.3). Large views may run as a Task.

```ts
input: z.object({
  org: Slug,
  view: z.union([ z.object({ view_id: Id }),
                  z.object({ query: z.object({       // ad-hoc
                    entity: z.enum(["task","project","program","initiative","cycle"]),
                    filters: z.record(z.string(), z.unknown()).optional(),
                    group_by: z.string().optional(),
                    sort: z.array(z.object({ field: z.string(),
                      dir: z.enum(["asc","desc"]) })).optional(),
                    limit: z.number().int().max(200).default(50),
                    cursor: z.string().optional(),
                  }) }) ]),
})
output: z.object({
  items: z.array(z.object({ ref: EntityRef, fields: z.record(z.string(), z.unknown()) })),
  group_by: z.string().optional(),
  next_cursor: z.string().optional(),
})
annotations: { title:"Run view", readOnly:true, idempotent:true, openWorld:F }
execution: { taskSupport: "optional" }
```

#### `search` — `work:read`

The `Cmd+K`-grade fused search. Hub-global (across the principal's orgs) or org-local.

```ts
input: z.object({
  query: z.string().min(1),
  scope: z.union([ z.literal("hub"), z.object({ org: Slug }) ]).default("hub"),
  types: z.array(z.enum(["task","project","program","initiative","cycle","team",
                         "update","comment","agent","session","view"])).optional(),
  limit: z.number().int().max(50).default(20),
})
output: z.object({ results: z.array(z.object({
  ref: EntityRef, title: z.string(), snippet: z.string().optional(),
  org: Slug })) })
annotations: { readOnly:true, idempotent:true, openWorld:F }
```

#### `add_to_daily_plan` — `work:write`

Pull a (possibly cross-org) task into the Hub's personal Daily Plan (data-model §5 "Daily Plan"). Hub-scoped, not org-scoped — authorized by `sub` ownership of the Hub.

```ts
input: z.object({ org: Slug, task_id: Id, date: z.string().date(),
                  timebox: z.object({ start: z.string(), end: z.string() }).optional() })
output: z.object({ plan_item: z.object({ id: Id, date: z.string().date(),
                   task: EntityRef, status: z.enum(["planned","done"]) }) })
annotations: { readOnly:F, destructive:F, idempotent:T, openWorld:F }
```

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
| `docket://{org}/view/{id}`       | Saved View    | View definition (permission-filtered); the _results_ come from `run_view`.                                                                                                                                                                                 |

**`resources/read` contract:** returns `contents: [{ uri, mimeType: "application/json", text: <JSON projection> }]`. The projection is a **Zod-validated** read DTO in `@docket/types` (one per type) so the shape is stable. Not-found → JSON-RPC `-32002`; no-grant → `-32002` (do NOT leak existence to unauthorized callers — return not-found, not forbidden).

### 4.4 Subscriptions

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
    "tools": { "listChanged": true }, // tool set varies by org/connectors → may change per session
    "resources": { "subscribe": true, "listChanged": true },
    "completions": {}, // arg autocompletion for resource-template vars + tool enums
    "logging": {}, // structured server logs to the client
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
- **`prompts`:** NOT advertised in v1 (no server-defined prompt templates; deferred). Listed here explicitly so implementers don't add it speculatively.
- **`completions: {}`** — implement `completion/complete` for: resource-template `{id}` vars (return matching entities the principal can see, by recent/active), `{org}` (the principal's org slugs), and tool enum args (e.g. `team`, `state` from the team's `workflow_states`, `provider`).
- **`logging: {}`** — emit `notifications/message` at `info`/`warning`/`error`; never log tokens or credentials.
- **`tasks`** — declare `tasks.requests.tools.call` so clients MAY augment `trigger_agent_session` / `run_view` calls as tasks. Tasks are **authorization-context-bound** (spec security): `tasks/get|result|cancel|list` MUST reject task IDs not owned by the requestor's token context. Adopt behind a feature flag (open issue: experimental churn).
- **Pagination:** honor `cursor`/`nextCursor` on `tools/list`, `resources/list`, `resources/templates/list`, `tasks/list`, and inside `run_view`/`search`.
- **Lifecycle utilities:** support `ping`, progress (`notifications/progress` with the request's `progressToken`), and cancellation (`notifications/cancelled`).

---

## 6. Build Checklist (this area)

1. Mount `StreamableHTTPServerTransport` (stateful, Redis-backed) at `/mcp` in `apps/api`; wire `withMcpAuth(auth, …)`; register CORS + Origin allowlist **before** the handler.
2. Serve PRM at `/.well-known/oauth-protected-resource` **and** `/.well-known/oauth-protected-resource/mcp`; serve AS metadata via `oAuthDiscoveryMetadata(auth)`; confirm `code_challenge_methods_supported:["S256"]` and `client_id_metadata_document_supported:true` appear.
3. Register the 4 scopes in `mcp().oidcConfig.scopes`; implement the token-validation middleware: bearer → `getMcpSession` → audience(`aud`==RS URI) → issuer → scope → principal(`sub`→User→Actor) → grant cascade. Emit the two `WWW-Authenticate` challenge forms.
4. Author every tool's Zod input/output + annotations in `@docket/types`; register tools with `outputSchema` (JSON Schema 2020-12) and `structuredContent`+text results; gate each by scope (table §3.2) AND grant.
5. Implement the `docket://` resource reader (Zod read DTOs), `resources/list`, `resources/templates/list`, `resources/read`, `resources/subscribe`, and the `updated`/`list_changed` notification fan-out from the service-layer event bus.
6. Implement `completion/complete`, `logging`, `ping`/progress/cancel; gate `tasks` behind `MCP_TASKS_ENABLED`.
7. Enforce **no downstream token passthrough**: connector resolution in `link_external`/`start_connector_link` uses `Integration.credentials_ref`, never the inbound token.
8. Env contract (validated in `@docket/env`, dev mirrors prod): `MCP_CANONICAL_URL`, `MCP_ALLOWED_ORIGINS`, `MCP_SESSION_STORE_URL` (Redis), `MCP_TASKS_ENABLED`, plus the shared `BETTER_AUTH_URL`/secret/DB vars. The bootstrap script must print/guide setup for each and wire the real AS + Redis (no stubs).
9. Playwright/integration: a `connect MCP client → discover PRM/AS → CIMD register → consent → call read tool → step-up to write` flow, plus a `trigger_agent_session → subscribe session resource → approve_action` flow, as declared flows in the e2e flow registry (engineering plan §6).
