/** The official-SDK implementation of the designed Notion mirror port. */
import {
  APIErrorCode,
  Client,
  collectPaginatedAPI,
  isFullBlock,
  isFullDatabase,
  isFullPage,
  isNotionClientError,
  type CreateDatabaseParameters,
  type CreateDatabaseResponse,
  type CreatePageParameters,
  type DataSourceObjectResponse,
  type PartialDataSourceObjectResponse,
  type QueryDataSourceResponse,
  type QueryDataSourceParameters,
  type UpdateDataSourceParameters,
} from '@notionhq/client';

import { NOTION_API_VERSION } from '../api-contract';
import { ProviderError } from '../../provider-error';
import type {
  MirrorChange,
  MirrorDatabaseSpec,
  MirrorDatabaseBindings,
  MirrorExternalPerson,
  MirrorParentPage,
  MirrorParentPageList,
  MirrorParentPageQuery,
  MirrorRowOp,
  MirrorRowResult,
  NotionMirrorPort,
  ProvisionedMirrorDatabase,
} from '../mirror-port';

import { databaseSchema, readDocketIdPropertyId, readPropertyIds } from './notion-sdk-schema';
import { fullPages, toMirrorChange, toParentPage } from './notion-sdk-pages';

/** Notion's documented page-size ceiling for list endpoints. */
const NOTION_PAGE_SIZE = 100;

/** The exact description text used to prove Docket ownership. */
function ownershipDescription(ownershipKey: string): string {
  return `Docket ownership: ${ownershipKey}`;
}

/** Translate an SDK error into the connection domain's stable provider-error contract. */
function asProviderError(err: unknown, context: string): ProviderError<'notion'> {
  if (isNotionClientError(err) && 'code' in err) {
    const kind =
      err.code === APIErrorCode.Unauthorized || err.code === APIErrorCode.RestrictedResource
        ? 'auth'
        : err.code === APIErrorCode.RateLimited
          ? 'rate_limit'
          : 'provider';
    return new ProviderError(`Notion ${context} failed (${err.code})`, {
      provider: 'notion',
      kind,
      // Carried so callers can tell "this id is gone" apart from every other `provider` failure.
      // The two want opposite handling: a transient fault should be retried against the same id,
      // while a deleted object makes every future request naming it fail the same way.
      ...(err.code === APIErrorCode.ObjectNotFound ? { status: 404 } : {}),
    });
  }
  return new ProviderError(`Notion ${context} failed`, { provider: 'notion', kind: 'network' });
}

/** Pull the first data-source id from a response that may omit it. */
function firstDataSourceId(created: CreateDatabaseResponse): string | undefined {
  const sources = 'data_sources' in created ? created.data_sources : undefined;
  return sources?.[0]?.id;
}

/** Read a URL from a response that may be a partial SDK object. */
function hasUrl(value: unknown): value is { url: string } {
  return typeof (value as { url?: unknown } | null)?.url === 'string';
}

/** Read a data source's property map from a full or partial SDK response. */
function propertiesOf(
  value: DataSourceObjectResponse | PartialDataSourceObjectResponse | object,
): Record<string, { id?: string }> {
  const properties = (value as { properties?: unknown }).properties;
  return typeof properties === 'object' && properties !== null
    ? (properties as Record<string, { id?: string }>)
    : {};
}

/**
 * The Notion mirror's I/O edge.
 *
 * @remarks
 * This adapter owns SDK calls and error translation only. The port keeps reconciliation rules and
 * provider-neutral values reusable by the browser, the API, and a future desktop client.
 */
export class NotionMirrorClient implements NotionMirrorPort {
  private readonly notion: Client;

