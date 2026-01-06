/**
 * MCP (Model Context Protocol) routes.
 *
 * Uses the official MCP SDK with streamable HTTP transport.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '../services/mcp/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

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

app.use('*', requireAuth);

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

// Register handler for both root paths (with and without trailing slash)
app.all('/', mcpHandler);

/**
 * Legacy REST-style endpoints for clients that don't support streamable HTTP.
 * These provide a simpler API but don't have full MCP protocol support.
 */
app.get('/resources', (c) => {
  // Access the underlying server's registered resources
  const resources = [
    {
      uri: 'athena://tasks',
      name: 'tasks',
      description: 'All user tasks',
      mimeType: 'application/json',
    },
    {
      uri: 'athena://tasks/today',
      name: 'tasks-today',
      description: 'Tasks due today',
      mimeType: 'application/json',
    },
    {
      uri: 'athena://tasks/pending',
      name: 'tasks-pending',
      description: 'All pending tasks',
      mimeType: 'application/json',
    },
    {
      uri: 'athena://projects',
      name: 'projects',
      description: 'All user projects',
      mimeType: 'application/json',
    },
    {
      uri: 'athena://events',
      name: 'events',
      description: 'All calendar events',
      mimeType: 'application/json',
    },
    {
      uri: 'athena://events/upcoming',
      name: 'events-upcoming',
      description: 'Events in the next 7 days',
      mimeType: 'application/json',
    },
    {
      uri: 'athena://initiatives',
      name: 'initiatives',
      description: 'All strategic initiatives',
      mimeType: 'application/json',
    },
    {
      uri: 'athena://agenda',
      name: 'agenda',
      description: "Today's agenda with tasks and events",
      mimeType: 'application/json',
    },
  ];

  return c.json({ success: true, data: { resources } });
});

app.get('/tools', (c) => {
  const tools = [
    { name: 'list_tasks', description: 'List tasks with optional filters' },
    { name: 'create_task', description: 'Create a new task' },
    { name: 'update_task', description: 'Update fields on a task' },
    { name: 'complete_task', description: 'Mark a task as completed' },
    { name: 'list_events', description: 'List calendar events with optional date range' },
    { name: 'create_event', description: 'Create a calendar event' },
    { name: 'update_event', description: 'Update fields on a calendar event' },
    { name: 'search_tasks', description: 'Search tasks by keyword' },
    { name: 'get_agenda', description: 'Get agenda for a specific date' },
    { name: 'get_availability', description: 'Get free/busy availability for a date range' },
  ];

  return c.json({ success: true, data: { tools } });
});

app.get('/prompts', (c) => {
  const prompts = [
    { name: 'daily_summary', description: "Summarize today's tasks and events" },
    {
      name: 'daily_planning',
      description: 'Generate a daily planning prompt based on current tasks and events',
    },
    { name: 'task_planning', description: 'Plan tasks for the next work session' },
    {
      name: 'progress_report',
      description: 'Generate a progress report for a project or initiative',
    },
    { name: 'task_breakdown', description: 'Help break down a complex task into subtasks' },
    {
      name: 'weekly_review',
      description: 'Generate a weekly review prompt with accomplishments and upcoming work',
    },
  ];

  return c.json({ success: true, data: { prompts } });
});

export default app;
