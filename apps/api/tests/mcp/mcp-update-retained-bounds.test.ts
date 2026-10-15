import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb, one } from '../support/routes-harness';
import { flushDeferredWork } from '../../src/lib/after-response';
import {
  seedRetainedUpdateFixture,
  type RetainedUpdateFixture,
} from './mcp-update-retained-fixture';
let schema: typeof DbModule;
const connections: { client: Client; server: McpServer }[] = [];
beforeAll(async () => {
  schema = await getDb();
});
afterEach(async () => {
  await flushDeferredWork();
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
});
async function connect(fixture: RetainedUpdateFixture): Promise<Client> {
  const { registerTools } = await import('../../src/mcp/tools');
  const server = new McpServer({ name: 'retained-update', version: '1' });
  registerTools(server, fixture.seed.ctx, 'retained-update');
  const client = new Client({ name: 'test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  connections.push({ client, server });
  return client;
}
async function tasks(orgId: string) {
  return schema.db.select().from(schema.task).where(eq(schema.task.organizationId, orgId));
}
async function receipts(orgId: string) {
  return schema.db
    .select()
    .from(schema.changeSet)
    .where(eq(schema.changeSet.organizationId, orgId));
}
async function complete(f: RetainedUpdateFixture) {
  return (await connect(f)).callTool({
    name: 'update',
    arguments: {
      orgId: f.seed.orgId,
      entity: 'task',
      scope: { ids: f.firstIds },
      set: { state: 'done' },
    },
  });
}
describe('MCP retained completion footprint and private date reporting', () => {
  it('refuses502 affected private consumers and public descendants atomically', async () => {
    const f = await seedRetainedUpdateFixture(schema, 250);
    const before = await tasks(f.seed.orgId),
      beforeReceipts = await receipts(f.seed.orgId);
    expect(before).toHaveLength(504);
    expect(
      before.filter((row) => f.firstIds.includes(row.id)).every((row) => row.completedAt === null),
    ).toBe(true);
    const result = await complete(f);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('blueprint_limit') }),
      ]),
    );
    expect(await tasks(f.seed.orgId)).toEqual(before);
    expect(await receipts(f.seed.orgId)).toEqual(beforeReceipts);
  }, 120000);
  it('accepts exactly500 affected rows across separate retained occurrences in one receipt', async () => {
    const f = await seedRetainedUpdateFixture(schema, 249);
    const result = await complete(f);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ matched: 2, changed: 2, skipped: [] });
    const saved = await tasks(f.seed.orgId);
    const first = saved.filter((row) => f.firstIds.includes(row.id));
    expect(first).toHaveLength(2);
    expect(first.every((row) => row.completedAt !== null)).toBe(true);
    const dependents = saved.filter((row) => !f.firstIds.includes(row.id));
    expect(dependents).toHaveLength(500);
    expect(dependents.every((row) => row.dueDate !== null)).toBe(true);
    for (const secondId of f.secondIds) {
      const second = saved.find((row) => row.id === secondId);
      expect(second?.dueDate).not.toBeNull();
      expect(saved.filter((row) => row.parentTaskId === secondId)).toHaveLength(249);
      expect(
        saved
          .filter((row) => row.parentTaskId === secondId)
          .every((row) => row.dueDate?.getTime() === second?.dueDate?.getTime()),
      ).toBe(true);
    }
    expect(
      (await receipts(f.seed.orgId)).filter((receipt) => receipt.origin.tool === 'update'),
    ).toHaveLength(1);
  }, 120000);
  it.each(['manual', 'terminal'] as const)(
    'excludes %s private consumer descendants from the aggregate cap',
    async (mode) => {
      const f = await seedRetainedUpdateFixture(schema, 250);
      const id = f.secondIds[0];
      if (!id) throw new Error('Missing private consumer');
      if (mode === 'manual')
        await schema.db
          .update(schema.retainedDateOwnership)
          .set({ manual: true })
          .where(eq(schema.retainedDateOwnership.workId, id));
      else
        await schema.db
          .update(schema.task)
          .set({
            state: 'done',
            statusId: f.seed.statusId('task', 'done'),
            completedAt: new Date('2026-10-16T12:00:00Z'),
          })
          .where(eq(schema.task.id, id));
      const before = await tasks(f.seed.orgId);
      const skipped = before.filter((row) => row.id === id || row.parentTaskId === id);
      const result = await complete(f);
      expect(result.isError).toBeFalsy();
      const saved = await tasks(f.seed.orgId);
      expect(saved.filter((row) => row.id === id || row.parentTaskId === id)).toEqual(skipped);
      expect(
        saved.filter((row) => f.firstIds.includes(row.id)).every((row) => row.completedAt !== null),
      ).toBe(true);
      const other = f.secondIds[1];
      expect(
        saved
          .filter((row) => row.id === other || row.parentTaskId === other)
          .every((row) => row.dueDate !== null),
      ).toBe(true);
      expect(
        (await receipts(f.seed.orgId)).filter((receipt) => receipt.origin.tool === 'update'),
      ).toHaveLength(1);
    },
    120000,
  );
  it('reports a waiting-null private date pin as one changed Task with friendly ownership text', async () => {
    const f = await seedRetainedUpdateFixture(schema, 0, ['2026-10-14']);
    const id = f.secondIds[0];
    if (!id) throw new Error('Missing private consumer');
    const before = one(await schema.db.select().from(schema.task).where(eq(schema.task.id, id)));
    expect(before.dueDate).toBeNull();
    expect(before.blueprintDateBindings).toEqual({});
    const result = await (
      await connect(f)
    ).callTool({
      name: 'update',
      arguments: {
        orgId: f.seed.orgId,
        entity: 'task',
        scope: { ids: [id] },
        set: { dueDate: null },
      },
    });
    expect(result.isError).toBeFalsy();
    const ownership = one(
      await schema.db
        .select()
        .from(schema.retainedDateOwnership)
        .where(eq(schema.retainedDateOwnership.workId, id)),
    );
    expect(ownership.manual).toBe(true);
    expect(result.structuredContent).toMatchObject({
      changed: 1,
      changes: [
        expect.objectContaining({
          id,
          fields: expect.arrayContaining([
            expect.objectContaining({ field: 'Template dates', to: 'Manually set' }),
          ]),
        }),
      ],
    });
    const receipt = one(
      (await receipts(f.seed.orgId)).filter((entry) => entry.origin.tool === 'update'),
    );
    expect(receipt.summary).not.toMatch(/Updated 0/);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, id))).dueDate,
    ).toBeNull();
  });
});
