/**
 * Shared harness for the label and template MCP tool tests.
 *
 * @remarks
 * The workspace seed is `seedMcpUpdateOrg`, so these tests describe the same "Core" team, the same
 * "Platform Migration" project and the same Ada and Sarah as the `update` tests. This file adds the
 * in-memory client, a second team, team membership, and label rows.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { McpUpdateSeed } from './mcp-update-tool-fixtures';

const open: { close(): Promise<void> }[] = [];

/** Connect an MCP client to the full Docket tool catalog for `ctx`. */
export async function connectCatalog(
  registerTools: typeof RegisterTools,
  ctx: McpContext,
): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_catalog');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  open.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

/** Close every client opened by {@link connectCatalog}; call from `afterEach`. */
export async function closeCatalogClients(): Promise<void> {
  while (open.length > 0) await open.pop()?.close();
}

/**
 * Parse the structured JSON body a Docket MCP tool returned.
 *
 * @remarks
 * `T` is the caller's statement of the tool's output shape; the tool's own `outputSchema` is what
 * enforces it, so asserting it here saves every test a cast.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see remarks above
export function body<T = Record<string, unknown>>(result: ToolResponse): T {
  return JSON.parse(errorText(result)) as T;
}

/** What `client.callTool` resolves to, which also admits the pre-2025 `toolResult` shape. */
type ToolResponse = Awaited<ReturnType<Client['callTool']>>;

/** The text a tool call returned, which for a failed call is the error description. */
export function errorText(result: ToolResponse): string {
  return ((result as CallToolResult).content[0] as { text: string }).text;
}

/** Add a second team, "Design", to the seeded workspace. */
export async function seedSecondTeam(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  seed: McpUpdateSeed,
): Promise<string> {
  const [row] = await db
    .insert(schema.team)
    .values({
      organizationId: seed.orgId,
      name: 'Design',
      key: `D${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  return assertDefined(row).id;
}

/** Make the seeded caller a member of `teamId`, which team templates require. */
export async function joinTeam(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  seed: McpUpdateSeed,
  teamId: string,
): Promise<void> {
  await db
    .insert(schema.teamMember)
    .values({ organizationId: seed.orgId, teamId, actorId: seed.actorId });
}

/** Insert a label directly, bypassing the tools under test. */
export async function seedLabel(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  seed: McpUpdateSeed,
  values: Omit<Partial<typeof DbModule.label.$inferInsert>, 'organizationId'> & { name: string },
): Promise<string> {
  const [row] = await db
    .insert(schema.label)
    .values({ organizationId: seed.orgId, color: 'blue', ...values })
    .returning({ id: schema.label.id });
  return assertDefined(row).id;
}

/** Insert a label group directly. */
export async function seedLabelGroup(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  seed: McpUpdateSeed,
  values: { name: string; exclusive?: boolean; teamId?: string | null },
): Promise<string> {
  const [row] = await db
    .insert(schema.labelGroup)
    .values({ organizationId: seed.orgId, exclusive: true, ...values })
    .returning({ id: schema.labelGroup.id });
  return assertDefined(row).id;
}
