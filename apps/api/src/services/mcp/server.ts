/**
 * MCP server implementation for Athena using the official SDK.
 *
 * @packageDocumentation
 */

import {
  createMcpServer as createAthenaMcpServer,
  createMcpTransport as createAthenaMcpTransport,
  McpServer,
} from '@athena/mcp-server';
import { db } from '../../db/index.js';
import { tasks, projects, events, initiatives } from '../../db/schema/index.js';

/**
 * Create and configure an MCP server for a specific user.
 */
export function createMcpServer(userId: string): McpServer {
  return createAthenaMcpServer({
    userId,
    // Type assertion needed because Drizzle's query types are more specific
    // than the minimal interface required by the MCP server
    db: db as unknown as Parameters<typeof createAthenaMcpServer>[0]['db'],
    schema: {
      tasks,
      projects,
      events,
      initiatives,
    },
  });
}

/**
 * Create an HTTP transport for the MCP server.
 */
export const createMcpTransport = createAthenaMcpTransport;

// Re-export for backward compatibility
export { McpServer };
