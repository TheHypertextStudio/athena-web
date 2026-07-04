# Connecting AI Agents to Docket via MCP

Docket ships a first-party [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-capable agent — Claude Code, Claude Desktop, claude.ai, Codex, Cursor, Windsurf, or anything else that speaks Streamable HTTP + OAuth 2.1 — can read and act on your Docket workspace.

> The in-app equivalent of this guide lives at **Settings → Authorized apps** (personal workspace), which shows the same setup snippets with your deployment's URL pre-filled. The snippets below MUST stay in sync with `apps/web/src/components/settings/mcp-clients.ts` — that catalog is the source of truth.

## The endpoint

```
https://<api-origin>/mcp
```

For the hosted deployment that is `https://docket-api.hypertext.studio/mcp` — note the **API** origin, not the web app origin. The endpoint speaks MCP Streamable HTTP (`POST` for messages, `GET` for the SSE stream) and is stateless: no `Mcp-Session-Id` continuity is required or offered.

Discovery documents (what OAuth-aware clients fetch automatically):

- `GET /.well-known/oauth-protected-resource/mcp` — Protected Resource Metadata (RFC 9728), names the authorization server.
- `GET /.well-known/oauth-authorization-server` — AS metadata (RFC 8414), advertising the authorize/token/register endpoints, PKCE S256, and CIMD support.

## Authorization

The server is an OAuth 2.1 resource server; Better Auth (mounted at `/api/auth/*` on the same origin) is the authorization server. A connecting client:

1. **Registers** — either classic Dynamic Client Registration (`POST /api/auth/mcp/register`) or a URL-form `client_id` pointing at a Client ID Metadata Document (CIMD). CIMD hosts are allowlisted via `MCP_CIMD_TRUST_ALLOWLIST` when `MCP_CIMD_STRICT` is on.
2. **Authorizes** — the browser opens Docket's sign-in (`/sign-in` on the web origin) and the consent screen (`/oauth/authorize`), where you approve the requested scopes.
3. **Exchanges the code** for an access token (PKCE, 15-minute expiry, 30-day refresh token) audience-bound to the `/mcp` resource URL (RFC 8707).

Every MCP call then carries `Authorization: Bearer <token>`. Scopes are the first authorization layer; your per-org roles and grants remain binding underneath — a token can never do more than the human who consented to it.

| Scope             | Grants                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| `work:read`       | Read work — run views, search, read tasks/projects/hub resources (default) |
| `work:write`      | Create & update work — tasks, projects, initiatives, comments, updates     |
| `agents:run`      | Manage agents — trigger sessions, approve/reject proposed actions          |
| `connectors:link` | Link external items (GitHub/Linear/Slack references) onto work             |

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

Use the install deep link from **Settings → Authorized apps** in Docket, or add to `~/.cursor/mcp.json`:

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

## What's exposed

- **Tools** (~26) — task CRUD and workflow (`create_task`, `update_task`, `move_task`, `assign_task`, `set_task_state`, dependencies, subtasks), projects/programs/initiatives, comments and status updates, daily-plan, `run_view` + `search`, agent-session control (`trigger_agent`, `approve_action`, …), and `link_external`.
- **Resources** — reads are modeled as `docket://` resources: `docket://orgs`, `docket://hub/today`, `docket://hub/inbox`, `docket://hub/portfolio`, and templated per-entity URIs (`docket://{org}/{type}/{id}`), all permission-gated with existence-hiding.
- **Prompts** — workspace-context bootstrap prompts for agent sessions.

The authoritative surface contract is [`specs/mcp-surface.md`](specs/mcp-surface.md).

## Revoking access

**Settings → Authorized apps** lists every client you have consented to, with per-client revoke (deletes the consent and its access tokens). Access tokens also expire on their own after 15 minutes; refresh tokens after 30 days.

## Self-hosting: the server is on by default

The OAuth AS/RS is core functionality — it is **always on**, in every deploy, with no MCP-specific configuration required. Its URLs derive from the base config every deploy already sets: `MCP_ISSUER_URL` from `API_URL`, `MCP_RESOURCE_URL` from `${API_URL}/mcp`, and `OIDC_LOGIN_PAGE_URL` from `${WEB_URL}/sign-in`. Set one of those three only to override its derivation (e.g. a non-standard sign-in route). `MCP_ALLOWED_ORIGINS` is a distinct security allowlist (browser Origins permitted to hit `/mcp`) and is always set explicitly per environment — see [deployment.md](deployment.md) and `.env.example`.
