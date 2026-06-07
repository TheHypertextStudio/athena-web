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

import { ApiError } from '../error';
import type { McpContext } from './auth';
import { resolveMcpContext } from './auth';
import { registerResources } from './resources';
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
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {} },
  });
  registerTools(server, ctx);
  registerResources(server, ctx);
  return server;
}

/**
 * Render an RFC 9457 Problem response for an MCP auth/transport failure.
 *
 * @param c - The Hono context.
 * @param err - The thrown error.
 * @returns the `application/problem+json` Response.
 */
function problem(c: Context, err: unknown): Response {
  const apiErr =
    err instanceof ApiError ? err : new ApiError(500, 'internal', 'Internal server error');
  c.header('Content-Type', 'application/problem+json');
  if (apiErr.status === 401) c.header('WWW-Authenticate', 'Bearer');
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
 * The Hono handler for `POST`/`GET` `/mcp` (Streamable HTTP).
 *
 * @remarks
 * Authenticates first (Origin guard + session), then delegates the raw web `Request`
 * to a fresh stateless transport and returns its web `Response` (JSON for POST,
 * SSE for GET) directly. On auth failure it returns a Problem response and never
 * constructs an MCP server, so unauthenticated callers reach no tool or resource.
 *
 * @param c - The Hono context for the `/mcp` request.
 * @returns the transport's Response, or a Problem response on auth failure.
 */
export async function mcpHandler(c: Context): Promise<Response> {
  let ctx: McpContext;
  try {
    ctx = await resolveMcpContext(c.req.raw.headers);
  } catch (err) {
    return problem(c, err);
  }

  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    void transport.close();
    void server.close();
  }
}
