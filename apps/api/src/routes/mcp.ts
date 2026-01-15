/**
 * MCP (Model Context Protocol) routes.
 *
 * Uses the official MCP SDK with streamable HTTP transport.
 * Supports both session-based auth (for web) and OAuth Bearer auth (for MCP clients).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '../services/mcp/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOAuthAuth } from '../middleware/oauth-auth.js';

const app = new Hono();

// Session storage for MCP connections
const sessions = new Map<
  string,
  {
    transport: WebStandardStreamableHTTPServerTransport;
    userId: string;
    server: ReturnType<typeof createMcpServer>;
  }
>();

/**
 * Combined auth middleware that supports both session and OAuth Bearer token.
 * OAuth takes precedence if a Bearer token is present.
 */
async function requireMcpAuth(c: Context, next: Next): Promise<void> {
  const authorization = c.req.header('authorization');

  if (authorization?.startsWith('Bearer ')) {
    // OAuth Bearer token authentication for MCP clients
    const oauthMiddleware = requireOAuthAuth({
      scopes: ['mcp:read'], // Minimum required scope for MCP access
    });
    return oauthMiddleware(c, next);
  }

  // Session-based authentication for web clients
  return requireAuth(c, next);
}

/**
 * Get user ID from context (works for both session and OAuth auth).
 */
function getUserId(c: Context): string {
  const userId = c.get('userId') as string | undefined;
  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  return userId;
}

app.use('*', requireMcpAuth);

/**
 * Handle all MCP requests via the streamable HTTP transport.
 * Supports GET (SSE stream), POST (JSON-RPC), and DELETE (session close).
 */
const mcpHandler = async (c: Context): Promise<Response> => {
  const userId = getUserId(c);
  const request = c.req.raw;

  // Check for existing session
  const sessionId = request.headers.get('mcp-session-id');
  let transport: WebStandardStreamableHTTPServerTransport;

  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing) {
    // Use existing session if it belongs to this user
    if (existing.userId !== userId) {
      return c.json({ error: 'mcp_session_user_mismatch' }, 403);
    }
    transport = existing.transport;
  } else {
    // Create new session
    const mcpServer = createMcpServer(userId);
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { transport, userId, server: mcpServer });
      },
      onsessionclosed: (closedSessionId) => {
        const session = sessions.get(closedSessionId);
        sessions.delete(closedSessionId);
        if (session) {
          void session.server.close();
        }
      },
    });

    // Create and connect MCP server for this user
    await mcpServer.connect(transport);
  }

  // Handle the request through the transport
  return transport.handleRequest(request);
};

app.all('/', mcpHandler);

export default app;
