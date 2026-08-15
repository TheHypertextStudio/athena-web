# Connecting AI Agents to Docket via MCP

Docket ships a first-party [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-capable agent — Claude Code, Claude Desktop, claude.ai, Codex, Cursor, Windsurf, or anything else that speaks Streamable HTTP + OAuth 2.1 — can read and act on your Docket workspace.

> **The published version of this guide is [`apps/docs/developers/connect-an-agent-mcp.mdx`](../../apps/docs/developers/connect-an-agent-mcp.mdx)**, which is what external readers see at `/docs`. Treat that page as the one to keep correct; this file remains for engineers who want the same material beside the rest of `docs/engineering/`.
>
> The in-app equivalent lives at **Settings → Connected apps**, which shows the same setup snippets with your deployment's URL pre-filled. The snippets below MUST stay in sync with `apps/web/src/components/settings/mcp-clients.ts` — that catalog is the source of truth.

## The endpoint

```
https://<api-origin>/mcp
```

For the hosted deployment that is `https://docket-api.hypertext.studio/mcp` — note the **API** origin, not the web app origin. The endpoint speaks MCP Streamable HTTP: `POST` for messages, `GET` for the server→client stream, `DELETE` to end a session. Requests themselves are stateless, so a client may work without ever holding a session. `initialize` returns an `Mcp-Session-Id` anyway, and presenting it unlocks the notification channel described under **Live updates** below.

Discovery documents (what OAuth-aware clients fetch automatically):

- `GET /.well-known/oauth-protected-resource/mcp` — Protected Resource Metadata (RFC 9728), names the authorization server.
- `GET /.well-known/oauth-authorization-server` — AS metadata (RFC 8414), advertising the authorize/token/register endpoints, PKCE S256, and CIMD support.

## Authorization

The server is an OAuth 2.1 resource server; Better Auth (mounted at `/api/auth/*` on the same origin) is the authorization server. A connecting client:

1. **Registers** — either classic Dynamic Client Registration (`POST /api/auth/mcp/register`) or a
   URL-form `client_id` pointing at a Client ID Metadata Document (CIMD). A CIMD URL must use HTTPS,
   resolve only to public addresses, match the fetched document exactly, and stay within the
   redirect and response bounds enforced by the server. These checks apply to every client; there
   is no vendor or client-host allowlist.
2. **Authorizes** — the browser opens Docket's sign-in (`/sign-in` on the web origin) and the consent screen (`/oauth/authorize`), where you approve the requested scopes.
3. **Exchanges the code** for an access token (PKCE, 15-minute expiry, 30-day refresh token) audience-bound to the `/mcp` resource URL (RFC 8707).

Every MCP call then carries `Authorization: Bearer <token>`. Scopes are the first authorization layer; your per-org roles and grants remain binding underneath — a token can never do more than the human who consented to it.

| Scope             | Grants                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| `work:read`       | Read work — run views, search, read tasks/projects/hub resources (default) |
| `work:write`      | Create & update work — tasks, projects, initiatives, comments, updates     |
| `agents:run`      | Manage agents — trigger sessions, approve/reject proposed actions          |
| `connectors:link` | Link external items (GitHub/Linear references) onto work                   |

A read-only token calling a write tool gets a `403` with a `WWW-Authenticate: Bearer error="insufficient_scope"` challenge; well-behaved clients re-authorize (step-up) automatically.

## Client setup

Replace `https://docket-api.hypertext.studio/mcp` with your deployment's MCP URL if self-hosting.

### Claude Code

```sh
claude mcp add docket https://docket-api.hypertext.studio/mcp
```

Run once in any terminal; the server is available globally across projects. Claude Code walks the OAuth flow in your browser on first use.

### Claude Desktop

1. In the chat bar, open the menu (+) and select **Connectors → Manage Connectors**
2. Click the **+** icon and select **Add custom connector**
3. Enter "Docket" as the name and paste the MCP URL
4. Click **Add** — your browser opens to complete authorization
5. Sign in to Docket and approve the requested permissions

### claude.ai (web)

**Settings → Connectors → Add custom connector**, paste the MCP URL, and complete the browser authorization. Same flow as Claude Desktop.

### Codex

Add to `~/.codex/config.toml` (or `.codex/config.toml` in a trusted repo for per-project scope):

```toml
[mcp_servers.docket]
url = "https://docket-api.hypertext.studio/mcp"
```

Then authorize:

```sh
codex mcp login docket
```

### Cursor

Use the install deep link from **Settings → Connected apps** in Docket, or add to `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "docket": { "url": "https://docket-api.hypertext.studio/mcp" } } }
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json` (note `serverUrl`, not `url`):

```json
{ "mcpServers": { "docket": { "serverUrl": "https://docket-api.hypertext.studio/mcp" } } }
```

### Anything else

Point any MCP-compatible client at the MCP URL. Clients that implement the MCP authorization spec handle registration, consent, and token refresh automatically via the discovery documents above.

## Let Athena use another MCP server

Athena can also be an MCP **client** for a workspace. Go to **Settings → Connections → MCP
connectors**, enter the server URL, choose **Sign in and approve access**, and finish the provider's
browser approval. Docket then verifies `tools/list` before Athena receives any of the server's
tools. They are namespaced as `<connector>__<tool>` so external tools cannot collide with Docket
tools.

For example, Sunsama's MCP endpoint is:

```
https://api.sunsama.com/mcp
```

The connection follows the current MCP OAuth flow: protected-resource discovery (RFC 9728),
authorization-server discovery, PKCE, the RFC 8707 resource indicator, and URL-form client IDs
(CIMD) when the provider advertises them. Docket uses dynamic client registration only when a
server does not advertise CIMD. The approved organization credential, registration state, and
PKCE state are encrypted at rest; Athena receives only the resulting server tools, never a raw
user token. Short-lived credentials refresh before an agent run uses them.

Public MCP servers and organization-held bearer credentials remain available as explicit advanced
options. They do not bypass Docket's approval policy: an external tool's declared annotations and
the normal action policy still decide whether Athena may execute it or must request approval.

## What's exposed

- **Tools** (25) — named for what someone is trying to do, not for the table underneath:
  - _Read_ — `workspaces` (which workspaces you belong to), `find` (ranked search), `list_work` (filtered sets), `get` (hydrate by id or name), `brief` (what needs me today).
  - _Write_ — `capture` (a sentence becomes a task), `organize` (a whole plan in one call, reconciled so a re-run does not duplicate), `update` (change work by describing which work), `link`, `archive`, `comment`, `report_status`, `plan_day`, `undo`.
  - _Time and reflection_ — `track`, `retrospect`.
  - _Repeating work_ — `define_process`, `schedule_process`, `repeat_task`.
  - _Agents and connectors_ — `run_agent`, `manage_session`, `link_external`, `acknowledge_directive`, `pause_athena_assignment_trigger`, `remove_athena_assignment_trigger`.

  > This count was wrong for a long time — it read 15 while 25 were registered, and
  > [`specs/mcp-surface.md`](specs/mcp-surface.md) copied a similarly wrong number (18 + 2) from
  > it. `packages/test-utils/tests/docs-policies/docs-site-coverage.test.ts` now scans the
  > `registerTool` call sites and fails when a tool is missing from the published page, so the
  > external copy cannot drift again. This list is maintained by hand and is not covered by that
  > test; when the two disagree, believe `apps/docs/developers/mcp-tools-and-resources.mdx`.

  Every write records an undoable change set, and every id parameter also accepts a name.
  - `find` is ranked relevance search over the whole workspace — tasks, projects, programs, initiatives, cycles, milestones, comments, updates, attachments, calendar events, agent sessions, teams, members, labels. It reads the same permission-filtered search index the web app uses, so results are trimmed to what the caller may actually see, and it trails writes by a moment. Use `list_work` to enumerate live rows by exact criteria — it filters by team, project, assignee, delegate, state, priority, label, cycle, due window, blocked-ness, and unfiled (the triage queue). A filter the chosen entity has no column for is rejected, naming the ones it does, rather than silently ignored.
  - `get` reads one or more entities in full — a task with its dependencies and subtasks, a project with its milestones and latest update. Refs you cannot see come back in `missing` instead of failing the batch.

- **Names work anywhere ids do** — `teamId: "Platform"`, `assigneeId: "Sarah"`, `state: "In Review"` all resolve server-side. Matching runs exact → prefix → substring and only accepts an unambiguous hit, so an ambiguous name comes back listing the candidates rather than guessing, and an unknown workflow state comes back listing the team's legal ones.
- **Resources** — reads are modeled as `docket://` resources: `docket://orgs`, `docket://hub/today`, `docket://hub/inbox`, `docket://hub/portfolio`, and templated per-entity URIs (`docket://{org}/{type}/{id}`), all permission-gated with existence-hiding.
- **Prompts** — workspace-context bootstrap prompts for agent sessions.
- **Live updates** — a client that completes `initialize` gets an `Mcp-Session-Id` and can hold a
  `GET /mcp` stream open to receive `notifications/resources/updated` for anything it has
  `resources/subscribe`d to, `notifications/tools/list_changed` when a grant change alters what it
  may call, and `notifications/message` at whatever level it sets via `logging/setLevel`. Delivery
  is best-effort and not replayed — treat an update as a prompt to re-read, not as the data.
  `DELETE /mcp` ends the session. See [`specs/mcp-notifications.md`](specs/mcp-notifications.md).

The authoritative surface contract is [`specs/mcp-surface.md`](specs/mcp-surface.md).

## Revoking access

**Settings → Connected apps** lists every client you have consented to, with per-client revoke (deletes the consent and its access tokens). Access tokens also expire on their own after 15 minutes; refresh tokens after 30 days.

## Self-hosting: the server is on by default

The OAuth AS/RS is core functionality — it is **always on**, in every deploy, with no MCP-specific
configuration required. Its URLs derive from the base config every deploy already sets:
`MCP_ISSUER_URL` from `API_URL`, `MCP_RESOURCE_URL` from `${API_URL}/mcp`, and
`OIDC_LOGIN_PAGE_URL` from `${WEB_URL}/sign-in`. Set one of those three only to override its
derivation (for example, a non-standard sign-in route). `/mcp` requires a Bearer token. Requests
without an `Origin` are valid for native clients; requests with an `Origin` must use an exact HTTPS
origin, except local HTTP loopback during non-production development. Origin validation is a
protocol safety check, not a client approval mechanism.

Dynamic client registration, token exchange, introspection, revocation, the JWKS, and the AS/RS
discovery documents are public by RFC 7591/6749/7662/7009/8414/9728 design — a client
authenticates itself, never with a session cookie — so they run under an open, credential-free
CORS policy (`apps/api/src/cors.ts`) rather than `BETTER_AUTH_TRUSTED_ORIGINS`. Any MCP client's
web UI can call them without an origin ever being added to a list; nothing needs to change here
for a new one to work.
