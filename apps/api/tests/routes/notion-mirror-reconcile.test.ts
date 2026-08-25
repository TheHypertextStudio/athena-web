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
  MirrorCreatedRow,
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
import { ProviderError } from '@docket/connections/provider-error';
import { MIRROR_ENTITY_ORDER, orderedColumns } from '@docket/connections/notion/mirror-schema';
import {
  projectRow,
  resolveMirrorValues,
  type MirrorReferences,
} from '@docket/connections/notion/mirror-values';

import * as container from '../../src/container';
import { loadEntityRows } from '../../src/routes/notion-mirror-entities';
import { ensureDesigns, type MirrorDatabaseRow } from '../../src/routes/notion-mirror-design';
import { wakeNotionMirror } from '../../src/routes/notion-mirror-wake';
import {
  projectEntity,
  provisionMirror,
  pullBackEntity,
  recoverCreationIntents,
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
  failProvisionAfterCreate = false;
  failRowAfterCreate = false;
  readonly createdRows: MirrorCreatedRow[] = [];
  readonly ownedDatabases = new Map<string, ProvisionedMirrorDatabase[]>();
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
    const provisioned = {
      externalDatabaseId: `db-${suffix}`,
      externalDataSourceId: `ds-${suffix}`,
      ...(this.includeProvisionUrl ? { url: `https://notion.example/db-${suffix}` } : {}),
      propertyIds: Object.fromEntries(
        spec.columns.map((column) => [column.field, `property-${suffix}-${column.field}`]),
      ),
    };
    this.ownedDatabases.set(spec.ownershipKey, [provisioned]);
    if (this.failProvisionAfterCreate) {
      return Promise.reject(new Error('connection lost after Notion created the database'));
    }
    return Promise.resolve(provisioned);
  }

  findDatabasesByOwnershipKey(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase[]> {
    return Promise.resolve(this.ownedDatabases.get(spec.ownershipKey) ?? []);
  }

  /** Data sources deleted at the provider, which answer `object_not_found` from then on. */
  readonly missingDataSources = new Set<string>();

  /** Delete a data source. */
  deleteDataSource(dataSourceId: string): void {
    this.missingDataSources.add(dataSourceId);
  }

  updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<{ propertyIds: Record<string, string> }> {
    if (this.missingDataSources.has(dataSourceId)) {
      return Promise.reject(
        new ProviderError(`Notion schema update for "${spec.title}" failed (object_not_found)`, {
          provider: 'notion',
          kind: 'provider',
          status: 404,
        }),
      );
    }
    this.schemaUpdates.push(spec);
    return Promise.resolve({
      propertyIds: Object.fromEntries(
        spec.columns.map((column) => [column.field, `property-${dataSourceId}-${column.field}`]),
      ),
    });
  }

  queryCreatedRows(_dataSourceId: string, _since: string): Promise<MirrorCreatedRow[]> {
    return Promise.resolve(this.createdRows);
  }

  writeRow(op: MirrorRowOp): Promise<MirrorRowResult | undefined> {
    this.sequence += 1;
    this.writes.push(op);
    if (op.kind === 'delete') return Promise.resolve(undefined);
    if (this.omitWriteResults) return Promise.resolve(undefined);
    const result = {
      externalPageId: op.externalPageId ?? `page-${String(this.sequence)}`,
      externalUpdatedAt: `2026-08-${String(10 + this.sequence).padStart(2, '0')}T12:00:00.000Z`,
    };
    if (op.kind === 'create') {
      this.createdRows.push({
        ...result,
        externalCreatedAt: result.externalUpdatedAt,
        createdBy: 'notion-bot',
      });
      if (this.failRowAfterCreate) {
        return Promise.reject(new Error('connection lost after Notion created the page'));
      }
    }
    return Promise.resolve(result);
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
  it('adopts an exactly owned database after a lost create response', async () => {
    const { integration, mirror, ctx } = await seedMirror();
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: true })
      .where(
        and(
          eq(schema.notionMirrorDatabase.integrationId, integration.id),
          eq(schema.notionMirrorDatabase.entityType, 'task'),
        ),
      );
    mirror.failProvisionAfterCreate = true;

    await expect(provisionMirror(ctx, 'parent-1')).rejects.toThrow(
      'connection lost after Notion created the database',
    );
    mirror.failProvisionAfterCreate = false;
    await provisionMirror(ctx, 'parent-1');

    expect(mirror.provisions).toHaveLength(1);
    const [design] = await db
      .select()
      .from(schema.notionMirrorDatabase)
      .where(
        and(
          eq(schema.notionMirrorDatabase.integrationId, integration.id),
          eq(schema.notionMirrorDatabase.entityType, 'task'),
        ),
      );
    expect(design).toMatchObject({
      externalDatabaseId: 'db-1',
      externalDataSourceId: 'ds-1',
    });
  });

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

  it('rebuilds a database somebody deleted in Notion instead of failing every pass', async () => {
    // Reproduces `Notion schema update for "Teams" failed (object_not_found)` from production:
    // creation is skipped because an id is recorded, then patching that dead id fails the pass.
    const { designs, mirror, ctx } = await seedMirror();
    await provisionMirror(ctx, 'parent-1');
    const before = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, 'task').id)),
    );
    const deleted = assertDefined(before.externalDataSourceId);

    mirror.deleteDataSource(deleted);

    await expect(provisionMirror(ctx, 'parent-1')).resolves.toBeGreaterThan(0);

    const after = one(
      await db
        .select()
        .from(schema.notionMirrorDatabase)
        .where(eq(schema.notionMirrorDatabase.id, findDesign(designs, 'task').id)),
    );
    expect(after.externalDataSourceId).not.toBeNull();
    expect(after.externalDataSourceId).not.toBe(deleted);
    expect(after.provisionedAt).not.toBeNull();
    expect(after.propertyMap['title']?.propertyId).toBeDefined();
    expect(after.propertyMap['title']?.propertyId).not.toBe(
      before.propertyMap['title']?.propertyId,
    );
  });

  it('stops rebuilding when Notion calls a database it just created missing', async () => {
    // The rebuild recovers from a database deleted between passes, so it assumes the recreated one
    // works. A provider that keeps answering `object_not_found` would otherwise drive an unbounded
    // loop creating real databases in somebody's workspace. It has to fail instead.
    const { mirror, ctx } = await seedMirror();
    const rejectEverything = mirror.updateDatabaseSchema.bind(mirror);
    mirror.updateDatabaseSchema = (dataSourceId: string, spec: MirrorDatabaseSpec) => {
      mirror.deleteDataSource(dataSourceId);
      return rejectEverything(dataSourceId, spec);
    };

    await expect(provisionMirror(ctx, 'parent-1')).rejects.toThrow(/stopped rebuilding/i);

    // One initial creation per design, plus one rebuild each.
    expect(mirror.provisions.length).toBeLessThanOrEqual(MIRROR_ENTITY_ORDER.length * 2);
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

  it('adopts an exactly identified page after a lost create response', async () => {
    const { orgId, teamId, statusId, designs, mirror, ctx, integration } = await seedMirror();
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
    const [task] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Recover this page',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!task) throw new Error('task was not created');
    mirror.failRowAfterCreate = true;

    await expect(projectEntity(ctx, design, 10, NO_PAGES)).rejects.toMatchObject({
      kind: 'ambiguous',
    });
    mirror.failRowAfterCreate = false;
    await recoverCreationIntents(ctx, [design]);
    await projectEntity(ctx, design, 10, NO_PAGES);

    expect(mirror.writes.filter((write) => write.kind === 'create')).toHaveLength(1);
    expect(JSON.stringify(mirror.writes)).not.toContain(task.id);
    const [mapping] = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(
        and(
          eq(schema.notionMirrorRow.integrationId, integration.id),
          eq(schema.notionMirrorRow.entityId, task.id),
        ),
      );
    expect(mapping?.externalPageId).toMatch(/^page-/);
  });

  it('paces sequential Notion creates by 350ms before issuing the next one', async () => {
    const { orgId, teamId, statusId, designs, mirror, ctx } = await seedMirror();
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
      {
        organizationId: orgId,
        teamId,
        title: 'First',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      },
      {
        organizationId: orgId,
        teamId,
        title: 'Second',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      },
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
    const { orgId, teamId, designs, mirror, ctx, statusId } = await seedMirror();
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

    await expect(projectEntity(ctx, design, 10, NO_PAGES)).rejects.toMatchObject({
      kind: 'ambiguous',
    });
    const [intent] = await db
      .select()
      .from(schema.notionMirrorRow)
      .where(eq(schema.notionMirrorRow.entityId, task.id));
    expect(intent?.externalPageId).toBeNull();

    await db
      .update(schema.notionMirrorRow)
      .set({ externalPageId: 'page-no-result', contentHash: 'stale' })
      .where(eq(schema.notionMirrorRow.id, assertDefined(intent).id));
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
      withPersonPage(ctx.actorId, assertDefined(assertDefined(personRow).externalPageId)),
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

  it('applies only the generation captured before a complete mirror pass', async () => {
    const { integration, ctx, mirror } = await seedMirror();
    await wakeNotionMirror({
      integrationId: integration.id,
      organizationId: ctx.orgId,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    vi.spyOn(mirror, 'listWorkspaceUsers').mockImplementationOnce(async () => {
      await wakeNotionMirror({
        integrationId: integration.id,
        organizationId: ctx.orgId,
        now: new Date('2030-01-01T00:00:01.000Z'),
      });
      return [];
    });
    const buildMirror = vi.spyOn(container, 'buildNotionMirror').mockReturnValue(mirror);

    try {
      const run = await runNotionMirrorSync(integration, {
        actorId: ctx.actorId,
        trigger: 'manual',
      });
      expect(run).toMatchObject({ status: 'succeeded', purpose: 'notion_mirror' });

      const [state] = await db
        .select()
        .from(schema.notionMirrorState)
        .where(eq(schema.notionMirrorState.integrationId, integration.id));
      expect(state).toMatchObject({ desiredGeneration: 2, appliedGeneration: 1 });
    } finally {
      buildMirror.mockRestore();
    }
  });

  it('keeps a failed mirror generation pending for retry', async () => {
    const { integration, ctx } = await seedMirror();
    const mirror = new MockNotionMirror();
    vi.spyOn(mirror, 'listWorkspaceUsers').mockRejectedValue(new Error('temporary Notion outage'));
    const buildMirror = vi.spyOn(container, 'buildNotionMirror').mockReturnValue(mirror);

    try {
      const run = await runNotionMirrorSync(integration, {
        actorId: ctx.actorId,
        trigger: 'manual',
      });
      expect(run).toMatchObject({ status: 'failed', error: 'temporary Notion outage' });

      const [state] = await db
        .select()
        .from(schema.notionMirrorState)
        .where(eq(schema.notionMirrorState.integrationId, integration.id));
      expect(state).toMatchObject({
        desiredGeneration: 1,
        appliedGeneration: 0,
        consecutiveFailures: 1,
        lastError: 'temporary Notion outage',
      });
      expect(state?.nextAttemptAt).not.toBeNull();
    } finally {
      buildMirror.mockRestore();
    }
  });

  it('sweeps only due configured mirrors and respects an existing lease', async () => {
    const { integration, ctx } = await seedMirror();
    await db
      .update(schema.integration)
      .set({ status: 'disconnected', syncCadenceMinutes: null })
      .where(eq(schema.integration.provider, 'notion'));
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.integration)
      .set({ status: 'connected', syncCadenceMinutes: 15, lastSyncedAt: null })
      .where(eq(schema.integration.id, integration.id));

    const future = new Date('2030-01-01T01:00:00.000Z');
    // Its own mirror history is what makes this one undue, inserted below.
    const recentlyMirroredId = 'int_recently_mirrored';
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
        id: recentlyMirroredId,
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

    // A mirror pass inside the cadence window is what holds a connection undue.
    await db.insert(schema.syncRun).values({
      organizationId: ctx.orgId,
      integrationId: recentlyMirroredId,
      status: 'succeeded',
      trigger: 'scheduled',
      purpose: 'notion_mirror',
      startedAt: new Date('2029-12-31T23:59:00.000Z'),
    });

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

  it('stays due when another purpose synced the same connection recently', async () => {
    // `integration.lastSyncedAt` is a roll-up written by whichever purpose ran last, and a Notion
    // connection runs two. Reading it here let a succeeding `task_sync` hold the mirror undue on
    // every sweep — which is what happened in production the moment `task_sync` started working.
    const { integration, ctx } = await seedMirror();
    const now = new Date('2030-01-01T00:00:00.000Z');
    await db
      .update(schema.integration)
      .set({
        syncCadenceMinutes: 15,
        // A task_sync that finished seconds ago.
        lastSyncedAt: new Date('2029-12-31T23:59:30.000Z'),
      })
      .where(eq(schema.integration.id, integration.id));
    await db.insert(schema.syncRun).values({
      organizationId: ctx.orgId,
      integrationId: integration.id,
      status: 'succeeded',
      trigger: 'scheduled',
      purpose: 'task_sync',
      startedAt: new Date('2029-12-31T23:59:30.000Z'),
    });

    await sweepNotionMirror(now);

    // Asserted per connection rather than on the sweep's totals: it scans every Notion
    // integration in the database, including those other tests left behind.
    const mirrorRuns = await db
      .select()
      .from(schema.syncRun)
      .where(
        and(
          eq(schema.syncRun.integrationId, integration.id),
          eq(schema.syncRun.purpose, 'notion_mirror'),
        ),
      );
    expect(mirrorRuns).toHaveLength(1);
  });

  it('runs a pending generation immediately even when scheduled cadence is disabled', async () => {
    const { integration, ctx, mirror } = await seedMirror();
    await db
      .update(schema.integration)
      .set({ status: 'disconnected' })
      .where(eq(schema.integration.provider, 'notion'));
    await db
      .update(schema.integration)
      .set({ status: 'connected', syncCadenceMinutes: null })
      .where(eq(schema.integration.id, integration.id));
    await wakeNotionMirror({
      integrationId: integration.id,
      organizationId: ctx.orgId,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    const before = await db
      .select()
      .from(schema.syncRun)
      .where(
        and(
          eq(schema.syncRun.integrationId, integration.id),
          eq(schema.syncRun.purpose, 'notion_mirror'),
        ),
      );
    const buildMirror = vi.spyOn(container, 'buildNotionMirror').mockReturnValue(mirror);

    try {
      await sweepNotionMirror(new Date('2030-01-01T00:00:01.000Z'));
    } finally {
      buildMirror.mockRestore();
    }

    const after = await db
      .select()
      .from(schema.syncRun)
      .where(
        and(
          eq(schema.syncRun.integrationId, integration.id),
          eq(schema.syncRun.purpose, 'notion_mirror'),
        ),
      );
    expect(after).toHaveLength(before.length + 1);
  });
});
