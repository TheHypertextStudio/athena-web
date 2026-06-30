/**
 * `@docket/api` — the Streamable HTTP MCP server (one `/mcp` endpoint).
 *
 * @remarks
 * Implements the MCP Streamable HTTP transport (spec 2025-11-25) over a single Hono
 * route handling POST (JSON-RPC) and GET (SSE). Every request: (1) passes the Origin
 * DNS-rebinding guard and resolves a Better Auth session via {@link resolveMcpContext}
 * (cookie OR Bearer) — a 401 Problem otherwise; then (2) gets a FRESH, identity-bound
 * {@link McpServer} + stateless {@link WebStandardStreamableHTTPServerTransport}
 * (required because the stateless transport is single-use per request). Tools and
 * resources reuse the same `db` + {@link canActor} engine as the RPC routers.
 *
 * OAuth 2.1 Resource-Server discovery metadata + Dynamic Client Registration are a
 * documented follow-up; for now the Better Auth session/bearer guard IS the auth.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context } from 'hono';

import { env } from '../env';
import { ApiError } from '../error';
import type { McpContext } from './auth';
import { resolveMcpContext } from './auth';
import { createMcpCatalog } from './catalog';
import { registerPrompts } from './prompts';
import { registerResources } from './resources';
import { challenge401, challenge403, MCP_SCOPES, TOOL_SCOPE } from './scope';
import { taskStoreForContext } from './task-store';
import { registerTools } from './tools';

/** The advertised MCP server identity (name + version). */
const SERVER_INFO = { name: 'docket', version: '1.0.0' } as const;

/**
 * Build a fresh MCP server for one request, bound to the authenticated caller.
 *
 * @remarks
 * A new instance per request is required by the stateless Streamable HTTP transport
 * (which handles exactly one request) and keeps each server pinned to a single
 * identity so authorization can never cross requests.
 *
 * @param ctx - The authenticated MCP caller.
 * @returns the configured {@link McpServer} with tools + resources registered.
 */
function buildServer(ctx: McpContext): McpServer {
  const tasksEnabled = env.MCP_TASKS_ENABLED;
  // Advertise the tool/resource/prompt/completion/logging capabilities Docket implements
  // (mcp-surface.md section 5). `resources.subscribe`/`listChanged` and `tools.listChanged`
  // are declared so a future event-bus fan-out can flip without re-negotiation; the
  // SDK populates `completions` automatically from the resource-template complete callbacks
  // and `prompts` from registerPrompt, but we declare them so the shape is explicit.
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      completions: {},
      logging: {},
      ...(tasksEnabled
        ? { tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } }
        : {}),
    },
    ...(tasksEnabled ? { taskStore: taskStoreForContext(ctx) } : {}),
  });
  const catalog = createMcpCatalog(server, { tasksEnabled });
  registerTools(catalog, ctx);
  registerResources(catalog, ctx);
  registerPrompts(catalog, ctx);
  catalog.installListHandlers(ctx);
  return server;
}

/**
 * The canonical Resource Server URI advertised to MCP clients (mcp-surface.md §2.3).
 *
 * @remarks
 * `MCP_RESOURCE_URL` (e.g. `https://api.docket.app/mcp`) when configured; otherwise the
 * conventional `<request-origin>/mcp`, derived per request, so discovery still works in a
 * dev deploy that has not set the canonical URL.
 *
 * @param c - The Hono context (for the request origin fallback).
 * @returns the canonical RS URI with no trailing slash.
 */
function canonicalResourceUrl(c: Context): string {
  if (env.MCP_RESOURCE_URL) return env.MCP_RESOURCE_URL.replace(/\/$/, '');
  const url = new URL(c.req.url);
  return `${url.origin}/mcp`;
}

/**
 * The Protected Resource Metadata URL the `WWW-Authenticate` challenges point at
 * (RFC 9728 §3.1, the `/mcp` sub-path form).
 *
 * @param c - The Hono context.
 * @returns the absolute `…/.well-known/oauth-protected-resource/mcp` URL.
 */
