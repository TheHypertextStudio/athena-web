/**
 * MCP route helpers.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '../../services/mcp/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOAuthAuth } from '../../middleware/oauth-auth.js';

export const mcpHeadersSchema = z.object({
  authorization: z.string().optional(),
  'mcp-session-id': z.string().optional(),
});

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
export async function requireMcpAuth(c: Context, next: Next): Promise<void> {
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

/**
 * Handle all MCP requests via the streamable HTTP transport.
 * Supports GET (SSE stream), POST (JSON-RPC), and DELETE (session close).
 */
export const mcpHandler = async (c: Context): Promise<Response> => {
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
