/**
 * `@docket/api` — behavioral coverage for the Notion mirror orchestration passes.
 *
 * @remarks
 * The provider edge is recorded in memory while persistence uses the migrated test database. This
 * keeps the tests network-free without mocking away the tenant scoping, row anchors, or conflict
 * records that make the reconciler safe.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import {
  orderedColumns,
  projectRow,
  type MirrorChange,
  type MirrorDatabaseSpec,
  type MirrorExternalPerson,
  type MirrorParentPage,
  type MirrorRowOp,
  type MirrorRowResult,
  type NotionMirrorPort,
  type ProvisionedMirrorDatabase,
} from '@docket/integrations';

import { loadEntityRows } from '../../src/routes/notion-mirror-entities';
import { ensureDesigns, type MirrorDatabaseRow } from '../../src/routes/notion-mirror-design';
import {
  projectEntity,
  provisionMirror,
  pullBackEntity,
  runNotionMirrorSync,
  sweepNotionMirror,
  type MirrorContext,
} from '../../src/routes/notion-mirror-reconcile';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

class RecordingMirror implements NotionMirrorPort {
  readonly writes: MirrorRowOp[] = [];
  readonly provisions: MirrorDatabaseSpec[] = [];
  readonly schemaUpdates: MirrorDatabaseSpec[] = [];
  changes: MirrorChange[] = [];
  omitWriteResults = false;
  includeProvisionUrl = true;
  private sequence = 0;

  botId(): Promise<string> {
    return Promise.resolve('notion-bot');
  }

  listParentPages(): Promise<MirrorParentPage[]> {
    return Promise.resolve([{ id: 'parent-1', title: 'Workspace' }]);
  }

  listWorkspaceUsers(): Promise<MirrorExternalPerson[]> {
    return Promise.resolve([]);
  }

  provisionDatabase(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase> {
    this.sequence += 1;
    this.provisions.push(spec);
    const suffix = String(this.sequence);
    return Promise.resolve({
      externalDatabaseId: `db-${suffix}`,
      externalDataSourceId: `ds-${suffix}`,
      ...(this.includeProvisionUrl ? { url: `https://notion.example/db-${suffix}` } : {}),
      propertyIds: Object.fromEntries(
        spec.columns.map((column) => [column.field, `property-${suffix}-${column.field}`]),
      ),
    });
  }

  updateDatabaseSchema(
    _dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<Record<string, string>> {
    this.schemaUpdates.push(spec);
    return Promise.resolve(
      Object.fromEntries(spec.columns.map((column) => [column.field, `property-${column.field}`])),
    );
  }

  writeRow(op: MirrorRowOp): Promise<MirrorRowResult | undefined> {
    this.sequence += 1;
    this.writes.push(op);
    if (op.kind === 'delete') return Promise.resolve(undefined);
    if (this.omitWriteResults) return Promise.resolve(undefined);
    return Promise.resolve({
      externalPageId: op.externalPageId ?? `page-${String(this.sequence)}`,
      externalUpdatedAt: `2026-08-${String(10 + this.sequence).padStart(2, '0')}T12:00:00.000Z`,
    });
  }

  queryChanges(_dataSourceId: string, _since?: string): Promise<MirrorChange[]> {
    return Promise.resolve(this.changes);
  }
}

async function seedMirror() {
  const base = await seedBaseOrg(db, schema);
  const integration = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: base.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: base.humanActorId,
        config: { notionMirror: { containerPageId: 'parent-1' } },
      })
      .returning(),
  );
  const designs = await ensureDesigns(base.orgId, integration.id, base.humanActorId);
  const mirror = new RecordingMirror();
  const ctx: MirrorContext = {
    orgId: base.orgId,
    integrationId: integration.id,
    integrationRow: integration,
    actorId: base.humanActorId,
    mirror,
    now: new Date('2026-08-10T12:00:00.000Z'),
  };
  return { ...base, integration, designs, mirror, ctx };
}

function findDesign(
  designs: readonly MirrorDatabaseRow[],
  entity: MirrorDatabaseRow['entityType'],
) {
  const design = designs.find((candidate) => candidate.entityType === entity);
  if (!design) throw new Error(`${entity} design was not seeded`);
  return design;
}

describe('Notion mirror reconciliation', () => {
  it('provisions scalar columns first, resolves relations second, and is idempotent', async () => {
    const { integration, designs, mirror, ctx } = await seedMirror();
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({
        enabled: true,
        propertyMap: {
          ...findDesign(designs, 'task').propertyMap,
          project: {
            ...findDesign(designs, 'task').propertyMap['project']!,
            relationDataSourceId: 'explicit-project-source',
          },
          retiredRelation: {
            field: 'retiredRelation',
            title: 'Retired relation',
            kind: 'relation',
            order: 99,
          },
        },
      })
      .where(
        and(
          eq(schema.notionMirrorDatabase.integrationId, integration.id),
          eq(schema.notionMirrorDatabase.entityType, 'project'),
        ),
      );
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: true })
      .where(
        and(
          eq(schema.notionMirrorDatabase.integrationId, integration.id),
          eq(schema.notionMirrorDatabase.entityType, 'task'),
        ),
      );

    mirror.includeProvisionUrl = false;
    expect(await provisionMirror(ctx, 'parent-1')).toBe(2);
    expect(mirror.provisions).toHaveLength(2);
    expect(mirror.provisions.flatMap((spec) => spec.columns)).not.toContainEqual(
      expect.objectContaining({ kind: 'relation' }),
    );
    expect(mirror.schemaUpdates.length).toBeGreaterThan(0);
    expect(await provisionMirror(ctx, 'parent-1')).toBe(0);

    const task = await db
      .select()
      .from(schema.notionMirrorDatabase)
      .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, 'task').id));
    expect(task[0]).toMatchObject({
      externalDatabaseId: expect.any(String),
      externalDataSourceId: expect.any(String),
      provisionedAt: ctx.now,
    });
    expect(task[0]?.propertyMap['title']?.propertyId).toBeDefined();
  });

  it('creates, skips, updates, and budgets projected rows truthfully', async () => {
    const { orgId, teamId, integration, designs, mirror, ctx } = await seedMirror();
    const seeded = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({ externalDataSourceId: 'ds-task' })
      .where(eq(schema.notionMirrorDatabase.id, seeded.id));
    const design = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, seeded.id)),
    );
    const first = one(
      await db
        .insert(schema.task)
        .values({ organizationId: orgId, teamId, title: 'First', state: 'backlog' })
        .returning(),
    );
    await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'Second', state: 'backlog' });

    expect(await projectEntity(ctx, design, 1)).toMatchObject({ written: 1, complete: false });
    expect(await projectEntity(ctx, design, 10)).toMatchObject({ written: 1, complete: true });
    expect(await projectEntity(ctx, design, 10)).toMatchObject({ written: 0, complete: true });

    await db
      .update(schema.task)
      .set({ title: 'First changed' })
      .where(eq(schema.task.id, first.id));
    await db
      .update(schema.notionMirrorRow)
      .set({ contentHash: 'stale-after-local-edit' })
      .where(
        and(
          eq(schema.notionMirrorRow.integrationId, integration.id),
          eq(schema.notionMirrorRow.entityId, first.id),
        ),
      );
    expect(await projectEntity(ctx, design, 10)).toMatchObject({ written: 1, complete: true });
    expect(mirror.writes.some((write) => write.kind === 'create')).toBe(true);
    expect(mirror.writes.some((write) => write.kind === 'update')).toBe(true);

    expect(await projectEntity(ctx, { ...design, externalDataSourceId: null }, 10)).toEqual({
      written: 0,
      conflicts: 0,
      complete: true,
    });
    const mirrored = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.integrationId, integration.id));
    expect(mirrored).toHaveLength(2);
  });

  it('counts provider no-op responses without claiming provider ids were returned', async () => {
    const { orgId, teamId, integration, designs, mirror, ctx } = await seedMirror();
    const seeded = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({ externalDataSourceId: 'ds-task' })
      .where(eq(schema.notionMirrorDatabase.id, seeded.id));
    const design = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, seeded.id)),
    );
    const task = one(
      await db
        .insert(schema.task)
        .values({ organizationId: orgId, teamId, title: 'No result', state: 'backlog' })
        .returning(),
    );
    mirror.omitWriteResults = true;

    expect(await projectEntity(ctx, design, 10)).toMatchObject({ written: 1 });
    expect(
      await db
        .select()
        .from(schema.notionMirrorRow)
        .where(eq(schema.notionMirrorRow.entityId, task.id)),
    ).toHaveLength(0);

    await db.insert(schema.notionMirrorRow).values({
      organizationId: orgId,
      integrationId: integration.id,
      entityType: 'task',
      entityId: task.id,
      externalPageId: 'page-no-result',
      contentHash: 'stale',
    });
    expect(await projectEntity(ctx, design, 10)).toMatchObject({ written: 1 });
  });

  it('adopts, pulls, records contested edits, and trashes archived rows in one pass', async () => {
    const { orgId, teamId, integration, designs, mirror, ctx } = await seedMirror();
    const seeded = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({ externalDataSourceId: 'ds-task' })
      .where(eq(schema.notionMirrorDatabase.id, seeded.id));
    const design = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, seeded.id)),
    );
    const tasks = await db
      .insert(schema.task)
      .values([
        { organizationId: orgId, teamId, title: 'Pull me', state: 'backlog' },
        { organizationId: orgId, teamId, title: 'Conflict', state: 'backlog' },
        { organizationId: orgId, teamId, title: 'Archived', state: 'backlog' },
      ])
      .returning();
    const [pullTask, conflictTask, archivedTask] = tasks;
    if (!pullTask || !conflictTask || !archivedTask)
      throw new Error('task fixtures were not seeded');

    const t0 = new Date('2026-08-01T10:00:00.000Z');
    const t1 = new Date('2026-08-01T11:00:00.000Z');
    const t2 = new Date('2026-08-01T12:00:00.000Z');
    await db.insert(schema.notionMirrorRow).values([
      {
        organizationId: orgId,
        integrationId: integration.id,
        entityType: 'task',
        entityId: pullTask.id,
        externalPageId: 'page-pull',
        externalUpdatedAt: t0,
        lastPushedAt: t0,
        updatedAt: t0,
        contentHash: 'old-pull',
      },
      {
        organizationId: orgId,
        integrationId: integration.id,
        entityType: 'task',
        entityId: conflictTask.id,
        externalPageId: 'page-conflict',
        externalUpdatedAt: t0,
        lastPushedAt: t0,
        updatedAt: t2,
        contentHash: 'old-conflict',
      },
      {
        organizationId: orgId,
        integrationId: integration.id,
        entityType: 'task',
        entityId: archivedTask.id,
        externalPageId: 'page-trash',
        externalUpdatedAt: t0,
        lastPushedAt: t0,
        updatedAt: t0,
        deletedAt: t1,
        contentHash: 'old-trash',
      },
    ]);

    const records = await loadEntityRows(orgId, integration.id, 'task');
    const bindings = orderedColumns(design.propertyMap);
    const propertiesFor = (entityId: string) => {
      const record = records.find((candidate) => candidate.entityId === entityId);
      if (!record) throw new Error(`missing record ${entityId}`);
      return projectRow(bindings, record.values).properties;
    };
    mirror.changes = [
      {
        externalPageId: 'page-pull',
        externalUpdatedAt: t1.toISOString(),
        archived: false,
        properties: propertiesFor(pullTask.id),
        lastEditedBy: 'person-1',
      },
      {
        externalPageId: 'page-conflict',
        externalUpdatedAt: t1.toISOString(),
        archived: false,
        properties: propertiesFor(conflictTask.id),
        lastEditedBy: 'person-1',
      },
      {
        externalPageId: 'page-trash',
        externalUpdatedAt: t1.toISOString(),
        archived: false,
        properties: propertiesFor(archivedTask.id),
        lastEditedBy: 'person-1',
      },
      {
        externalPageId: 'page-adopt',
        externalUpdatedAt: t1.toISOString(),
        archived: false,
        properties: projectRow(bindings, {
          title: { kind: 'text', value: 'Created in Notion' },
          state: { kind: 'option', value: 'backlog' },
        }).properties,
        lastEditedBy: 'person-1',
      },
    ];
    mirror.omitWriteResults = true;

    expect(await pullBackEntity(ctx, design, 10)).toEqual({
      written: 4,
      conflicts: 1,
      complete: true,
    });
    expect(mirror.writes.some((write) => write.kind === 'update')).toBe(true);
    expect(mirror.writes.some((write) => write.kind === 'delete')).toBe(true);
    const adoptedMapping = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.externalPageId, 'page-adopt'));
    expect(adoptedMapping).toHaveLength(1);
    const adopted = adoptedMapping[0];
    if (!adopted) throw new Error('adopted mirror row was not written');
    await expect(
      db.select().from(schema.task).where(eq(schema.task.id, adopted.entityId)),
    ).resolves.toHaveLength(1);
  });

  it('recreates a trashed projection-only page and stops when the budget is exhausted', async () => {
    const { orgId, integration, designs, mirror, ctx } = await seedMirror();
    const seeded = findDesign(designs, 'initiative');
    await db
      .update(schema.notionMirrorDatabase)
      .set({ externalDataSourceId: 'ds-initiative' })
      .where(eq(schema.notionMirrorDatabase.id, seeded.id));
    const design = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, seeded.id)),
    );
    const initiative = one(
      await db
        .insert(schema.initiative)
        .values({ organizationId: orgId, createdBy: ctx.actorId, name: 'North star' })
        .returning(),
    );
    const t0 = new Date('2026-08-01T10:00:00.000Z');
    await db.insert(schema.notionMirrorRow).values({
      organizationId: orgId,
      integrationId: integration.id,
      entityType: 'initiative',
      entityId: initiative.id,
      externalPageId: 'page-initiative',
      externalUpdatedAt: t0,
      lastPushedAt: t0,
      updatedAt: t0,
      contentHash: 'old',
    });
    mirror.changes = [
      {
        externalPageId: 'page-initiative',
        externalUpdatedAt: t0.toISOString(),
        archived: true,
        properties: {},
        lastEditedBy: 'person-1',
      },
    ];

    expect(await pullBackEntity(ctx, design, 1)).toMatchObject({ written: 1, complete: true });
    expect(mirror.writes.at(-1)?.kind).toBe('create');
    expect(await pullBackEntity(ctx, design, 0)).toMatchObject({ written: 0, complete: false });
    expect(await pullBackEntity(ctx, { ...design, externalDataSourceId: null }, 10)).toEqual({
      written: 0,
      conflicts: 0,
      complete: true,
    });
  });

  it('ignores unchanged remote rows and missing local entities without inventing writes', async () => {
    const { orgId, integration, designs, mirror, ctx } = await seedMirror();
    const seeded = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({ externalDataSourceId: 'ds-task' })
      .where(eq(schema.notionMirrorDatabase.id, seeded.id));
    const design = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, seeded.id)),
    );
    const t0 = new Date('2026-08-01T10:00:00.000Z');
    const t1 = new Date('2026-08-01T11:00:00.000Z');
    const t2 = new Date('2026-08-01T12:00:00.000Z');
    await db.insert(schema.notionMirrorRow).values([
      {
        organizationId: orgId,
        integrationId: integration.id,
        entityType: 'task',
        entityId: 'missing-noop',
        externalPageId: 'page-noop',
        externalUpdatedAt: t1,
        lastPushedAt: t1,
        updatedAt: t0,
      },
      {
        organizationId: orgId,
        integrationId: integration.id,
        entityType: 'task',
        entityId: 'missing-pull',
        externalPageId: 'page-missing-pull',
        externalUpdatedAt: t0,
        lastPushedAt: t0,
        updatedAt: t0,
      },
      {
        organizationId: orgId,
        integrationId: integration.id,
        entityType: 'task',
        entityId: 'missing-push',
        externalPageId: 'page-missing-push',
        externalUpdatedAt: t0,
        lastPushedAt: t0,
        updatedAt: t2,
      },
    ]);
    mirror.changes = [
      {
        externalPageId: 'page-noop',
        externalUpdatedAt: t1.toISOString(),
        archived: false,
        properties: {},
        lastEditedBy: 'person-1',
      },
      {
        externalPageId: 'page-missing-pull',
        externalUpdatedAt: t1.toISOString(),
        archived: false,
        properties: {},
        lastEditedBy: 'person-1',
      },
      {
        externalPageId: 'page-missing-push',
        externalUpdatedAt: t0.toISOString(),
        archived: false,
        properties: {},
        lastEditedBy: 'person-1',
      },
    ];

    expect(await pullBackEntity(ctx, design, 10)).toEqual({
      written: 0,
      conflicts: 0,
      complete: true,
    });
    expect(mirror.writes).toHaveLength(0);
  });

  it('runs the leased mirror honestly for configured and incomplete setups', async () => {
    const { integration, designs, ctx } = await seedMirror();
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: true })
      .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, 'label').id));

    const completed = await runNotionMirrorSync(integration, {
      actorId: ctx.actorId,
      trigger: 'manual',
    });
    expect(completed).toMatchObject({ status: 'succeeded', purpose: 'notion_mirror' });

    const incomplete = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: ctx.orgId,
          provider: 'notion',
          pattern: 'connector',
          status: 'connected',
          createdBy: ctx.actorId,
          config: {},
        })
        .returning(),
    );
    const failed = await runNotionMirrorSync(incomplete, {
      actorId: ctx.actorId,
      trigger: 'manual',
    });
    expect(failed).toMatchObject({ status: 'failed', purpose: 'notion_mirror' });

    const malformed = await runNotionMirrorSync(
      { ...incomplete, config: [] as unknown as Record<string, unknown> },
      { actorId: ctx.actorId, trigger: 'manual' },
    );
    expect(malformed).toMatchObject({ status: 'failed', purpose: 'notion_mirror' });
  });

  it('sweeps only due configured mirrors and respects an existing lease', async () => {
    const { integration, ctx } = await seedMirror();
    await db
      .update(schema.integration)
      .set({ syncCadenceMinutes: null })
      .where(eq(schema.integration.provider, 'notion'));
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.integration)
      .set({ syncCadenceMinutes: 15, lastSyncedAt: null })
      .where(eq(schema.integration.id, integration.id));

    const future = new Date('2030-01-01T01:00:00.000Z');
    await db.insert(schema.integration).values([
      {
        organizationId: ctx.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: ctx.actorId,
        config: { notionMirror: { containerPageId: 'parent-1' } },
        syncCadenceMinutes: 15,
        syncStartedAt: future,
      },
      {
        organizationId: ctx.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: null,
        config: { notionMirror: { containerPageId: 'parent-1' } },
        syncCadenceMinutes: 15,
      },
      {
        organizationId: ctx.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: ctx.actorId,
        config: { notionMirror: { containerPageId: 'parent-1' } },
        syncCadenceMinutes: 0,
      },
      {
        organizationId: ctx.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: ctx.actorId,
        config: {},
        syncCadenceMinutes: 15,
      },
      {
        organizationId: ctx.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: ctx.actorId,
        config: { notionMirror: { containerPageId: 'parent-1' } },
        syncCadenceMinutes: 15,
        lastSyncedAt: new Date('2030-01-01T00:59:00.000Z'),
      },
      {
        organizationId: ctx.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: ctx.actorId,
        config: [] as unknown as Record<string, unknown>,
        syncCadenceMinutes: 15,
      },
    ]);

    expect(await sweepNotionMirror(new Date('2030-01-01T00:00:00.000Z'))).toEqual({
      eligible: 2,
      ran: 1,
      failed: 0,
    });
  });
});