function resourceMetadataUrl(c: Context): string {
  const origin = new URL(canonicalResourceUrl(c)).origin;
  return `${origin}/.well-known/oauth-protected-resource/mcp`;
}

/**
 * Render an RFC 9457 Problem response for an MCP auth/transport failure.
 *
 * @remarks
 * On 401 it emits the full mcp-surface.md §2.6 challenge — `Bearer
 * resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="work:read"` — so
 * a spec-compliant client can discover the Authorization Server and run the
 * connect→discover→consent flow.
 *
 * @param c - The Hono context.
 * @param err - The thrown error.
 * @returns the `application/problem+json` Response.
 */
function problem(c: Context, err: unknown): Response {
  const apiErr =
    err instanceof ApiError ? err : new ApiError(500, 'internal', 'Internal server error');
  c.header('Content-Type', 'application/problem+json');
  if (apiErr.status === 401) {
    c.header('WWW-Authenticate', challenge401(resourceMetadataUrl(c)));
  }
  return c.json(
    {
      type: `https://docket.dev/problems/${apiErr.code}`,
      title: apiErr.message,
      status: apiErr.status,
      code: apiErr.code,
    },
    apiErr.status,
  );
}

/**
 * Serve the OAuth 2.0 Protected Resource Metadata document (RFC 9728) for `/mcp`.
 *
 * @remarks
 * Mounted at both `/.well-known/oauth-protected-resource` and the `…/mcp` sub-path
 * (mcp-surface.md §2.3). Advertises the canonical resource URI, the single Docket AS
 * issuer (`MCP_ISSUER_URL`), the four supported scopes, and `bearer_methods_supported`
 * so a client can locate the AS, register/consent, and mint an audience-bound token.
 *
 * @param c - The Hono context.
 * @returns the PRM JSON document.
 */
export function protectedResourceMetadata(c: Context): Response {
  const resource = canonicalResourceUrl(c);
  const issuer = env.MCP_ISSUER_URL?.replace(/\/$/, '') ?? new URL(resource).origin;
  return c.json({
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
  });
}

/**
 * Serve the OAuth 2.0 Authorization Server metadata pointer (RFC 8414).
 *
 * @remarks
 * The single Docket AS is Better Auth mounted at `/api/auth`, whose `mcp()`/`oidcProvider`
 * plugin already serves the canonical discovery document (with `issuer`, the authorization/
 * token/registration endpoints, `code_challenge_methods_supported:["S256"]`, and the scope
 * set) at `<issuer>/.well-known/openid-configuration`. The RS-level
 * `/.well-known/oauth-authorization-server` route 307-redirects there so a client that
 * discovered the AS via the PRM `authorization_servers` entry lands on the live document
 * (mcp-surface.md §2.3) — without re-importing the heavy Better Auth plugin chain.
 *
 * @param c - The Hono context.
 * @returns a 307 redirect to the AS's OIDC discovery document.
 */
