/**
 * `@docket/api` — behavioral coverage for the Notion mirror orchestration passes.
 *
 * @remarks
 * The provider edge is recorded in memory while persistence uses the migrated test database. This
 * keeps the tests network-free without mocking away the tenant scoping, row anchors, or conflict
 * records that make the reconciler safe.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import { MockNotionMirror } from '@docket/connections/notion/adapters/in-memory';
import type {
  MirrorChange,
  MirrorDatabaseSpec,
  MirrorExternalPerson,
  MirrorParentPage,
  MirrorParentPageList,
  MirrorRowOp,
  MirrorRowResult,
  NotionMirrorPort,
  ProvisionedMirrorDatabase,
} from '@docket/connections/notion/mirror-port';
import { ConnectorError } from '@docket/integrations';
import { MIRROR_ENTITY_ORDER, orderedColumns } from '@docket/connections/notion/mirror-schema';
import {
  projectRow,
  resolveMirrorValues,
  type MirrorReferences,
} from '@docket/connections/notion/mirror-values';

import * as container from '../../src/container';
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
import { assertDefined } from '@docket/test-utils';

/**
 * A pass that knows nothing: nobody matched, and no entity projected yet.
 *
 * @remarks
 * The default for cases that are not about references. Every entity carries an entry so a missing
 * page reads as "not written yet" (deferred) rather than "will never exist" — the state a first
 * pass is genuinely in.
 */
const NO_PAGES: MirrorReferences = {
  notionUserByActor: new Map<string, string>(),
  pages: new Map(
    MIRROR_ENTITY_ORDER.map((entity) => [
      entity,
      { pageByEntityId: new Map<string, string>(), settled: false },
    ]),
  ),
};

