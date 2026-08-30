/** Behavioral enforcement for text fallback on Athena's own UI-enabled server tools. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';

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
});
