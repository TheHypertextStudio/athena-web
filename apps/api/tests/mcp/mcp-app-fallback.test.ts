/** Behavioral enforcement for text fallback on Athena's own UI-enabled server tools. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { McpCatalog } from '../../src/mcp/catalog';
import { widgetMeta, WIDGET } from '../../src/mcp/apps';

const closeables: { close(): Promise<void> }[] = [];

afterEach(async () => {
  while (closeables.length > 0) await closeables.pop()?.close();
});

describe('Athena UI-enabled server tool fallback', () => {
  it('ensures every Athena UI-enabled tool returns meaningful text fallback', async () => {
    const server = new McpServer({ name: 'fallback-test', version: '1.0.0' });
    const catalog = new McpCatalog(server);
    catalog.registerTool(
      'ui_result',
      { inputSchema: {}, _meta: widgetMeta(WIDGET.workList) },
      async () => ({ content: [], structuredContent: { summary: 'Three tasks remain' } }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'fallback-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeables.push(client, server);

    const result = await client.callTool({ name: 'ui_result', arguments: {} });
    expect(result.content).toEqual([
      { type: 'text', text: '{\n  "summary": "Three tasks remain"\n}' },
    ]);
  });

  it('covers every supported UI linkage and fallback outcome without rewriting existing text', async () => {
    const server = new McpServer({ name: 'fallback-shapes-test', version: '1.0.0' });
    const catalog = new McpCatalog(server);
    catalog.registerTool(
      'stable_string_success',
      { inputSchema: {}, _meta: { ui: 'ui://test/stable-string' } },
      async () => ({
        content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
      }),
    );
    catalog.registerTool(
      'stable_object_error',
      { inputSchema: {}, _meta: { ui: { resourceUri: 'ui://test/stable-object' } } },
      async () => ({ content: [], isError: true }),
    );
    catalog.registerTool(
      'legacy_string_success',
      {
        inputSchema: {},
        _meta: { ui: 'not-a-ui-uri', 'io.modelcontextprotocol/ui': 'ui://test/legacy-string' },
      },
      async () => ({ content: [] }),
    );
    catalog.registerTool(
      'legacy_object_text',
      {
        inputSchema: {},
        _meta: {
          ui: 42,
          'io.modelcontextprotocol/ui': { resourceUri: 'ui://test/legacy-object' },
        },
      },
      async () => ({ content: [{ type: 'text', text: 'Already useful' }] }),
    );
    catalog.registerTool(
      'invalid_linkage',
      {
        inputSchema: {},
        _meta: {
          ui: { resourceUri: 'https://example.com/not-ui' },
          'io.modelcontextprotocol/ui': { resourceUri: 42 },
        },
      },
      async () => ({ content: [] }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'fallback-shapes-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeables.push(client, server);

    await expect(
      client.callTool({ name: 'stable_string_success', arguments: {} }),
    ).resolves.toMatchObject({
      content: [
        { type: 'image', data: 'AA==', mimeType: 'image/png' },
        { type: 'text', text: 'The tool completed successfully.' },
      ],
    });
    await expect(
      client.callTool({ name: 'stable_object_error', arguments: {} }),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'The tool could not complete.' }],
      isError: true,
    });
    await expect(
      client.callTool({ name: 'legacy_string_success', arguments: {} }),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'The tool completed successfully.' }],
    });
    await expect(
      client.callTool({ name: 'legacy_object_text', arguments: {} }),
    ).resolves.toMatchObject({ content: [{ type: 'text', text: 'Already useful' }] });
    await expect(
      client.callTool({ name: 'invalid_linkage', arguments: {} }),
    ).resolves.toMatchObject({ content: [] });
  });

  it('uses the synchronous fallback when task execution is not enabled', async () => {
    const server = new McpServer({ name: 'sync-task-test', version: '1.0.0' });
    const catalog = new McpCatalog(server);
    catalog.registerTaskTool(
      'sync_task',
      {
        inputSchema: {},
        outputSchema: { ok: z.boolean() },
        execution: { taskSupport: 'optional' },
        _meta: { ui: 'ui://test/sync-task' },
      },
      {} as ToolTaskHandler<Record<string, never>>,
      async () => ({ content: [], structuredContent: { ok: true } }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'sync-task-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeables.push(client, server);

    await expect(client.callTool({ name: 'sync_task', arguments: {} })).resolves.toMatchObject({
      content: [{ type: 'text', text: '{\n  "ok": true\n}' }],
      structuredContent: { ok: true },
    });
  });

  it('rejects resource subscriptions when the host did not establish a session', async () => {
    const server = new McpServer(
      { name: 'subscription-session-test', version: '1.0.0' },
      { capabilities: { resources: { subscribe: true }, logging: {} } },
    );
    const catalog = new McpCatalog(server);
    catalog.installSubscriptionHandlers(
      {
        principal: {
          kind: 'user',
          userId: 'subscription-user',
          userName: null,
          userEmail: 'subscription@example.com',
        },
        scopes: [],
      },
      null,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'subscription-session-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeables.push(client, server);

    await expect(client.subscribeResource({ uri: 'ui://test/missing-session' })).rejects.toThrow(
      /needs an MCP session/i,
    );
  });
});