export function authorizationServerMetadata(c: Context): Response {
  const resource = canonicalResourceUrl(c);
  const issuer = env.MCP_ISSUER_URL?.replace(/\/$/, '') ?? new URL(resource).origin;
  if (typeof c.redirect === 'function') {
    return c.redirect(`${issuer}/.well-known/openid-configuration`, 307);
  }
  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/api/auth/mcp/authorize`,
    token_endpoint: `${issuer}/api/auth/mcp/token`,
    registration_endpoint: `${issuer}/api/auth/mcp/register`,
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...MCP_SCOPES],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
  });
}

/** A `tools/call` JSON-RPC request body (the only shape the scope preflight inspects). */
interface ToolsCallBody {
  readonly method?: unknown;
  readonly params?: { readonly name?: unknown };
}

/** JSON-RPC request IDs are strings or integer numbers. */
type JsonRpcRequestId = string | number;

/** A minimal JSON-RPC message shape for transport-level request lifecycle checks. */
interface JsonRpcMessageBody {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

interface ActiveMcpRequest {
  cancel(reason?: string): void;
}

interface CancellationNotification {
  readonly requestId: JsonRpcRequestId;
  readonly reason?: string;
}

const activeMcpRequests = new Map<string, ActiveMcpRequest>();

/** Parse a request body text to JSON, returning `null` on empty/malformed input. */
function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
    /* v8 ignore next 3 -- @preserve defensive: a malformed body is left to the transport's own JSON-RPC error */
  } catch {
    return null;
  }
}

/** Convert a JSON-RPC request ID to a collision-resistant process-local map key. */
function requestKey(id: JsonRpcRequestId): string {
  return `${typeof id}:${String(id)}`;
}

/** Whether `value` is a JSON-RPC request ID. */
function isRequestId(value: unknown): value is JsonRpcRequestId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value));
}

/** Return a normalized array of JSON-RPC messages from a parsed body. */
function rpcMessages(body: unknown): readonly JsonRpcMessageBody[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter(
    (message): message is JsonRpcMessageBody => typeof message === 'object' && message !== null,
  );
}

/** Whether a request is task-augmented and must be cancelled via `tasks/cancel`. */
function isTaskAugmentedRequest(message: JsonRpcMessageBody): boolean {
  if (typeof message.params !== 'object' || message.params === null) return false;
  return 'task' in message.params;
}

/**
 * IDs for in-progress requests that may be cancelled by `notifications/cancelled`.
 *
 * @remarks
 * `initialize` and task-augmented requests are excluded because the MCP spec gives each
 * of those flows distinct cancellation rules.
 */
function cancellableRequestIds(body: unknown): readonly JsonRpcRequestId[] {
  return rpcMessages(body)
    .filter(
      (message) =>
        message.jsonrpc === '2.0' &&
        typeof message.method === 'string' &&
        message.method !== 'initialize' &&
        isRequestId(message.id) &&
        !isTaskAugmentedRequest(message),
    )
    .map((message) => message.id as JsonRpcRequestId);
}

/** Extract fire-and-forget cancellation notifications from a parsed JSON-RPC body. */
function cancellationNotifications(body: unknown): readonly CancellationNotification[] {
  return rpcMessages(body)
    .filter((message) => message.jsonrpc === '2.0' && message.method === 'notifications/cancelled')
    .map((message): CancellationNotification | null => {
      const params =
        typeof message.params === 'object' && message.params !== null
          ? (message.params as { readonly requestId?: unknown; readonly reason?: unknown })
          : null;
      if (!params || !isRequestId(params.requestId)) return null;
      if (typeof params.reason === 'string')
        return { requestId: params.requestId, reason: params.reason };
      return { requestId: params.requestId };
    })
    .filter((message): message is CancellationNotification => Boolean(message));
}

/**
 * The required scope for a parsed JSON-RPC body when it is a `tools/call`, else null.
 *
 * @remarks
 * Best-effort and non-throwing: a body that is not a recognized `tools/call` for a known
 * tool yields `null` (the transport then handles it normally). When it IS a known tool,
 * its §3.2 scope is returned so {@link mcpHandler} can emit the §2.6 403 step-up challenge
 * at the transport layer BEFORE dispatch — the exact escalation path for a read-only agent.
 */
function toolScopeForBody(body: unknown): (typeof TOOL_SCOPE)[string] | null {
  if (typeof body !== 'object' || body === null) return null;
  const { method, params } = body as ToolsCallBody;
  if (method !== 'tools/call' || typeof params?.name !== 'string') return null;
  return TOOL_SCOPE[params.name] ?? null;
}

/**
 * Emit the §2.6 403 `insufficient_scope` step-up Problem when a `tools/call` needs a scope
 * the caller's token lacks, or `null` to proceed.
 *
 * @param c - The Hono context.
 * @param ctx - The authenticated caller (its verified scopes).
 * @param body - The already-parsed request body.
 * @returns a 403 Problem Response, or `null` when scope is satisfied / not applicable.
 */
function scopeStepUp(c: Context, ctx: McpContext, body: unknown): Response | null {
  const required = toolScopeForBody(body);
  if (!required || ctx.scopes.includes(required)) return null;
  c.header('Content-Type', 'application/problem+json');
  c.header('WWW-Authenticate', challenge403(resourceMetadataUrl(c), required, ctx.scopes));
  return c.json(
    {
      type: 'https://docket.dev/problems/insufficient_scope',
      title: `This operation requires the '${required}' scope`,
      status: 403,
      code: 'insufficient_scope',
      scope: required,
    },
    403,
  );
}

/** Close transport resources after the response stream completes or is cancelled. */
function responseWithCleanup(response: Response, cleanup: () => void): Response {
  let cleaned = false;
  const cleanupOnce = (): void => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };

  if (!response.body) {
    cleanupOnce();
    return response;
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {
            cleanupOnce();
            controller.close();
            return;
          }
          controller.enqueue(chunk.value);
        }
      } catch (err) {
        cleanupOnce();
        controller.error(err);
      }
    },
    async cancel(reason) {
      cleanupOnce();
      await reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * The Hono handler for `POST`/`GET` `/mcp` (Streamable HTTP).
 *
 * @remarks
 * Authenticates first (Origin guard + Bearer/cookie session resolution, incl. the
 * audience-bound token's verified scopes), then — for a `tools/call` POST — runs the §2.6
 * scope step-up preflight: a token whose scope set does not cover the requested tool gets a
 * 403 `insufficient_scope` with the step-up `WWW-Authenticate` header, so a read-only client
 * can re-authorize for the missing scope. Otherwise it delegates the raw web `Request` to a
 * fresh stateless transport and returns its web `Response` (JSON for POST, SSE for GET). On
 * auth failure it returns a Problem and never constructs an MCP server.
 *
 * @param c - The Hono context for the `/mcp` request.
 * @returns the transport's Response, a 403 step-up Problem, or a Problem on auth failure.
 */
export async function mcpHandler(c: Context): Promise<Response> {
  let ctx: McpContext;
  try {
    ctx = await resolveMcpContext(c.req.raw.headers);
  } catch (err) {
    return problem(c, err);
  }

  // Read the body once so we can both run the scope preflight AND hand an intact request to
  // the transport (the web `Request` body is a single-use stream).
  let raw = c.req.raw;
  let body: unknown = null;
  if (raw.method === 'POST') {
    const text = await raw.clone().text();
    body = safeJson(text);

    const cancellations = cancellationNotifications(body);
    if (cancellations.length > 0) {
      for (const cancellation of cancellations) {
        activeMcpRequests.get(requestKey(cancellation.requestId))?.cancel(cancellation.reason);
      }
      return new Response(null, { status: 202 });
    }

    const stepUp = scopeStepUp(c, ctx, body);
    if (stepUp) return stepUp;
    // Rebuild the request from the buffered text since `clone()` above already tee'd it.
    raw = new Request(raw.url, { method: raw.method, headers: raw.headers, body: text });
  }

  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  const activeIds = raw.method === 'POST' ? [...new Set(cancellableRequestIds(body))] : [];
  let cleaned = false;
  const cleanup = (reason?: string): void => {
    if (cleaned) return;
    cleaned = true;
    for (const id of activeIds) {
      const key = requestKey(id);
      const active = activeMcpRequests.get(key);
      if (active?.cancel === activeEntry.cancel) activeMcpRequests.delete(key);
    }
    if (reason) console.info(`MCP request cancelled: ${reason}`);
    void transport.close();
    void server.close();
  };
  const activeEntry: ActiveMcpRequest = {
    cancel: (reason) => {
      cleanup(reason);
    },
  };
  for (const id of activeIds) activeMcpRequests.set(requestKey(id), activeEntry);

  try {
    const response = await transport.handleRequest(raw);
    return responseWithCleanup(response, cleanup);
  } catch (err) {
    cleanup();
    throw err;
  }
}
