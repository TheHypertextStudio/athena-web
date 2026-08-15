/** The official-SDK implementation of the designed Notion mirror port. */
import {
  APIErrorCode,
  Client,
  collectPaginatedAPI,
  isFullPage,
  isNotionClientError,
  type CreateDatabaseResponse,
  type DataSourceObjectResponse,
  type PartialDataSourceObjectResponse,
  type QueryDataSourceParameters,
  type UpdateDataSourceParameters,
} from '@notionhq/client';

import { NOTION_API_VERSION } from '../protocol';
import { ProviderError } from '../../provider-error';
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

import { databaseSchema, readPropertyIds } from './notion-sdk-schema';
import { fullPages, toMirrorChange, toParentPage } from './notion-sdk-pages';

/** Notion's documented page-size ceiling for list endpoints. */
const NOTION_PAGE_SIZE = 100;

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
      created = await this.notion.databases.create({
        parent: { type: 'page_id', page_id: spec.parentPageId },
        title: [{ type: 'text', text: { content: spec.title } }],
        initial_data_source: { properties: databaseSchema(spec.columns) },
      });
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
    };
  }

  /** Bring a provisioned data source's schema up to the current design without removing columns. */
  async updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<Record<string, string>> {
    try {
      const parameters: UpdateDataSourceParameters = {
        data_source_id: dataSourceId,
        title: [{ type: 'text', text: { content: spec.title } }],
        properties: databaseSchema(spec.columns),
      };
      const updated = await this.notion.dataSources.update(parameters);
      return readPropertyIds(spec.columns, propertiesOf(updated));
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

      const properties = (op.properties ?? {}) as never;
      const page =
        op.kind === 'create'
          ? await this.notion.pages.create({
              parent: { type: 'data_source_id', data_source_id: op.dataSourceId },
              properties,
            })
          : await this.updatePage(op.externalPageId, properties);
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

  /** Read live and trashed pages, letting a live copy win if a page races between partitions. */
  async queryChanges(dataSourceId: string, since?: string): Promise<MirrorChange[]> {
    const filter =
      since === undefined
        ? undefined
        : ({ timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } } as const);
    const read = async (archived: boolean): Promise<MirrorChange[]> => {
      const parameters = {
        data_source_id: dataSourceId,
        page_size: NOTION_PAGE_SIZE,
        ...(filter ? { filter } : {}),
        // The SDK types name this `in_trash`; the live API rejects that with
        // `body.in_trash should be not present`. `in_trash` is the page-update spelling, used in
        // `writeRow`'s delete branch.
        ...(archived ? { is_archived: true } : {}),
      } as unknown as QueryDataSourceParameters;
      const results = await collectPaginatedAPI(this.notion.dataSources.query, parameters);
      return fullPages(results).map((page) => toMirrorChange(page, archived));
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
