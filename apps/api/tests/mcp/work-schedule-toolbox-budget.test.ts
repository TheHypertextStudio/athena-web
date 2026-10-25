/** Catalog-only rendering exercises the existing prompt ceiling without starting a database. */
import { buildLatticeTurnMessages } from '@docket/athena/turn/adapters/lattice';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { expect, it } from 'vitest';
import { ASK_USER_DEF } from '../../src/agent/toolbox';
import { registerTools } from '../../src/mcp/tools';
import { createMcpCatalog } from '../../src/mcp/catalog';

it('keeps canonical schedule authoring inside the existing 64000-character toolbox ceiling', async () => {
  const server = new McpServer(
    { name: 'budget', version: '1' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  const ctx = {
    principal: {
      kind: 'user' as const,
      userId: 'budget',
      userName: null,
      userEmail: 'budget@example.test',
    },
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  };
  const catalog = createMcpCatalog(server);
  registerTools(catalog, ctx);
  catalog.installListHandlers(ctx);
  const client = new Client({ name: 'budget', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(b), client.connect(a)]);
    let page = await client.listTools();
    const tools = [...page.tools];
    while (page.nextCursor) {
      page = await client.listTools({ cursor: page.nextCursor });
      tools.push(...page.tools);
    }
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'define_process',
        'schedule_process',
        'repeat_task',
        'define_template',
        'list_templates',
        'copy_work_templates',
        'list_work_schedules',
        'manage_work_schedule',
      ]),
    );
    const originalTools = structuredClone(tools);
    const [system] = buildLatticeTurnMessages({
      system: 'You are Athena.',
      messages: [],
      tools: [
        ...tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: tool.inputSchema,
        })),
        ASK_USER_DEF,
      ],
    });
    expect(tools).toEqual(originalTools);
    expect(
      system?.content.length,
      `Toolbox prompt: ${system?.content.length} (${tools.length} tools) characters; largest inputs: ${JSON.stringify(
        tools
          .map((t) => [
            t.name,
            buildLatticeTurnMessages({
              system: '',
              messages: [],
              tools: [
                { name: t.name, description: t.description ?? t.name, inputSchema: t.inputSchema },
              ],
            })[0]?.content.length ?? 0,
          ])
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .slice(0, 8),
      )}; descriptions: ${JSON.stringify(
        tools
          .map((t) => [t.name, (t.description ?? ' ').split(/\n\s*\n/)[0]?.length ?? 0])
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .slice(0, 10),
      )}`,
    ).toBeLessThan(64000);
  } finally {
    await client.close();
    await server.close();
  }
});
