/**
 * @packageDocumentation
 * MCP server utilities for Project Athena.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SERVER_INFO } from './constants.js';
import type { CreateAthenaMcpServerOptions } from './types.js';
import { registerResources } from './resources.js';
import { registerResourceTemplates } from './resource-templates.js';
import { registerTools } from './tools.js';
import { registerPrompts } from './prompts.js';
import {
  getSessionKey,
  getSessionSubscriptions,
  type SessionSubscriptions,
} from './subscriptions.js';

export type {
  AthenaMcpDbQuery,
  AthenaMcpDb,
  AthenaMcpSchema,
  CreateAthenaMcpServerOptions,
} from './types.js';

/**
 * Create and configure an MCP server for a specific user.
 */
export function createMcpServer(options: CreateAthenaMcpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      logging: {},
      completions: {},
      resources: {
        subscribe: true,
        listChanged: true,
      },
      tools: {},
      prompts: {},
    },
  });

  const subscriptions = new Map<string, SessionSubscriptions>();
  server.server.setRequestHandler(SubscribeRequestSchema, (request, extra) => {
    const sessionKey = getSessionKey(extra);
    if (!sessionKey) {
      return {};
    }
    const session = getSessionSubscriptions(subscriptions, sessionKey);
    session.uris.add(request.params.uri);
    session.sendNotification = extra.sendNotification;
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, (request, extra) => {
    const sessionKey = getSessionKey(extra);
    if (!sessionKey) {
      return {};
    }
    const session = subscriptions.get(sessionKey);
    if (!session) {
      return {};
    }
    session.uris.delete(request.params.uri);
    if (session.uris.size === 0) {
      subscriptions.delete(sessionKey);
    }
    return {};
  });

  registerResources(server, options);
  registerResourceTemplates(server, options);
  registerTools(server, options, subscriptions);
  registerPrompts(server, options);

  return server;
}

/**
 * Create an HTTP transport for the MCP server.
 */
export function createMcpTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
}

export { McpServer };
