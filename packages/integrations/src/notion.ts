/**
 * `@docket/integrations` — the Notion connector provider client.
 *
 * @remarks
 * Notion is a **two-way** connector: it implements the read half of
 * {@link ConnectorProviderClient} (identity, container enumeration, import, link resolution)
 * *and* `pushTask`, so `RealConnector.asWritable()` discovers it structurally exactly as it does
 * Google Tasks. That is what lets Docket supersede Notion rather than merely mirror it — see
 * `docs/engineering/specs/notion-sync.md`.
 *
 * Notion's "database" is addressed through its **data sources** (API version 2026-03-11): a
 * database owns one or more data sources, and rows, schemas and page parents are all data-source
 * scoped. `ResourceRef.id` is therefore a data source id, stored per task as `externalListId`, so
 * a write-back always addresses the collection the row actually lives in.
 *
 * Every request building and response mapping path is pure and unit-tested through the injected
 * {@link ProviderHttp}; only the network call itself is the untestable IO edge. Property mapping
 * lives in `./notion-mapping` and takes no HTTP at all.
 */
import type {
  ExternalWriteResult,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
  TaskPushOp,
} from './connector';
import { NOTION_API_VERSION } from '@docket/connections/notion/protocol';
import { ConnectorError } from './connector-error';
import { asRecord, str } from './json';
import { MAX_IMPORT_PAGES, logConnectorTruncation } from './connector-log';
import {
  type NotionSchema,
  mapNotionPage,
  notionPageUrl,
  notionPlainText,
  notionPushProperties,
  readNotionSchema,
} from './notion-mapping';
import type {
  ConnectorProviderClient,
  ResolvedAccount,
  WritableConnectorProviderClient,
} from './provider-client';
import type { ProviderHttp } from './provider-http';

/** The public Notion API base. */
export const NOTION_API_BASE = 'https://api.notion.com/v1';

/** Rows requested per data-source query page (Notion's documented maximum). */
const NOTION_PAGE_SIZE = 100;

/** The header Notion requires on every request, including writes. */
const NOTION_HEADERS: Readonly<Record<string, string>> = {
  'Notion-Version': NOTION_API_VERSION,
};

/** The envelope every Notion list endpoint returns. */
interface NotionListPayload {
  results?: unknown[];
  has_more?: boolean;
  next_cursor?: string | null;
}

/**
 * Page through a Notion list endpoint via `next_cursor`, collecting every result.
 *
 * @remarks
 * Bounded by {@link MAX_IMPORT_PAGES}; a truncated pull logs a warning rather than silently
 * returning a partial set that looks complete (the "never report success when nothing happened"
 * invariant applied to reads).
 *
 * @param http - The provider HTTP wrapper.
 * @param resource - Label used in the truncation log.
 * @param request - Issues one page for a given cursor.
 */
async function pageThrough(
  resource: string,
  request: (cursor: string | undefined) => Promise<NotionListPayload>,
): Promise<unknown[]> {
  const collected: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_IMPORT_PAGES; page += 1) {
    const payload = await request(cursor);
    for (const result of payload.results ?? []) collected.push(result);
    if (payload.has_more !== true) return collected;
    const next = payload.next_cursor;
    if (typeof next !== 'string' || next.length === 0) return collected;
    cursor = next;
  }
  logConnectorTruncation({
    provider: 'notion',
    resource,
    fetched: collected.length,
    maxPages: MAX_IMPORT_PAGES,
  });
  return collected;
}

/** Read a Notion data source's display title out of its rich-text `title` array. */
function dataSourceTitle(payload: Record<string, unknown> | undefined): string {
  const title = notionPlainText(payload?.['title']);
  return title.length > 0 ? title : 'Untitled database';
}

/**
 * The Notion connector's provider client: two-way, data-source scoped.
 *
 * @remarks
 * Implements {@link WritableConnectorProviderClient} — the presence of `pushTask` is what
 * `isWritableProviderClient` detects, so nothing here is gated on a provider literal.
 */
export class NotionProviderClient implements WritableConnectorProviderClient {
  /** Per-instance schema cache: one `GET /data_sources/{id}` per data source per sync run. */
  private readonly schemas = new Map<string, NotionSchema>();

  /**
   * @param http - The injected Notion HTTP wrapper (base {@link NOTION_API_BASE}).
   */
  constructor(private readonly http: ProviderHttp) {}

