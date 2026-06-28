/**
 * MCP (Model Context Protocol) routes.
 *
 * Uses the official MCP SDK with streamable HTTP transport.
 * Supports both session-based auth (for web) and OAuth Bearer auth (for MCP clients).
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { createOpenAPIApp } from '../lib/openapi.js';
import { mcpHandler, mcpHeadersSchema, requireMcpAuth } from './mcp/helpers.js';

const mcpRoutes = createOpenAPIApp();

mcpRoutes.use('*', requireMcpAuth);

const mcpGetRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['MCP'],
  summary: 'Open MCP stream',
  description: 'Open an SSE stream for MCP requests.',
  request: {
    headers: mcpHeadersSchema,
  },
  responses: {
    200: {
      description: 'MCP stream response',
    },
  },
});

const mcpPostRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['MCP'],
  summary: 'Send MCP request',
  description: 'Send a JSON-RPC MCP request.',
  request: {
    headers: mcpHeadersSchema,
  },
  responses: {
    200: {
      description: 'MCP response',
    },
  },
});

const mcpDeleteRoute = createRoute({
  method: 'delete',
  path: '/',
  tags: ['MCP'],
  summary: 'Close MCP session',
  description: 'Close an MCP session.',
  request: {
    headers: mcpHeadersSchema,
  },
  responses: {
    200: {
      description: 'MCP session closed',
    },
  },
});

// Use explicit routes to avoid OpenAPI request body parsing for MCP streams.
mcpRoutes.openapi(mcpGetRoute, mcpHandler);
mcpRoutes.openapi(mcpPostRoute, mcpHandler);
mcpRoutes.openapi(mcpDeleteRoute, mcpHandler);

export default mcpRoutes;
