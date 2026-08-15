/**
 * In-memory behavioral adapter for Docket's Notion mirror.
 *
 * @remarks
 * Local and test runs use this adapter to exercise provisioning, projection, pull-back, and
 * tombstones without a Notion workspace. It intentionally models state transitions, not SDK
 * request shapes, because the mirror port is the stable boundary callers depend on.
 */
import type {
  MirrorChange,
  MirrorDatabaseSpec,
  MirrorExternalPerson,
  MirrorParentPage,
  MirrorParentPageList,
  MirrorParentPageQuery,
  MirrorRowOp,
  MirrorRowResult,
  NotionMirrorPort,
  ProvisionedMirrorDatabase,
} from '../mirror-port';
import { ProviderError } from '../../provider-error';

/** One page held by the mock. */
interface MockPage {
  id: string;
  dataSourceId: string;
  properties: Record<string, unknown>;
  lastEditedTime: string;
  lastEditedBy: string;
  inTrash: boolean;
}

/** Configuration for {@link MockNotionMirror}. */
export interface MockNotionMirrorConfig {
  /** The bot id the mock reports as its own identity. */
  readonly botId?: string;
  /** Pages offered as database parents. */
  readonly parentPages?: readonly MirrorParentPage[];
  /** The people the workspace contains. */
  readonly people?: readonly MirrorExternalPerson[];
}

/** A representative local workspace, including deliberately ambiguous page names. */
const DEFAULT_PAGES: readonly MirrorParentPage[] = [
  {
    id: 'mock_page_workspace',
    title: 'Team wiki',
    url: 'https://www.notion.so/mock-page-workspace',
    icon: '📚',
    lastEditedTime: '2025-12-30T09:00:00.000Z',
    parentKind: 'workspace',
  },
  {
    id: 'mock_page_projects',
    title: 'Projects',
    url: 'https://www.notion.so/mock-page-projects',
    lastEditedTime: '2025-12-28T09:00:00.000Z',
    parentKind: 'workspace',
  },
  {
    id: 'mock_page_projects_archive',
    title: 'Projects',
    url: 'https://www.notion.so/mock-page-projects-archive',
    lastEditedTime: '2025-11-02T09:00:00.000Z',
    parentKind: 'page',
  },
  {
    id: 'mock_page_handbook',
    title: 'Engineering handbook',
    url: 'https://www.notion.so/mock-page-handbook',
    icon: '🛠️',
    lastEditedTime: '2025-10-14T09:00:00.000Z',
    parentKind: 'page',
  },
];

/** How many fixture pages the mock returns when the caller does not say. */
const MOCK_PAGE_SIZE = 25;

/** A workspace population with matchable, unmatched, and email-less people. */
const DEFAULT_PEOPLE: readonly MirrorExternalPerson[] = [
  { externalId: 'mock_user_1', name: 'Dana Whitfield', email: 'dana@example.com' },
  { externalId: 'mock_user_2', name: 'Sam Ortega', email: 'sam@example.com' },
  { externalId: 'mock_user_3', name: 'Priya Raman' },
];

/** An in-memory Notion workspace. */
export class MockNotionMirror implements NotionMirrorPort {
  private readonly pages = new Map<string, MockPage>();
  private readonly schemas = new Map<string, Record<string, string>>();
  private readonly bot: string;
  private readonly parents: readonly MirrorParentPage[];
  private readonly workspacePeople: readonly MirrorExternalPerson[];
  private sequence = 0;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');

  /** @param config - Optional fixture overrides. */
  constructor(config: MockNotionMirrorConfig = {}) {
    this.bot = config.botId ?? 'mock_bot_docket';
    this.parents = config.parentPages ?? DEFAULT_PAGES;
    this.workspacePeople = config.people ?? DEFAULT_PEOPLE;
  }

  /** Advance a monotonic fake clock so sequential writes always have distinct anchors. */
  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  /** Simulate somebody editing a page in Notion, so drift and conflicts can be provoked. */
  editAsPerson(pageId: string, properties: Record<string, unknown> = {}): void {
    const page = this.pages.get(pageId);
    if (page === undefined) return;
    page.properties = { ...page.properties, ...properties };
    page.lastEditedTime = this.tick();
    page.lastEditedBy = 'mock_user_1';
  }

  /** Simulate somebody trashing a page in Notion. */
  trashAsPerson(pageId: string): void {
    const page = this.pages.get(pageId);
    if (page === undefined) return;
    page.inTrash = true;
    page.lastEditedTime = this.tick();
    page.lastEditedBy = 'mock_user_1';
  }

  /** Every page the mock holds, for assertions. */
  snapshot(): readonly MockPage[] {
    return [...this.pages.values()];
  }

  /** {@inheritDoc NotionMirrorPort.botId} */
  botId(): Promise<string> {
    return Promise.resolve(this.bot);
  }

  /** {@inheritDoc NotionMirrorPort.listParentPages} */
  listParentPages(options: MirrorParentPageQuery = {}): Promise<MirrorParentPageList> {
    const query = options.query?.trim().toLowerCase() ?? '';
    const matched =
      query.length === 0
        ? this.parents
        : this.parents.filter((page) => page.title.toLowerCase().includes(query));
    const from = Math.max(0, Number.parseInt(options.cursor ?? '', 10) || 0);
    const limit = options.limit ?? MOCK_PAGE_SIZE;
    const items = matched.slice(from, from + limit);
    const end = from + items.length;
    return Promise.resolve({
      items,
      nextCursor: end < matched.length ? String(end) : null,
    });
  }

