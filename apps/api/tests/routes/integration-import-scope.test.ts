import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, seedBaseOrg } from '../support/routes-harness';
import { importTaskWork } from '../../src/routes/integration-import-scope';

let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

async function ownedDataSource() {
  const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
  const [connection] = await schema.db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'notion',
      pattern: 'connector',
      roles: ['work'],
      createdBy: humanActorId,
    })
    .returning();
  if (!connection) throw new Error('Missing integration');
  const sourceId = `mirror-${connection.id}`;
  await schema.db.insert(schema.notionMirrorDatabase).values({
    organizationId: orgId,
    integrationId: connection.id,
    entityType: 'initiative',
    title: 'Initiatives',
    externalDataSourceId: sourceId,
    enabled: false,
  });
  await schema.db.insert(schema.notionMirrorRow).values({
    organizationId: orgId,
    integrationId: connection.id,
    entityType: 'initiative',
    entityId: humanActorId,
    externalPageId: `page-${connection.id}`,
  });
  return { sourceId, pageId: `page-${connection.id}` };
}

describe('generic Notion task import', () => {
  it('never reads owned mirror tables, including disabled tables from another integration', async () => {
    const { sourceId } = await ownedDataSource();
    const connector = {
      listContainers: vi.fn().mockResolvedValue([{ id: sourceId }, { id: 'user-tasks' }]),
      importWork: vi.fn().mockResolvedValue([]),
    };
    await importTaskWork(connector, {
      provider: 'notion',
      connectionId: 'other',
      listIds: [sourceId, 'user-tasks'],
    });
    expect(connector.importWork).toHaveBeenCalledWith({
      provider: 'notion',
      connectionId: 'other',
      listIds: ['user-tasks'],
    });
  });

  it('does not turn an empty filtered selection back into an all-databases import', async () => {
    const { sourceId } = await ownedDataSource();
    const connector = { importWork: vi.fn().mockResolvedValue([]) };
    expect(
      await importTaskWork(connector, {
        provider: 'notion',
        connectionId: 'other',
        listIds: [sourceId],
      }),
    ).toEqual([]);
    expect(connector.importWork).not.toHaveBeenCalled();
  });

  it('excludes a known mirror page even after it moves into a selected task database', async () => {
    const { pageId } = await ownedDataSource();
    const connector = {
      importWork: vi
        .fn()
        .mockResolvedValue([
          { provenance: { externalId: pageId, externalListId: 'tasks' } },
          { provenance: { externalId: 'real-task', externalListId: 'tasks' } },
        ]),
    };
    const items = await importTaskWork(connector, {
      provider: 'notion',
      connectionId: 'c',
      listIds: ['tasks'],
    });
    expect(items).toEqual([{ provenance: { externalId: 'real-task', externalListId: 'tasks' } }]);
  });

  it('requires a task database selection before reading Notion', async () => {
    const connector = { importWork: vi.fn(), listContainers: vi.fn() };
    for (const listIds of [undefined, []]) {
      expect(
        await importTaskWork(connector, {
          provider: 'notion',
          connectionId: 'c',
          ...(listIds ? { listIds } : {}),
        }),
      ).toEqual([]);
    }
    expect(connector.importWork).not.toHaveBeenCalled();
    expect(connector.listContainers).not.toHaveBeenCalled();
  });

  it('preserves explicit task scope and incremental cursors', async () => {
    const connector = { importWork: vi.fn().mockResolvedValue([]) };
    const input = {
      provider: 'notion' as const,
      connectionId: 'c',
      listIds: ['tasks'],
      since: '2026-09-19T00:00:00Z',
    };
    await importTaskWork(connector, input);
    expect(connector.importWork).toHaveBeenCalledWith(input);
  });

  it('leaves other providers unchanged', async () => {
    const connector = { importWork: vi.fn().mockResolvedValue([]) };
    const input = { provider: 'gtasks' as const, connectionId: 'c' };
    await importTaskWork(connector, input);
    expect(connector.importWork).toHaveBeenCalledWith(input);
  });
});
