/**
 * `@docket/integrations` — an in-memory stand-in for the Notion mirror's provider edge.
 *
 * @remarks
 * Exists for the repo's zero-external-accounts rule: the whole provision → project → pull-back
 * flow has to be runnable on a laptop with no Notion workspace, no OAuth app, and no network.
 * Selected by the container in `local`/`test` mode, exactly as {@link MockConnector} is.
 *
 * It is a **behavioural** mock, not a stub that returns empty arrays. Pages are stored, updated,
 * and trashed; `last_edited_time` advances on every write; `queryChanges` honours its `since`
 * cutoff and reports both partitions. That is what lets the reconciler's real failure modes — the
 * echo loop, drift on a projection-only entity, a tombstone racing a live read — actually be
 * provoked locally instead of only reasoned about.
 *
 * The one thing it deliberately does not imitate is Notion's rate limit; pacing is the caller's
 * concern and slowing tests down to prove it would only make them flaky.
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
} from './notion-mirror';

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

/**
 * The default fixture workspace: four shareable pages and three humans, no bots.
 *
 * @remarks
 * Two of the pages are called "Projects" on purpose. A real workspace is full of same-named pages,
 * and a picker that shows nothing but a title makes them indistinguishable — so the fixture that
 * every local run and every test sees contains the collision the UI has to survive.
 *
 * Ordered most-recently-edited first, matching the ordering the real client asks Notion for.
 */
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

/** How many fixture pages the mock returns per call when the caller does not say. */
const MOCK_PAGE_SIZE = 25;

/**
 * Deliberately mixed: one person Docket will match by email, one it will not, and one guest with
 * no email at all — the three cases the people surface has to distinguish.
 */
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

  /**
   * @param config - Optional fixture overrides.
   */
  constructor(config: MockNotionMirrorConfig = {}) {
    this.bot = config.botId ?? 'mock_bot_docket';
    this.parents = config.parentPages ?? DEFAULT_PAGES;
    this.workspacePeople = config.people ?? DEFAULT_PEOPLE;
  }

  /**
   * Advance the mock's clock and return the new timestamp.
   *
   * @remarks
   * A monotonic fake clock rather than `Date.now()`: two writes inside the same millisecond would
   * otherwise share a `last_edited_time`, and the echo guard turns on a strict `>` comparison, so
   * real-time collisions would make tests pass or fail by scheduling luck.
   */
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

  /**
   * {@inheritDoc NotionMirrorPort.listParentPages}
   *
   * @remarks
   * Behavioural like the rest of this mock: the title query and the cursor are actually applied,
   * because a mock that ignores them would let a picker ship having only ever been exercised
   * against its whole fixture at once — which is the exact bug being fixed.
   */
  listParentPages(options: MirrorParentPageQuery = {}): Promise<MirrorParentPageList> {
    const query = options.query?.trim().toLowerCase() ?? '';
    const matched =
      query.length === 0
        ? this.parents
        : this.parents.filter((page) => page.title.toLowerCase().includes(query));
    // The cursor is the index of the first unreturned row, stringified — opaque to the caller,
    // exactly as Notion's is. `parseInt` yields NaN, never Infinity, so `|| 0` covers both a
    // missing cursor and a malformed one.
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
    for (const column of spec.columns)
      propertyIds[column.field] = `mock_prop_${suffix}_${column.field}`;
    this.schemas.set(dataSourceId, propertyIds);
    return Promise.resolve({
      externalDatabaseId: `mock_db_${suffix}`,
      externalDataSourceId: dataSourceId,
      url: `https://notion.example/mock_db_${suffix}`,
      propertyIds,
    });
  }

  /** {@inheritDoc NotionMirrorPort.updateDatabaseSchema} */
  updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<Record<string, string>> {
    const existing = this.schemas.get(dataSourceId) ?? {};
    const next: Record<string, string> = {};
    for (const column of spec.columns) {
      // Keep the id a provisioned column already has: a rename must not re-bind it, which is the
      // invariant the whole property-id design rests on.
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
    // An update revives a trashed page, matching Notion: writing to a trashed page restores it.
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