/** A pass whose People database holds one page, for the person-relation cases. */
function withPersonPage(actorId: string, pageId: string): MirrorReferences {
  const pages = new Map(NO_PAGES.pages);
  pages.set('person', { pageByEntityId: new Map([[actorId, pageId]]), settled: true });
  return { notionUserByActor: new Map(), pages };
}

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

  listParentPages(): Promise<MirrorParentPageList> {
    return Promise.resolve({ items: [{ id: 'parent-1', title: 'Workspace' }], nextCursor: null });
  }

  describePage(pageId: string): Promise<MirrorParentPage> {
    return Promise.resolve({ id: pageId, title: 'Workspace' });
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
            ...assertDefined(findDesign(designs, 'task').propertyMap['project']),
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
    const { orgId, teamId, integration, designs, mirror, ctx, statusId } = await seedMirror();
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
        .values({
          organizationId: orgId,
          teamId,
          title: 'First',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning(),
    );
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Second',
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
    });

    expect(await projectEntity(ctx, design, 1, NO_PAGES)).toMatchObject({
      written: 1,
      complete: false,
    });
    expect(await projectEntity(ctx, design, 10, NO_PAGES)).toMatchObject({
      written: 1,
      complete: true,
    });
    expect(await projectEntity(ctx, design, 10, NO_PAGES)).toMatchObject({
      written: 0,
      complete: true,
    });

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
    expect(await projectEntity(ctx, design, 10, NO_PAGES)).toMatchObject({
      written: 1,
      complete: true,
    });
    expect(mirror.writes.some((write) => write.kind === 'create')).toBe(true);
    expect(mirror.writes.some((write) => write.kind === 'update')).toBe(true);

    expect(
      await projectEntity(ctx, { ...design, externalDataSourceId: null }, 10, NO_PAGES),
    ).toEqual({
      written: 0,
      conflicts: 0,
      complete: true,
      unresolvedPending: 0,
      unresolvedPermanent: 0,
      pageByEntityId: expect.any(Map),
    });
    const mirrored = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.integrationId, integration.id));
    expect(mirrored).toHaveLength(2);
  });

  it('paces sequential Notion creates by 350ms before issuing the next one', async () => {
    const { orgId, teamId, designs, mirror, ctx } = await seedMirror();
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
    await db.insert(schema.task).values([
      { organizationId: orgId, teamId, title: 'First', state: 'backlog' },
      { organizationId: orgId, teamId, title: 'Second', state: 'backlog' },
    ]);

    const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
      let resolve: () => void = () => {
        throw new Error('deferred resolver was not initialized');
      };
      const promise = new Promise<void>((complete) => {
        resolve = complete;
      });
      return { promise, resolve };
    };
    const firstWrite = deferred();
    const secondWrite = deferred();
    const firstPace = deferred();
    const originalWrite = mirror.writeRow.bind(mirror);
    const writeRow = vi.spyOn(mirror, 'writeRow').mockImplementation((op) => {
      const result = originalWrite(op);
      if (mirror.writes.length === 1) firstWrite.resolve();
      if (mirror.writes.length === 2) secondWrite.resolve();
      return result;
    });

    vi.useFakeTimers();
    const originalSetTimeout = globalThis.setTimeout;
    const recordTimer = (...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
      const [, delay] = args;
      if (delay === 350 && mirror.writes.length === 1) firstPace.resolve();
      return Reflect.apply(originalSetTimeout, globalThis, args);
    };
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(recordTimer);
    try {
      const pass = projectEntity(ctx, design, 2, NO_PAGES);
      await firstWrite.promise;
      await firstPace.promise;
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 350);

      await vi.advanceTimersByTimeAsync(349);
      expect(mirror.writes).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await secondWrite.promise;
      expect(mirror.writes).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(350);
      await expect(pass).resolves.toMatchObject({ written: 2, complete: true });
    } finally {
      timer.mockRestore();
      writeRow.mockRestore();
      vi.useRealTimers();
    }
  });

  it('counts provider no-op responses without claiming provider ids were returned', async () => {
    const { orgId, teamId, integration, designs, mirror, ctx, statusId } = await seedMirror();
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
        .values({
          organizationId: orgId,
          teamId,
          title: 'No result',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning(),
    );
    mirror.omitWriteResults = true;

    expect(await projectEntity(ctx, design, 10, NO_PAGES)).toMatchObject({ written: 1 });
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
    expect(await projectEntity(ctx, design, 10, NO_PAGES)).toMatchObject({ written: 1 });
  });

  it('adopts, pulls, records contested edits, and trashes archived rows in one pass', async () => {
    const { orgId, teamId, integration, designs, mirror, ctx, statusId } = await seedMirror();
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
        {
          organizationId: orgId,
          teamId,
          title: 'Pull me',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Conflict',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Archived',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        },
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
      return projectRow(bindings, resolveMirrorValues(bindings, record.values, NO_PAGES).values)
        .properties;
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

    expect(await pullBackEntity(ctx, design, 10, NO_PAGES)).toEqual({
      written: 4,
      conflicts: 1,
      complete: true,
      unresolvedPending: 0,
      unresolvedPermanent: 0,
      pageByEntityId: expect.any(Map),
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
    const { orgId, integration, designs, mirror, ctx, statusId } = await seedMirror();
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
        .values({
          organizationId: orgId,
          createdBy: ctx.actorId,
          name: 'North star',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
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

    expect(await pullBackEntity(ctx, design, 1, NO_PAGES)).toMatchObject({
      written: 1,
      complete: true,
    });
    expect(mirror.writes.at(-1)?.kind).toBe('create');
    expect(await pullBackEntity(ctx, design, 0, NO_PAGES)).toMatchObject({
      written: 0,
      complete: false,
    });
    expect(
      await pullBackEntity(ctx, { ...design, externalDataSourceId: null }, 10, NO_PAGES),
    ).toEqual({
      written: 0,
      conflicts: 0,
      complete: true,
      unresolvedPending: 0,
      unresolvedPermanent: 0,
      pageByEntityId: expect.any(Map),
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

    expect(await pullBackEntity(ctx, design, 10, NO_PAGES)).toEqual({
      written: 0,
      conflicts: 0,
      complete: true,
      unresolvedPending: 0,
      unresolvedPermanent: 0,
      pageByEntityId: expect.any(Map),
    });
    expect(mirror.writes).toHaveLength(0);
  });

  it('provisions a Docket People relation at the People database, not at nothing', async () => {
    // Person-valued fields carry no `relationEntity` — they are not catalog relations — so this
    // target used to resolve to undefined, the column was dropped from the spec, and the
    // representation was selectable while creating nothing in Notion at all.
    const { integration, designs, mirror, ctx } = await seedMirror();
    const taskDesign = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: true })
      .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, 'person').id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({
        enabled: true,
        propertyMap: {
          ...taskDesign.propertyMap,
          assignee: {
            ...assertDefined(taskDesign.propertyMap['assignee']),
            representation: 'docket_people_table',
          },
        },
      })
      .where(eq(schema.notionMirrorDatabase.id, taskDesign.id));

    await provisionMirror(ctx, 'parent-1');

    const assigneeSpec = mirror.schemaUpdates
      .flatMap((spec) => spec.columns)
      .find((column) => column.field === 'assignee');
    expect(assigneeSpec).toMatchObject({ kind: 'relation' });
    expect(assigneeSpec?.relationDataSourceId).toEqual(expect.any(String));
  });

  it('writes People before the rows that point at it, and omits an id it does not have yet', async () => {
    const { orgId, teamId, integration, designs, mirror, ctx, statusId } = await seedMirror();
    const taskDesign = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: true })
      .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, 'person').id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({
        enabled: true,
        propertyMap: {
          ...taskDesign.propertyMap,
          assignee: {
            ...assertDefined(taskDesign.propertyMap['assignee']),
            representation: 'docket_people_table',
          },
        },
      })
      .where(eq(schema.notionMirrorDatabase.id, taskDesign.id));
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Assigned work',
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
      assigneeId: ctx.actorId,
    });

    await runNotionMirrorSync(integration, { actorId: ctx.actorId, trigger: 'manual' });

    // Person rows are written first, so by the time the task is projected its assignee's page id
    // already exists. Sorting the pass by entity is what guarantees this, rather than the select's
    // row order — which is whatever Postgres happens to return.
    const createdRows = await db
      .select({
        entityType: schema.notionMirrorRow.entityType,
        entityId: schema.notionMirrorRow.entityId,
        externalPageId: schema.notionMirrorRow.externalPageId,
      })
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.integrationId, integration.id));
    const personRow = createdRows.find((row) => row.entityType === 'person');
    expect(personRow).toBeDefined();
    expect(createdRows.map((row) => row.entityType)).toContain('task');

    // Re-projecting now writes the assignee as a real relation to that People page. Driven
    // through `projectEntity` because `runNotionMirrorSync` builds its own provider from the
    // container, so the recording mirror above never sees its writes.
    const refreshedTask = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, taskDesign.id)),
    );
    await db.delete(schema.notionMirrorRow).where(eq(schema.notionMirrorRow.entityType, 'task'));
    await projectEntity(
      ctx,
      refreshedTask,
      10,
      withPersonPage(ctx.actorId, assertDefined(personRow).externalPageId),
    );

    const written = mirror.writes.find((op) => op.kind === 'create');
    expect(JSON.stringify(written?.properties)).toContain(assertDefined(personRow).externalPageId);
  });

  it('leaves a relation out entirely when the People row does not exist yet', async () => {
    // Not `[]` — an empty relation CLEARS the Notion property, which for "not written yet" would
    // erase a cell rather than defer it. The omitted value also stays out of the content hash, so
    // the pass that can resolve it sees a change and writes exactly once.
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const taskDesign = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({
        externalDataSourceId: 'ds-task',
        propertyMap: {
          ...taskDesign.propertyMap,
          assignee: {
            ...assertDefined(taskDesign.propertyMap['assignee']),
            representation: 'docket_people_table',
            propertyId: 'prop-assignee',
          },
        },
      })
      .where(eq(schema.notionMirrorDatabase.id, taskDesign.id));
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Assigned work',
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
      assigneeId: ctx.actorId,
    });
    const refreshed = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, taskDesign.id)),
    );

    const pass = await projectEntity(ctx, refreshed, 10, NO_PAGES);

    expect(pass).toMatchObject({ written: 1, unresolvedPending: 1, complete: false });
    const created = mirror.writes.find((op) => op.kind === 'create');
    expect(created?.properties).not.toHaveProperty('prop-assignee');
  });

  it('fills an ordinary relation column with the target rows real page ids', async () => {
    // The defect this covers: every relation column was provisioned correctly, pointed at the
    // right data source, and then never received a single value, because no loader produced one.
    const { orgId, teamId, integration, designs, mirror, ctx, statusId } = await seedMirror();
    const projectRow = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Transit campaign',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning(),
    );
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Draft the brief',
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
      projectId: projectRow.id,
    });
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    for (const entity of ['project', 'task'] as const) {
      await db
        .update(schema.notionMirrorDatabase)
        .set({ enabled: true })
        .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, entity).id));
    }

    await runNotionMirrorSync(integration, { actorId: ctx.actorId, trigger: 'manual' });

    // Projects are projected before tasks, so by the time the task is written its project has a
    // page — one pass, not two.
    const rows = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.integrationId, integration.id));
    const projectPage = rows.find((row) => row.entityType === 'project')?.externalPageId;
    expect(projectPage).toEqual(expect.any(String));

    const refreshedTask = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, 'task').id)),
    );
    await db.delete(schema.notionMirrorRow).where(eq(schema.notionMirrorRow.entityType, 'task'));
    await projectEntity(ctx, refreshedTask, 10, {
      notionUserByActor: new Map(),
      pages: new Map([
        [
          'project',
          { pageByEntityId: new Map([[projectRow.id, assertDefined(projectPage)]]), settled: true },
        ],
      ]),
    });

    const created = mirror.writes.find((op) => op.kind === 'create');
    expect(JSON.stringify(created?.properties)).toContain(assertDefined(projectPage));
  });

  it('reports a reference to a disabled database as final, so the pass can still complete', async () => {
    // Its database is never projected, so no page will ever exist. Deferring would leave the pass
    // permanently incomplete and `stampFullSync` permanently false.
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
    const projectRow = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Unmirrored',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning(),
    );
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Draft the brief',
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
      projectId: projectRow.id,
    });
    const taskDesign = findDesign(designs, 'task');
    await db
      .update(schema.notionMirrorDatabase)
      .set({
        externalDataSourceId: 'ds-task',
        propertyMap: {
          ...taskDesign.propertyMap,
          project: {
            ...assertDefined(taskDesign.propertyMap['project']),
            propertyId: 'prop-project',
          },
        },
      })
      .where(eq(schema.notionMirrorDatabase.id, taskDesign.id));
    const refreshed = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, taskDesign.id)),
    );

    // No entry for `project` at all — the shape `loadReferences` produces for a disabled design.
    const pass = await projectEntity(ctx, refreshed, 10, {
      notionUserByActor: new Map(),
      pages: new Map(),
    });

    expect(pass).toMatchObject({ written: 1, unresolvedPermanent: 1, complete: true });
    const created = mirror.writes.find((op) => op.kind === 'create');
    expect(created?.properties).toMatchObject({ 'prop-project': { relation: [] } });
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

  it('turns a rejected Notion credential into a reauthorization state', async () => {
    // This is intentionally the whole path, not only ConnectorError classification: the provider
    // reports auth, the leased sync records failure, and the owner gets the reconnect state rather
    // than an opaque background failure.
    const { integration, ctx } = await seedMirror();
    const [owner] = await db
      .insert(schema.user)
      .values({
        name: 'Notion owner',
        email: `notion-owner-${Math.random().toString(36).slice(2)}@example.test`,
      })
      .returning({ id: schema.user.id });
    if (!owner) throw new Error('owner user was not created');
    await db.update(schema.actor).set({ userId: owner.id }).where(eq(schema.actor.id, ctx.actorId));
    const mirror = new MockNotionMirror();
    vi.spyOn(mirror, 'listWorkspaceUsers').mockRejectedValue(
      new ConnectorError('Notion access token was rejected', { provider: 'notion', kind: 'auth' }),
    );
    const buildMirror = vi.spyOn(container, 'buildNotionMirror').mockReturnValue(mirror);

    try {
      const run = await runNotionMirrorSync(integration, {
        actorId: ctx.actorId,
        trigger: 'manual',
      });
      expect(run).toMatchObject({
        status: 'failed',
        error: 'Notion access token was rejected',
        purpose: 'notion_mirror',
      });

      const [stored] = await db
        .select({ status: schema.integration.status, lastError: schema.integration.lastError })
        .from(schema.integration)
        .where(eq(schema.integration.id, integration.id));
      expect(stored).toMatchObject({
        status: 'error',
        lastError: 'Notion access token was rejected',
      });

      const notifications = await db
        .select({ type: schema.notification.type, userId: schema.notification.userId })
        .from(schema.notification)
        .where(eq(schema.notification.organizationId, ctx.orgId));
      expect(notifications).toEqual([{ type: 'connector_needs_reauth', userId: owner.id }]);
    } finally {
      buildMirror.mockRestore();
    }
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

    // `stalled` covers the three that can never run as configured — no owning actor, and the two
    // with no container page (absent and malformed config). They used to be skipped in silence,
    // which made a permanently stuck workspace look exactly like one with nothing due. The
    // zero-cadence row is NOT stalled: that is a deliberate manual-only connection.
    expect(await sweepNotionMirror(new Date('2030-01-01T00:00:00.000Z'))).toEqual({
      eligible: 2,
      ran: 1,
      failed: 0,
      stalled: 3,
    });
  });
});
