/**
 * `@docket/api` test support — an in-memory Notion mirror port that records every call.
 *
 * @remarks
 * The provider edge is recorded in memory while persistence uses the migrated test database, so
 * mirror orchestration tests stay network-free without mocking away tenant scoping, row anchors,
 * or conflict records.
 */
import { eq } from 'drizzle-orm';

import { MIRROR_ENTITY_ORDER } from '@docket/connections/notion/mirror-schema';
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
  NotionPageContent,
  ProvisionedMirrorDatabase,
} from '@docket/connections/notion/mirror-port';
import { ProviderError } from '@docket/connections/provider-error';
import type { MirrorReferences } from '@docket/connections/notion/mirror-values';

import { ensureDesigns, type MirrorDatabaseRow } from '../../src/routes/notion-mirror-design';
import type { MirrorContext } from '../../src/routes/notion-mirror-reconcile';
import { getDb, one, seedBaseOrg } from './routes-harness';

/**
 * A pass that knows nothing: nobody matched, and no entity projected yet.
 *
 * @remarks
 * The default for cases that are not about references. Every entity carries an entry so a missing
 * page reads as "not written yet" (deferred) rather than "will never exist" — the state a first
 * pass is genuinely in.
 */
export const NO_PAGES: MirrorReferences = {
  notionUserByActor: new Map<string, string>(),
  pages: new Map(
    MIRROR_ENTITY_ORDER.map((entity) => [
      entity,
      { pageByEntityId: new Map<string, string>(), settled: false },
    ]),
  ),
};

/** One page body write the mirror received. */
export interface PageContentWrite {
  readonly pageId: string;
  readonly markdown: string;
}

/** A Notion mirror port that records writes and answers from in-memory state. */
export class RecordingMirror implements NotionMirrorPort {
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
  readonly pageContentWrites: PageContentWrite[] = [];
  readonly pageContents = new Map<string, string>();
  /** Pages whose Markdown read Notion truncates. */
  readonly truncatedPages = new Set<string>();
  /** Data sources deleted at the provider, which answer `object_not_found` from then on. */
  readonly missingDataSources = new Set<string>();
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
    this.ownedDatabases.set(spec.entityType, [provisioned]);
    if (this.failProvisionAfterCreate) {
      return Promise.reject(new Error('connection lost after Notion created the database'));
    }
    return Promise.resolve(provisioned);
  }

  findProvisionedDatabases(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase[]> {
    return Promise.resolve(this.ownedDatabases.get(spec.entityType) ?? []);
  }

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

  /** Pages whose body Docket read, in order. */
  readonly pageContentReads: string[] = [];

  /** Pages whose body the connection may not read, as without Notion's content capability. */
  readonly unreadablePages = new Set<string>();

  readPageContent(pageId: string): Promise<NotionPageContent> {
    this.pageContentReads.push(pageId);
    if (this.unreadablePages.has(pageId)) {
      return Promise.reject(
        new ProviderError('Notion page-content read failed (restricted_resource)', {
          provider: 'notion',
          kind: 'auth',
          status: 403,
        }),
      );
    }
    if (this.truncatedPages.has(pageId)) {
      return Promise.resolve({ markdown: 'partial', state: 'truncated', unknownBlockIds: ['b1'] });
    }
    return Promise.resolve({
      markdown: this.pageContents.get(pageId) ?? '',
      state: 'complete',
      unknownBlockIds: [],
    });
  }

  /** Pages whose content Notion refuses to replace, as it does for a page holding sub-pages. */
  readonly refusedPages = new Set<string>();

  writePageContent(pageId: string, markdown: string): Promise<NotionPageContent> {
    if (this.refusedPages.has(pageId)) {
      return Promise.reject(
        new ProviderError('Notion page-content update failed (validation_error)', {
          provider: 'notion',
          kind: 'provider',
          status: 400,
        }),
      );
    }
    this.pageContentWrites.push({ pageId, markdown });
    this.pageContents.set(pageId, markdown);
    return Promise.resolve({ markdown, state: 'complete', unknownBlockIds: [] });
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

/** Seed an org with a connected Notion integration, its default designs, and a recording mirror. */
export async function seedMirror() {
  const schema = await getDb();
  const base = await seedBaseOrg(schema.db, schema);
  const integration = one(
    await schema.db
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

/**
 * Find one entity's seeded design.
 *
 * @throws When the entity has no design.
 */
export function findDesign(
  designs: readonly MirrorDatabaseRow[],
  entity: MirrorDatabaseRow['entityType'],
): MirrorDatabaseRow {
  const design = designs.find((candidate) => candidate.entityType === entity);
  if (!design) throw new Error(`${entity} design was not seeded`);
  return design;
}

/** Give a seeded design a Notion data source and return it as stored. */
export async function designWithDataSource(
  designs: readonly MirrorDatabaseRow[],
  entity: MirrorDatabaseRow['entityType'],
): Promise<MirrorDatabaseRow> {
  const { db, notionMirrorDatabase } = await getDb();
  const seeded = findDesign(designs, entity);
  await db
    .update(notionMirrorDatabase)
    .set({ externalDataSourceId: `ds-${entity}` })
    .where(eq(notionMirrorDatabase.id, seeded.id));
  return one(
    await db.select().from(notionMirrorDatabase).where(eq(notionMirrorDatabase.id, seeded.id)),
  );
}