  /**
   * @param auth - OAuth access token for the connected workspace.
   * @param fetchImpl - Optional fetch override so tests can exercise SDK requests without a network.
   */
  constructor(auth: string, fetchImpl?: typeof fetch) {
    this.notion = new Client({
      auth,
      notionVersion: NOTION_API_VERSION,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  /** Resolve Docket's own bot id for the echo guard. */
  async botId(): Promise<string> {
    try {
      const me = await this.notion.users.me({});
      return me.id;
    } catch (error) {
      throw asProviderError(error, 'identity lookup');
    }
  }

  /** List one narrowed, provider-ordered page of possible database parents. */
  async listParentPages(options: MirrorParentPageQuery = {}): Promise<MirrorParentPageList> {
    const query = options.query?.trim() ?? '';
    try {
      const response = await this.notion.search({
        ...(query.length > 0 ? { query } : {}),
        filter: { property: 'object', value: 'page' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: Math.min(options.limit ?? NOTION_PAGE_SIZE, NOTION_PAGE_SIZE),
        ...(options.cursor !== undefined ? { start_cursor: options.cursor } : {}),
      });
      return {
        items: fullPages(response.results).map(toParentPage),
        nextCursor: response.next_cursor,
      };
    } catch (error) {
      throw asProviderError(error, 'page listing');
    }
  }

  /** Describe one parent page so the server records canonical metadata. */
  async describePage(pageId: string): Promise<MirrorParentPage> {
    try {
      const page = await this.notion.pages.retrieve({ page_id: pageId });
      const full = fullPages([page])[0];
      return full ? toParentPage(full) : { id: pageId, title: 'Untitled' };
    } catch (error) {
      throw asProviderError(error, 'page lookup');
    }
  }

  /** List workspace people while excluding integration bots. */
  async listWorkspaceUsers(): Promise<MirrorExternalPerson[]> {
    try {
      const results = await collectPaginatedAPI(this.notion.users.list, {
        page_size: NOTION_PAGE_SIZE,
      });
      const people: MirrorExternalPerson[] = [];
      for (const user of results) {
        if (user.type !== 'person') continue;
        const { email } = user.person;
        people.push({
          externalId: user.id,
          name: user.name ?? 'Unnamed',
          ...(email !== undefined ? { email } : {}),
          ...(user.avatar_url !== null ? { avatarUrl: user.avatar_url } : {}),
        });
      }
      return people;
    } catch (error) {
      throw asProviderError(error, 'people listing');
    }
  }

  /** Create a database and its initial data source under the chosen page. */
  async provisionDatabase(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase> {
    let created: CreateDatabaseResponse;
    try {
      const parameters: CreateDatabaseParameters = {
        parent: { type: 'page_id', page_id: spec.parentPageId },
        title: [{ type: 'text', text: { content: spec.title } }],
        description: [{ type: 'text', text: { content: ownershipDescription(spec.ownershipKey) } }],
        initial_data_source: { properties: databaseSchema(spec.columns) },
      };
      created = await this.notion.databases.create(parameters);
    } catch (error) {
      throw asProviderError(error, `database creation for "${spec.title}"`);
    }

    const dataSourceId = firstDataSourceId(created);
    if (dataSourceId === undefined) {
      throw new ProviderError(
        `Notion created database "${spec.title}" but returned no data source`,
        {
          provider: 'notion',
          kind: 'provider',
        },
      );
    }

    const dataSource = await this.retrieveDataSource(dataSourceId);
    return {
      externalDatabaseId: created.id,
      externalDataSourceId: dataSourceId,
      ...(hasUrl(created) ? { url: created.url } : {}),
      propertyIds: readPropertyIds(spec.columns, dataSource.properties),
      docketIdPropertyId: readDocketIdPropertyId(dataSource.properties),
    };
  }

  /** Find databases under the selected parent carrying the exact Docket ownership marker. */
  async findDatabasesByOwnershipKey(
    spec: MirrorDatabaseSpec,
  ): Promise<ProvisionedMirrorDatabase[]> {
    try {
      const children = await collectPaginatedAPI(this.notion.blocks.children.list, {
        block_id: spec.parentPageId,
        page_size: NOTION_PAGE_SIZE,
      });
      const databaseIds = children.flatMap((child) =>
        isFullBlock(child) && child.type === 'child_database' ? [child.id] : [],
      );
      const databases = await Promise.all(
        databaseIds.map((databaseId) =>
          this.notion.databases.retrieve({ database_id: databaseId }),
        ),
      );
      const matches: ProvisionedMirrorDatabase[] = [];
      for (const database of databases) {
        if (!isFullDatabase(database)) continue;
        const description = database.description.map((item) => item.plain_text).join('');
        if (description !== ownershipDescription(spec.ownershipKey)) continue;
        const dataSourceId = database.data_sources[0]?.id;
        if (dataSourceId === undefined) {
          throw new ProviderError('Docket-owned Notion database has no data source', {
            provider: 'notion',
            kind: 'provider',
          });
        }
        const dataSource = await this.retrieveDataSource(dataSourceId);
        matches.push({
          externalDatabaseId: database.id,
          externalDataSourceId: dataSourceId,
          url: database.url,
          propertyIds: readPropertyIds(spec.columns, dataSource.properties),
          docketIdPropertyId: readDocketIdPropertyId(dataSource.properties),
        });
      }
      return matches;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw asProviderError(error, `owned database lookup for "${spec.title}"`);
    }
  }

  /** Bring a provisioned data source's schema up to the current design without removing columns. */
  async updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<MirrorDatabaseBindings> {
    try {
      const parameters: UpdateDataSourceParameters = {
        data_source_id: dataSourceId,
        title: [{ type: 'text', text: { content: spec.title } }],
        properties: databaseSchema(spec.columns),
      };
      const updated = await this.notion.dataSources.update(parameters);
      const properties = propertiesOf(updated);
      return {
        propertyIds: readPropertyIds(spec.columns, properties),
        docketIdPropertyId: readDocketIdPropertyId(properties),
      };
    } catch (error) {
      throw asProviderError(error, `schema update for "${spec.title}"`);
    }
  }

  /** Retrieve a data source only for the property ids it assigned. */
  private async retrieveDataSource(
    dataSourceId: string,
  ): Promise<{ properties: Record<string, { id?: string }> }> {
    try {
      const source = await this.notion.dataSources.retrieve({ data_source_id: dataSourceId });
      return { properties: propertiesOf(source) };
    } catch (error) {
      throw asProviderError(error, 'data source lookup');
    }
  }

  /** Apply one row write; deletes are Notion's recoverable soft delete. */
  async writeRow(op: MirrorRowOp): Promise<MirrorRowResult | undefined> {
    try {
      if (op.kind === 'delete') {
        if (op.externalPageId === undefined) return undefined;
        await this.notion.pages.update({ page_id: op.externalPageId, in_trash: true });
        return undefined;
      }

      const properties = op.properties ?? {};
      const page =
        op.kind === 'create'
          ? await this.createPage(op, properties)
          : await this.updatePage(op.externalPageId, properties as never);
      if (!isFullPage(page)) {
        throw new ProviderError('Notion accepted the write but returned no page anchor', {
          provider: 'notion',
          kind: 'provider',
        });
      }
      return { externalPageId: page.id, externalUpdatedAt: page.last_edited_time };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw asProviderError(error, `row ${op.kind}`);
    }
  }

  /** Create a page with its durable Docket id in the same provider write. */
  private createPage(op: MirrorRowOp, properties: Record<string, unknown>) {
    if (op.docketId === undefined || op.docketIdPropertyId === undefined) {
      throw new ProviderError('Notion create requested with no Docket ID anchor', {
        provider: 'notion',
        kind: 'provider',
      });
    }
    const parameters: CreatePageParameters = {
      parent: { type: 'data_source_id', data_source_id: op.dataSourceId },
      properties: {
        ...properties,
        [op.docketIdPropertyId]: {
          type: 'rich_text',
          rich_text: [{ type: 'text', text: { content: op.docketId } }],
        },
      } as NonNullable<CreatePageParameters['properties']>,
    };
    return this.notion.pages.create(parameters);
  }

  /** Find exact page anchors for one Docket id. */
  async findRowsByDocketId(
    dataSourceId: string,
    docketIdPropertyId: string,
    docketId: string,
  ): Promise<MirrorRowResult[]> {
    try {
      const parameters: QueryDataSourceParameters = {
        data_source_id: dataSourceId,
        filter: { property: docketIdPropertyId, rich_text: { equals: docketId } },
        page_size: 2,
        result_type: 'page',
      };
      const response = await this.notion.dataSources.query(parameters);
      return fullPages(response.results).map((page) => ({
        externalPageId: page.id,
        externalUpdatedAt: page.last_edited_time,
      }));
    } catch (error) {
      throw asProviderError(error, 'Docket ID lookup');
    }
  }

  /** Validate an update anchor before handing it to Notion. */
  private updatePage(pageId: string | undefined, properties: never) {
    if (pageId === undefined) {
      throw new ProviderError('Notion update requested with no page id', {
        provider: 'notion',
        kind: 'provider',
      });
    }
    return this.notion.pages.update({ page_id: pageId, properties });
  }

  /**
   * Read live and trashed pages, letting a live copy win if a page races between partitions.
   *
   * @remarks
   * Issued through `request` rather than `dataSources.query`. The typed method accepts only the
   * body params the SDK knows — `archived` and `in_trash` — and drops anything else with a console
   * warning. The live API rejects `in_trash` (`body.in_trash should be not present`) and documents
   * `is_archived`, so the typed method cannot express the archived read at all: it would strip the
   * parameter and return the live rows a second time, hiding every Notion deletion.
   */
  async queryChanges(dataSourceId: string, since?: string): Promise<MirrorChange[]> {
    const filter =
      since === undefined
        ? undefined
        : ({ timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } } as const);
    const read = async (archived: boolean): Promise<MirrorChange[]> => {
      const pages: QueryDataSourceResponse['results'] = [];
      let cursor: string | undefined;
      do {
        const page = await this.notion.request<QueryDataSourceResponse>({
          path: `data_sources/${dataSourceId}/query`,
          method: 'post',
          body: {
            page_size: NOTION_PAGE_SIZE,
            ...(filter ? { filter } : {}),
            ...(archived ? { is_archived: true } : {}),
            ...(cursor !== undefined ? { start_cursor: cursor } : {}),
          },
        });
        pages.push(...page.results);
        cursor = page.next_cursor ?? undefined;
      } while (cursor !== undefined);
      return fullPages(pages).map((page) => toMirrorChange(page, archived));
    };

    try {
      const live = await read(false);
      const trashed = await read(true);
      const byId = new Map<string, MirrorChange>();
      for (const change of live) byId.set(change.externalPageId, change);
      for (const change of trashed) {
        if (!byId.has(change.externalPageId)) byId.set(change.externalPageId, change);
      }
      return [...byId.values()];
    } catch (error) {
      throw asProviderError(error, 'change query');
    }
  }
}