  /**
   * {@inheritDoc ConnectorProviderClient.resolveAccount}
   *
   * @remarks
   * `GET /users/me` returns the bot the OAuth grant minted. Notion exposes the workspace's name
   * on the bot (`bot.workspace_name`) and its id on `bot.workspace_id`, which become the
   * connection's external workspace identifiers — that is how "this integration is bound to the
   * Las Vegans for Better Transit workspace" is recorded rather than assumed.
   */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const payload = asRecord(await this.http.getJson('/users/me', NOTION_HEADERS));
    if (payload === undefined) return undefined;
    const bot = asRecord(payload['bot']);
    const owner = asRecord(bot?.['owner']);
    const ownerUser = asRecord(owner?.['user']);
    const label =
      str(ownerUser, 'name') ??
      str(asRecord(ownerUser?.['person']), 'email') ??
      str(payload, 'name');
    const workspaceId = str(bot, 'workspace_id');
    const workspaceName = str(bot, 'workspace_name');
    return {
      ...(label !== undefined ? { label } : {}),
      ...(workspaceId !== undefined ? { externalWorkspaceId: workspaceId } : {}),
      ...(workspaceName !== undefined ? { externalWorkspaceName: workspaceName } : {}),
    };
  }

  /**
   * {@inheritDoc ConnectorProviderClient.listContainers}
   *
   * @remarks
   * Notion's `POST /search` with `filter.value = 'data_source'` returns every data source the
   * integration has been shared with — which is exactly the set of databases a person can pick
   * from in Docket's connection settings. Trashed data sources are excluded.
   */
  async listContainers(): Promise<ResourceRef[]> {
    const results = await pageThrough('data_sources', (cursor) =>
      this.http.postJson<NotionListPayload>(
        '/search',
        {
          filter: { property: 'object', value: 'data_source' },
          page_size: NOTION_PAGE_SIZE,
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        },
        'bearer',
        NOTION_HEADERS,
      ),
    );
    const refs: ResourceRef[] = [];
    for (const result of results) {
      const record = asRecord(result);
      const id = str(record, 'id');
      if (id === undefined) continue;
      if (record?.['in_trash'] === true) continue;
      refs.push({ id, title: dataSourceTitle(record) });
    }
    return refs;
  }

  /**
   * Load (and memoize) the derived {@link NotionSchema} for one data source.
   *
   * @param dataSourceId - The Notion data source id.
   * @throws {ConnectorError} When Notion returns a payload with no `properties` map — a data
   *   source with no schema cannot be mapped, and pretending otherwise would import blank tasks.
   */
  private async schemaFor(dataSourceId: string): Promise<NotionSchema> {
    const cached = this.schemas.get(dataSourceId);
    if (cached !== undefined) return cached;
    const payload = asRecord(
      await this.http.getJson(`/data_sources/${dataSourceId}`, NOTION_HEADERS),
    );
    const properties = asRecord(payload?.['properties']);
    if (properties === undefined) {
      throw new ConnectorError(`Notion data source ${dataSourceId} returned no property schema`, {
        provider: 'notion',
        kind: 'provider',
      });
    }
    const schema = readNotionSchema(dataSourceId, dataSourceTitle(payload), properties);
    this.schemas.set(dataSourceId, schema);
    return schema;
  }

  /**
   * Query one data source's rows, in both the live and archived partitions.
   *
   * @remarks
   * The archived pass is what makes a Notion deletion propagate: a trashed page is not returned
   * by the default query, so without it a deleted row would look merely "filtered out" and the
   * reconciler would (correctly, per its own rules) leave the Docket task alone forever.
   *
   * The two partitions are disjoint by definition, but the results are deduplicated by page id
   * with the LIVE copy winning anyway: if a page moved to the trash mid-pagination it would
   * otherwise appear in both passes, and letting the tombstone win there would archive a Docket
   * task on the strength of a race.
   *
   * @param dataSourceId - The data source to read.
   * @param since - RFC3339 cutoff; when given, both passes filter to `last_edited_time` at or
   *   after it — an omitted-property page (nothing changed) still needs the archived pass run
   *   without the filter's blind spot for a page trashed exactly at the boundary, so the filter is
   *   applied identically to both partitions rather than only the live one.
   */
  private async queryDataSource(dataSourceId: string, since?: string): Promise<unknown[]> {
    const filter =
      since === undefined
        ? {}
        : { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } } };
    const live = await pageThrough(`data_source:${dataSourceId}`, (cursor) =>
      this.http.postJson<NotionListPayload>(
        `/data_sources/${dataSourceId}/query`,
        {
          ...filter,
          page_size: NOTION_PAGE_SIZE,
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        },
        'bearer',
        NOTION_HEADERS,
      ),
    );
    const archived = await pageThrough(`data_source:${dataSourceId}:archived`, (cursor) =>
      this.http.postJson<NotionListPayload>(
        `/data_sources/${dataSourceId}/query`,
        {
          ...filter,
          // `in_trash` here is rejected with `body.in_trash should be not present`, failing the
          // whole request. That spelling belongs to page updates, used in `writeRow` below.
          is_archived: true,
          page_size: NOTION_PAGE_SIZE,
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        },
        'bearer',
        NOTION_HEADERS,
      ),
    );
    const byId = new Map<string, unknown>();
    for (const row of [...live, ...archived]) {
      const id = str(asRecord(row), 'id');
      if (id === undefined || byId.has(id)) continue;
      byId.set(id, row);
    }
    return [...byId.values()];
  }

  /**
   * {@inheritDoc ConnectorProviderClient.importWork}
   *
   * @remarks
   * `input.listIds` selects which Notion databases to sync; absent/empty means every data source
   * shared with the integration, matching every other container-aware connector. `input.since`,
   * when the caller supplies it, filters both the live and archived queries to pages Notion
   * reports edited at or after it — otherwise every sweep re-reads every row in every selected
   * database from scratch.
   */
  async importWork(input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const selected =
      input.listIds && input.listIds.length > 0
        ? input.listIds
        : (await this.listContainers()).map((ref) => ref.id);

    const items: ImportedItem[] = [];
    for (const dataSourceId of selected) {
      const schema = await this.schemaFor(dataSourceId);
      for (const row of await this.queryDataSource(dataSourceId, input.since)) {
        const record = asRecord(row);
        if (record === undefined) continue;
        const item = mapNotionPage(record, schema, importedAt);
        if (item !== undefined) items.push(item);
      }
    }
    return items;
  }

  /**
   * {@inheritDoc ConnectorProviderClient.mirrorStatus}
   *
   * @remarks
   * Reports the number of data sources the integration can currently reach. It never reports
   * `idle` without having asked Notion — an unreachable workspace throws a
   * {@link ConnectorError} from the underlying call rather than returning a healthy-looking zero.
   */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const containers = await this.listContainers();
    return { connectionId: input.connectionId, status: 'idle', itemCount: containers.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    return notionPageUrl(input.externalId);
  }

  /**
   * {@inheritDoc WritableConnectorProviderClient.pushTask}
   *
   * @remarks
   * `listId` is the data source id the page lives in. Notion has no entity tag, so the returned
   * anchor carries only `externalUpdatedAt` (`last_edited_time`) — which is the value the
   * reconciler writes back onto the task so the very next pull is a no-op instead of an echo.
   *
   * A `delete` is Notion's own soft delete (`in_trash: true`); Notion has no hard delete over the
   * API, and destroying a page would violate the migration-safety rule that a sync never
   * destroys data at either end.
   */
  async pushTask(op: TaskPushOp): Promise<ExternalWriteResult | undefined> {
    if (op.kind === 'delete') {
      await this.http.patchJson(`/pages/${op.externalId}`, { in_trash: true }, NOTION_HEADERS);
      return undefined;
    }

    const schema = await this.schemaFor(op.listId);
    const properties = notionPushProperties(op, schema);

    const payload = asRecord(
      op.kind === 'create'
        ? await this.http.postJson(
            '/pages',
            {
              parent: { type: 'data_source_id', data_source_id: op.listId },
              properties,
            },
            'bearer',
            NOTION_HEADERS,
          )
        : await this.http.patchJson(`/pages/${op.externalId}`, { properties }, NOTION_HEADERS),
    );

    const externalId = str(payload, 'id');
    const externalUpdatedAt = str(payload, 'last_edited_time');
    if (externalId === undefined || externalUpdatedAt === undefined) {
      throw new ConnectorError('Notion accepted the write but returned no page anchor', {
        provider: 'notion',
        kind: 'provider',
      });
    }
    return { externalId, externalUpdatedAt };
  }
}

/** Narrow a client to the Notion one (used by the connector's structural capability tests). */
export function isNotionProviderClient(
  client: ConnectorProviderClient,
): client is NotionProviderClient {
  return client instanceof NotionProviderClient;
}
