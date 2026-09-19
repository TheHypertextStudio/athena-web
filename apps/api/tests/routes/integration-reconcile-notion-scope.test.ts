import type { ExternalWriteResult, ImportedItem, WritableConnector } from '@docket/integrations';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, one, seedBaseOrg, seedStatuses } from '../support/routes-harness';

let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

it('never writes an existing false task back to a typed Notion mirror', async () => {
  const { db, integration, task, notionMirrorDatabase, notionMirrorRow } = schema;
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  const statusId = await seedStatuses(db, schema, orgId);
  const connection = one(
    await db
      .insert(integration)
      .values({
        organizationId: orgId,
        provider: 'notion',
        pattern: 'connector',
        roles: ['work'],
        createdBy: humanActorId,
        writeBack: true,
        config: {
          listIds: ['selected-tasks'],
          pushNativeTasks: true,
          defaultListId: 'owned-table',
        },
      })
      .returning(),
  );
  const local = one(
    await db
      .insert(task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'False task',
        state: 'canceled',
        statusId: statusId('task', 'canceled'),
        source: 'linked',
        sourceIntegrationId: connection.id,
        externalId: 'owned-page',
        externalListId: 'selected-tasks',
        externalUpdatedAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-07-01'),
      })
      .returning(),
  );
  await db.insert(notionMirrorDatabase).values({
    organizationId: orgId,
    integrationId: connection.id,
    entityType: 'initiative',
    title: 'Initiatives',
    externalDataSourceId: 'owned-table',
    enabled: false,
  });
  await db.insert(notionMirrorRow).values({
    organizationId: orgId,
    integrationId: connection.id,
    entityType: 'initiative',
    entityId: local.id,
    externalPageId: 'owned-page',
  });
  await db.insert(task).values({
    organizationId: orgId,
    teamId,
    title: 'Native task',
    source: 'native',
    state: 'todo',
    statusId: statusId('task', 'todo'),
  });
  const pushTask = vi.fn(async () => undefined);
  const { reconcileTasks } = await import('../../src/routes/integration-reconcile');
  const tally = await reconcileTasks(orgId, humanActorId, connection, teamId, [], {
    assigneeId: null,
    writable: { pushTask },
  });
  expect(pushTask).not.toHaveBeenCalled();
  expect(tally.deleted).toBe(0);
  expect(tally.created).toBe(0);
  expect(one(await db.select().from(task).where(eq(task.id, local.id))).updatedAt).toEqual(
    local.updatedAt,
  );
});

describe('reconcileTasks — the Notion connector (Docket wins conflicts, the loss is logged)', () => {
  it('pushes Docket’s value to Notion and records Notion’s losing value under provider: notion', async () => {
    const { db } = schema;
    const { reconcileTasks } = await import('../../src/routes/integration-reconcile');
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const integration = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'notion',
          config: { listIds: ['notion-data-source-1'] },
          pattern: 'connector',
          roles: ['work'],
          writeBack: true,
          createdBy: humanActorId,
        })
        .returning(),
    );
    const local = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Docket’s title wins',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          source: 'linked',
          sourceIntegrationId: integration.id,
          sourceSyncMode: 'mirror',
          externalId: 'notion-page-conflict',
          externalListId: 'notion-data-source-1',
          externalUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          // Dirty: edited locally after the last synced anchor.
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        })
        .returning(),
    );
    const notionItem: ImportedItem = {
      id: 'notion-page-conflict',
      kind: 'issue',
      title: 'Notion’s title (loses)',
      body: 'Notion’s notes (loses)',
      provenance: {
        provider: 'notion',
        externalId: 'notion-page-conflict',
        externalListId: 'notion-data-source-1',
        importedAt: '2026-06-01T00:00:00.000Z',
        // Newer than the anchor — a genuine two-sided edit, not a one-sided remote change.
        externalUpdatedAt: '2026-03-01T00:00:00.000Z',
      },
    };
    const pushCalls: unknown[] = [];
    const writable: WritableConnector = {
      pushTask: async (input) => {
        pushCalls.push(input);
        const result: ExternalWriteResult = {
          externalId: 'notion-page-conflict',
          externalUpdatedAt: '2026-03-02T00:00:00.000Z',
        };
        return result;
      },
    };

    const tally = await reconcileTasks(orgId, humanActorId, integration, teamId, [notionItem], {
      assigneeId: null,
      writable,
    });

    expect(tally).toMatchObject({ pushed: 1, conflicts: 1, pulled: 0 });

    // The outbound push carries DOCKET's value, not Notion's losing one.
    expect(pushCalls).toEqual([
      expect.objectContaining({
        provider: 'notion',
        op: expect.objectContaining({
          kind: 'update',
          externalId: 'notion-page-conflict',
          title: 'Docket’s title wins',
        }),
      }),
    ]);

    // Docket's own row is untouched by Notion's losing title.
    const after = one(await db.select().from(schema.task).where(eq(schema.task.id, local.id)));
    expect(after.title).toBe('Docket’s title wins');

    // The loss is recorded — provider: 'notion' specifically — not silently dropped.
    const events = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.subjectId, local.id), eq(schema.auditEvent.organizationId, orgId)),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      kind: 'sync_conflict',
      provider: 'notion',
      integrationId: integration.id,
      resolution: 'docket_wins',
      externalId: 'notion-page-conflict',
      remoteTitle: 'Notion’s title (loses)',
      remoteBody: 'Notion’s notes (loses)',
    });
  });
});