  /** {@inheritDoc NotionMirrorPort.describePage} */
  describePage(pageId: string): Promise<MirrorParentPage> {
    const found = this.parents.find((page) => page.id === pageId);
    return Promise.resolve(found ?? { id: pageId, title: 'Untitled' });
  }

  /** {@inheritDoc NotionMirrorPort.listWorkspaceUsers} */
  listWorkspaceUsers(): Promise<MirrorExternalPerson[]> {
    return Promise.resolve([...this.workspacePeople]);
  }

  /** {@inheritDoc NotionMirrorPort.provisionDatabase} */
  provisionDatabase(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase> {
    this.sequence += 1;
    const suffix = String(this.sequence);
    const dataSourceId = `mock_ds_${suffix}`;
    const propertyIds: Record<string, string> = {};
    for (const column of spec.columns) {
      propertyIds[column.field] = `mock_prop_${suffix}_${column.field}`;
    }
    this.schemas.set(dataSourceId, propertyIds);
    return Promise.resolve({
      externalDatabaseId: `mock_db_${suffix}`,
      externalDataSourceId: dataSourceId,
      url: `https://notion.example/mock_db_${suffix}`,
      propertyIds,
    });
  }

  /**
   * Forget a data source, as deleting its database in Notion would.
   *
   * @remarks
   * Exists because this is a state the mirror has to survive and could not previously be
   * reproduced: a database Docket created and recorded, removed by a human in Notion afterwards.
   * Every subsequent request naming it answers `object_not_found`.
   *
   * @param dataSourceId - The data source to remove.
   */
  deleteDataSource(dataSourceId: string): void {
    this.schemas.delete(dataSourceId);
    for (const [id, page] of this.pages) {
      if (page.dataSourceId === dataSourceId) this.pages.delete(id);
    }
  }

  /**
   * {@inheritDoc NotionMirrorPort.updateDatabaseSchema}
   *
   * @remarks
   * Refuses an unknown data source rather than inventing one. This mock used to accept any id and
   * quietly mint a schema for it, which made a deleted database indistinguishable from a live one
   * — so the whole provision → project flow passed locally and in E2E while production answered
   * `object_not_found` and failed every run.
   */
  updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<Record<string, string>> {
    const existing = this.schemas.get(dataSourceId);
    if (existing === undefined) {
      return Promise.reject(
        new ProviderError(`Notion schema update for "${spec.title}" failed (object_not_found)`, {
          provider: 'notion',
          kind: 'provider',
          status: 404,
        }),
      );
    }
    const next: Record<string, string> = {};
    for (const column of spec.columns) {
      next[column.field] = existing[column.field] ?? `mock_prop_${dataSourceId}_${column.field}`;
    }
    this.schemas.set(dataSourceId, next);
    return Promise.resolve(next);
  }

  /** {@inheritDoc NotionMirrorPort.writeRow} */
  writeRow(op: MirrorRowOp): Promise<MirrorRowResult | undefined> {
    if (op.kind === 'delete') {
      if (op.externalPageId !== undefined) {
        const page = this.pages.get(op.externalPageId);
        if (page !== undefined) {
          page.inTrash = true;
          page.lastEditedTime = this.tick();
          page.lastEditedBy = this.bot;
        }
      }
      return Promise.resolve(undefined);
    }

    const properties = op.properties ?? {};
    if (op.kind === 'create') {
      this.sequence += 1;
      const id = `mock_pg_${String(this.sequence)}`;
      const lastEditedTime = this.tick();
      this.pages.set(id, {
        id,
        dataSourceId: op.dataSourceId,
        properties,
        lastEditedTime,
        lastEditedBy: this.bot,
        inTrash: false,
      });
      return Promise.resolve({ externalPageId: id, externalUpdatedAt: lastEditedTime });
    }

    const pageId = op.externalPageId;
    if (pageId === undefined) return Promise.reject(new Error('update with no page id'));
    const page = this.pages.get(pageId);
    if (page === undefined) return Promise.reject(new Error(`unknown page ${pageId}`));
    page.properties = { ...page.properties, ...properties };
    page.inTrash = false;
    page.lastEditedTime = this.tick();
    page.lastEditedBy = this.bot;
    return Promise.resolve({ externalPageId: pageId, externalUpdatedAt: page.lastEditedTime });
  }

  /** {@inheritDoc NotionMirrorPort.queryChanges} */
  queryChanges(dataSourceId: string, since?: string): Promise<MirrorChange[]> {
    const cutoff = since === undefined ? undefined : Date.parse(since);
    const changes: MirrorChange[] = [];
    for (const page of this.pages.values()) {
      if (page.dataSourceId !== dataSourceId) continue;
      if (cutoff !== undefined && Date.parse(page.lastEditedTime) < cutoff) continue;
      changes.push({
        externalPageId: page.id,
        externalUpdatedAt: page.lastEditedTime,
        archived: page.inTrash,
        properties: page.properties,
        lastEditedBy: page.lastEditedBy,
      });
    }
    return Promise.resolve(changes);
  }
}
