import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { assertDefined } from '@docket/test-utils';
import type * as DbModule from '@docket/db';
import { afterEach, beforeAll, expect } from 'vitest';
import { z } from 'zod';

import type { McpContext } from '../../src/mcp/auth';
import { createMcpCatalog } from '../../src/mcp/catalog';
import { getDb } from '../support/routes-harness';
import { seedMcpSurfaceOrg, type McpSurfaceSeed } from './mcp-surface-fixtures';

/** Database backing the Library MCP fixtures. */
export let schema: typeof DbModule;
const clients: Client[] = [];
const servers: McpServer[] = [];
beforeAll(async () => {
  schema = await getDb();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** Connect a real identity-bound MCP client and server. */
export async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'library-test', version: '1' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  const catalog = createMcpCatalog(server);
  (await import('../../src/mcp/tools')).registerTools(catalog, ctx);
  (await import('../../src/mcp/resources')).registerResources(catalog, ctx);
  catalog.installListHandlers(ctx);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'library-test', version: '1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  clients.push(client);
  servers.push(server);
  return client;
}

/** Seed an isolated workspace with no explicit human grants. */
export async function seed(): Promise<McpSurfaceSeed> {
  return seedMcpSurfaceOrg(schema.db, schema, []);
}

/** Project a source row through the production search projector. */
export async function index(kind: string, id: string): Promise<void> {
  const { projectSearchDocumentFromSource } = await import('../../src/search/registry');
  const draft = assertDefined(await projectSearchDocumentFromSource(kind, id));
  await schema.db
    .insert(schema.searchDocument)
    .values(draft)
    .onConflictDoUpdate({ target: schema.searchDocument.id, set: draft });
}

/** Create a linked Library resource and its discovery projection. */
export async function linked(s: McpSurfaceSeed, title = 'Transit research'): Promise<string> {
  const [row] = await schema.db
    .insert(schema.externalResource)
    .values({
      organizationId: s.orgId,
      createdBy: s.actorId,
      provider: 'web',
      canonicalKey: `web:${schema.genId()}`,
      canonicalUrl: 'https://example.com/research',
      title,
      description: 'Published research',
    })
    .returning();
  const id = assertDefined(row).id;
  await index('external_resource', id);
  return id;
}

/** Store an uploaded file and its real attachment row. */
export async function file(
  s: McpSurfaceSeed,
  options: { size?: number; missing?: boolean } = {},
): Promise<string> {
  const key = `library-test/${schema.genId()}`;
  const bytes = new TextEncoder().encode('Transit file contents');
  if (!options.missing) {
    const { getContainer } = await import('../../src/container');
    await getContainer().blob.put(key, bytes, 'text/plain');
  }
  const [row] = await schema.db
    .insert(schema.attachment)
    .values({
      organizationId: s.orgId,
      createdBy: s.actorId,
      subjectType: 'task',
      subjectId: s.taskId,
      kind: 'file',
      title: 'Transit file',
      fileName: 'transit.txt',
      mimeType: 'text/plain',
      byteSize: options.size ?? bytes.length,
      blobKey: key,
      metadata: { privateToken: 'never-return-this' },
      sourceIntegrationId: s.integrationId,
    })
    .returning();
  const id = assertDefined(row).id;
  await index('attachment', id);
  await index('task', s.taskId);
  return id;
}

const Item = z.looseObject({
  orgId: z.string(),
  kind: z.string(),
  id: z.string(),
  uri: z.string(),
});
const Page = z.object({ items: z.array(Item), nextCursor: z.string().optional() });
/** Per-reference result parser used by batch assertions. */
export const Results = z.object({ items: z.array(z.looseObject({ status: z.string() })) });

/** Read and validate a successful Library discovery page. */
export async function list(
  client: Client,
  args: Record<string, unknown> = {},
): Promise<z.infer<typeof Page>> {
  const result = await client.callTool({ name: 'list_resources', arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return Page.parse(result.structuredContent);
}

/** Read and validate one Library detail result. */
export async function get(
  client: Client,
  orgId: string,
  kind: string,
  id: string,
): Promise<z.infer<typeof Results>['items'][number]> {
  const result = await client.callTool({
    name: 'get_resources',
    arguments: { refs: [{ orgId, kind, id }] },
  });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return assertDefined(Results.parse(result.structuredContent).items[0]);
}
