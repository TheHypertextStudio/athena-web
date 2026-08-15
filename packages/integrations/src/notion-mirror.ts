/**
 * `@docket/integrations` — the Notion mirror's provider edge, on the official SDK.
 *
 * @remarks
 * **The SDK is the source of truth.** Every request and response shape here is the SDK's own
 * generated type (`CreateDatabaseParameters`, `UpdateDataSourceParameters`,
 * `QueryDataSourceParameters`, …) rather than a hand-transcribed reading of the REST docs, and
 * {@link NotionPropertyKindIsSdkBacked} / {@link NotionSchemaIsSdkBacked} below make that
 * structural rather than aspirational: if Docket names a property type the installed SDK does
 * not have, or emits a schema shape either endpoint would reject, the build fails. Docket keeps
 * its own narrower schema — nine entities, twelve property kinds, four person representations —
 * but only as a *subset* the SDK validates.
 *
 * `@notionhq/client` also settles two things this module would otherwise have had to guess: it
 * retries throttled requests with backoff internally, and it ships `verifyWebhookSignature` so the
 * observer never hand-rolls an HMAC. The API version is NOT left to the SDK's own default —
 * `Client.defaultNotionVersion` lags behind Notion's actual latest release (confirmed against the
 * installed `@notionhq/client@5.24.0`, itself published the same week this was checked), so the
 * version is passed explicitly below, from the same constant the linked-mode connector uses.
 *
 * The older linked-database connector in `./notion.ts` stays on `ProviderHttp`. It is shipped,
 * covered by 36 tests, and migrating it is a mechanical change with no behaviour to gain — so it
 * is deliberately out of this change's scope rather than half-done inside it.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import {
  APIErrorCode,
  Client,
  type CreateDatabaseParameters,
  type CreateDatabaseResponse,
  type DataSourceObjectResponse,
  type PageObjectResponse,
  type PartialDataSourceObjectResponse,
  type PartialPageObjectResponse,
  type QueryDataSourceParameters,
  type UpdateDataSourceParameters,
  collectPaginatedAPI,
  isFullPage,
  isNotionClientError,
} from '@notionhq/client';
import type { NotionColumnBinding, NotionPropertyKind } from '@docket/types';
import { NOTION_API_VERSION } from './notion-mapping';

import { ConnectorError } from './connector-error';
import { provisionedKind } from './notion-mirror-schema';

/**
 * The property-schema map the SDK accepts when creating a database's initial data source.
 *
 * @remarks
 * Read off {@link CreateDatabaseParameters} rather than restated, so a Notion schema change that
 * lands in a future SDK release shows up here as a type error instead of a runtime 400.
 */
type SdkPropertySchemaMap = NonNullable<
  NonNullable<CreateDatabaseParameters['initial_data_source']>['properties']
>;

/** Assert `Narrow` is assignable to `Wide`; a compile error when it is not. */
type AssertSubset<Narrow extends Wide, Wide> = Narrow;

/** One property's schema definition on the create path, as the SDK types it. */
type SdkPropertySchema = SdkPropertySchemaMap[string];

/**
 * The property-schema map the SDK accepts when updating an existing data source.
 *
 * @remarks
 * Deliberately a separate type: the create and update unions are **not** the same. Update
 * additionally accepts `null` (remove a property) and differs in a handful of members, so
 * assuming one shape for both is a 400 waiting to happen. Docket's own
 * {@link DocketPropertySchema} is asserted against both below, which is what lets one builder
 * feed both endpoints safely.
 */
type SdkUpdatePropertySchemaMap = NonNullable<UpdateDataSourceParameters['properties']>;

/**
 * Exactly the property shapes Docket emits — no more.
 *
 * @remarks
 * Narrower than either SDK union on purpose. Docket never provisions a `button`, `formula`,
 * `rollup`, `place` or `verification` property, and naming only what it does emit is what makes
 * the same builder assignable to both the create and the update map. The two assertions below
 * are the guard rails: if a shape here stops satisfying either SDK union, the build fails rather
 * than the request.
 */
type DocketPropertySchema =
  | { title: Record<string, never> }
  | { rich_text: Record<string, never> }
  | { number: Record<string, never> }
  | { checkbox: Record<string, never> }
  | { date: Record<string, never> }
  | { url: Record<string, never> }
  | { email: Record<string, never> }
  | { people: Record<string, never> }
  | { status: Record<string, never> }
  | { select: { options: { name: string }[] } }
  | { multi_select: { options: { name: string }[] } }
  | { relation: { data_source_id: string; single_property: Record<string, never> } };

/** Compile-time proof the builder's output is valid on `databases.create`. */
type AssertCreatable = AssertSubset<DocketPropertySchema, SdkPropertySchema>;
/** Compile-time proof the same output is valid on `dataSources.update`. */
type AssertUpdatable = AssertSubset<DocketPropertySchema, SdkUpdatePropertySchemaMap[string]>;
/** Referenced so the assertions above are checked rather than elided as unused. */
export type NotionSchemaIsSdkBacked = [AssertCreatable, AssertUpdatable];

/**
 * Every property type the installed SDK can create, derived from its own union.
 *
 * @remarks
 * `SdkPropertySchema` is a discriminated union of `{ title: {...} } | { rich_text: {...} } | …`,
 * so its keys are exactly the set of creatable property types.
 */
type SdkPropertyTypeName = SdkPropertySchema extends infer S
  ? S extends object
    ? keyof S
    : never
  : never;

/**
 * Compile-time proof that Docket's property kinds are a subset of the SDK's.
 *
 * @remarks
 * This is the mechanism that makes "the SDK is the source of truth" enforceable rather than a
 * comment. It is a type-level assertion with no runtime cost: assigning
 * {@link NotionPropertyKind} to {@link SdkPropertyTypeName} fails to compile the moment the two
 * disagree — whether because Docket invented a type or because an SDK upgrade removed one.
 */
export type NotionPropertyKindIsSdkBacked = AssertSubset<NotionPropertyKind, SdkPropertyTypeName>;

/** Notion's documented page-size ceiling for list endpoints. */
const NOTION_PAGE_SIZE = 100;

/**
 * Notion's per-request relation ceiling.
 *
 * @remarks
 * A page write may reference at most 100 related pages. Exceeding it is a 400, so a to-many
 * relation is truncated to this bound and the caller is told — never silently trimmed.
 */
export const NOTION_RELATION_LIMIT = 100;

/** Notion's rich-text length ceiling; longer content is a 400 rather than a truncation. */
export const NOTION_TEXT_LIMIT = 2000;

/** Where a page sits in the Notion workspace, as far as one search result can say. */
export type MirrorPageParentKind = 'workspace' | 'page' | 'database';

/**
 * A page in the workspace that can parent a designed database.
 *
 * @remarks
 * Carries more than an id and a title because the picker has to be usable in a real workspace,
 * where several pages share a name. Resolving each result's *parent title* would be an N+1 fetch
 * per keystroke, so the disambiguating detail is the three things one search result already
 * knows: the page's own emoji, whether it sits at the top level, and when it was last touched.
 */
export interface MirrorParentPage {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  /** The page's emoji icon, when it has one. File and external icons are not carried. */
  readonly icon?: string;
  /** ISO-8601 `last_edited_time`, the field the search is also sorted by. */
  readonly lastEditedTime?: string;
  readonly parentKind?: MirrorPageParentKind;
}

/** One page of {@link MirrorParentPage} results. */
export interface MirrorParentPageList {
  readonly items: MirrorParentPage[];
  /** Notion's opaque cursor for the next page, or null at the end of the list. */
  readonly nextCursor: string | null;
}

/** How to narrow {@link NotionMirrorPort.listParentPages}. */
export interface MirrorParentPageQuery {
  /** A title substring; omitted or empty returns the most recently edited pages. */
  readonly query?: string;
  /** An opaque cursor from a previous call's `nextCursor`. */
  readonly cursor?: string;
  /** How many results to ask Notion for. Capped at Notion's own ceiling. */
  readonly limit?: number;
}

/** A human in the provider workspace, for identity matching. */
export interface MirrorExternalPerson {
  readonly externalId: string;
  readonly name: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

/** One column to provision. */
export interface MirrorColumnSpec {
  /** The Docket field key this column carries. */
  readonly field: string;
  /** The column title in Notion. */
  readonly title: string;
  /** The Notion property type, already resolved through the person representation. */
  readonly kind: NotionPropertyKind;
  /** The data source a `relation` column points at. */
  readonly relationDataSourceId?: string;
  /** The option set for a `select`, derived from live data rather than hardcoded. */
  readonly options?: readonly string[];
}

/** The database to create or bring up to date. */
export interface MirrorDatabaseSpec {
  readonly title: string;
  readonly parentPageId: string;
  readonly columns: readonly MirrorColumnSpec[];
}

/** What provisioning produced, including the property ids every later call addresses. */
export interface ProvisionedMirrorDatabase {
  readonly externalDatabaseId: string;
  readonly externalDataSourceId: string;
  readonly url?: string;
  /** Docket field key → Notion property id. The binding that survives a rename. */
  readonly propertyIds: Readonly<Record<string, string>>;
}

/** One row write. */
export interface MirrorRowOp {
  readonly kind: 'create' | 'update' | 'delete';
  readonly dataSourceId: string;
  /** Absent for `create`. */
  readonly externalPageId?: string | undefined;
  /** Docket field key → already-formatted Notion value. */
  readonly properties?: SdkPropertySchemaMap extends never
    ? never
    : Record<string, unknown> | undefined;
}

/** The outcome of one row write. */
export interface MirrorRowResult {
  readonly externalPageId: string;
  readonly externalUpdatedAt: string;
}

/** A change observed on the Notion side. */
export interface MirrorChange {
  readonly externalPageId: string;
  readonly externalUpdatedAt: string;
  readonly archived: boolean;
  /** Raw Notion property values, keyed by the property's **name** as Notion returns them. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** The Notion user id that last edited the page, when the payload carries one. */
  readonly lastEditedBy?: string;
}

/**
 * Build the SDK property schema for one designed column.
 *
 * @remarks
 * Pure and exported so the mapping is unit-tested without a network. The return type is the
 * SDK's own, so an unsupported shape is a compile error rather than a 400 discovered in
 * production.
 *
 * @param column - The column to provision.
 * @returns the SDK schema entry.
 * @throws {ConnectorError} When a relation column names no target data source — Notion rejects a
 *   relation with no `data_source_id`, and guessing one would wire the column to the wrong table.
 */
export function columnSchema(column: MirrorColumnSpec): DocketPropertySchema {
  switch (column.kind) {
    case 'title':
      return { title: {} };
    case 'rich_text':
      return { rich_text: {} };
    case 'number':
      return { number: {} };
    case 'checkbox':
      return { checkbox: {} };
    case 'date':
      return { date: {} };
    case 'url':
      return { url: {} };
    case 'email':
      return { email: {} };
    case 'people':
      return { people: {} };
    case 'select':
      return { select: { options: (column.options ?? []).map((name) => ({ name })) } };
    case 'multi_select':
      return { multi_select: { options: (column.options ?? []).map((name) => ({ name })) } };
    case 'status':
      // Notion owns a status property's groups and rejects an explicit option set on create.
      return { status: {} };
    case 'relation': {
      const dataSourceId = column.relationDataSourceId;
      if (dataSourceId === undefined) {
        throw new ConnectorError(
          `Notion relation column "${column.title}" has no target data source`,
          { provider: 'notion', kind: 'provider' },
        );
      }
      return { relation: { data_source_id: dataSourceId, single_property: {} } };
    }
  }
}

/**
 * Build the full property-schema map for a designed database.
 *
 * @param columns - The designed columns.
 * @returns the schema map keyed by column title, as Notion's create/update endpoints expect.
 */
export function databaseSchema(
  columns: readonly MirrorColumnSpec[],
): Record<string, DocketPropertySchema> {
  const schema: Record<string, DocketPropertySchema> = {};
  for (const column of columns) schema[column.title] = columnSchema(column);
  return schema;
}

/**
 * Read the provisioned property ids back out of a data source response.
 *
 * @remarks
 * Notion keys its response `properties` by title, but Docket binds by id — so this is the one
 * place the two are correlated, at the only moment the correlation is unambiguous: immediately
 * after Docket itself chose the titles.
 *
 * @param columns - The columns that were requested, in Docket field order.
 * @param properties - The `properties` map Notion returned.
 * @returns Docket field key → Notion property id, omitting any column Notion did not create.
 */
export function readPropertyIds(
  columns: readonly MirrorColumnSpec[],
  properties: Readonly<Record<string, { id?: string } | undefined>>,
): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const column of columns) {
    const id = properties[column.title]?.id;
    if (typeof id === 'string' && id.length > 0) ids[column.field] = id;
  }
  return ids;
}

/** Narrow a query result to the pages that carry properties. */
function fullPages(
  results: readonly (PageObjectResponse | PartialPageObjectResponse | object)[],
): PageObjectResponse[] {
  return results.filter((r): r is PageObjectResponse => isFullPage(r as PageObjectResponse));
}

/**
 * Translate an SDK error into Docket's connector-error vocabulary.
 *
 * @remarks
 * Preserves the auth / rate-limit / provider distinction the rest of the sync spine branches on,
 * and never lets a provider message reach the UI — `ConnectorError` is what the route layer turns
 * into an application-owned string.
 *
 * @param err - The thrown value.
 * @param context - What was being attempted, for the log line.
 */
function asConnectorError(err: unknown, context: string): ConnectorError {
  if (isNotionClientError(err) && 'code' in err) {
    const code = err.code;
    const kind =
      code === APIErrorCode.Unauthorized || code === APIErrorCode.RestrictedResource
        ? 'auth'
        : code === APIErrorCode.RateLimited
          ? 'rate_limit'
          : 'provider';
    return new ConnectorError(`Notion ${context} failed (${code})`, {
      provider: 'notion',
      kind,
    });
  }
  return new ConnectorError(`Notion ${context} failed`, { provider: 'notion', kind: 'network' });
}

/**
 * The capability the mirror's sync passes depend on.
 *
 * @remarks
 * Extracted so the reconciler names an interface rather than a class, which is what lets
 * {@link import('./mock-notion-mirror').MockNotionMirror} stand in for it. That matters beyond
 * testing: the repo's zero-external-accounts rule means the whole provision → project → pull-back
 * flow has to be exercisable on a laptop with no Notion workspace at all.
 */
export interface NotionMirrorPort {
  /** Docket's own bot user id — the echo guard's other half. */
  botId(): Promise<string>;
  /** Pages the integration may parent a database under, narrowed and paged. */
  listParentPages(options?: MirrorParentPageQuery): Promise<MirrorParentPageList>;
  /** Describe one page by id, so the server owns the container page's name and URL. */
  describePage(pageId: string): Promise<MirrorParentPage>;
  /** The workspace's people, never its bots. */
  listWorkspaceUsers(): Promise<MirrorExternalPerson[]>;
  /** Create a database and its initial data source. */
  provisionDatabase(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase>;
  /** Bring a provisioned data source's schema up to the current design. */
  updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<Record<string, string>>;
  /** Apply one row write. */
  writeRow(op: MirrorRowOp): Promise<MirrorRowResult | undefined>;
  /** Read the rows edited since a cursor. */
  queryChanges(dataSourceId: string, since?: string): Promise<MirrorChange[]>;
}

/**
 * The Notion mirror's I/O edge.
 *
 * @remarks
 * Thin by design: every non-trivial transformation lives in the pure helpers above or in
 * `./notion-mirror-schema`, so the untestable part is only the network call itself.
 */
export class NotionMirrorClient implements NotionMirrorPort {
  private readonly notion: Client;

  /**
   * @param auth - The OAuth access token for the connected Notion workspace.
   * @param fetchImpl - Optional fetch override, so tests drive the SDK without a network.
   */
  constructor(auth: string, fetchImpl?: typeof fetch) {
    this.notion = new Client({
      auth,
      notionVersion: NOTION_API_VERSION,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  /**
   * Resolve the integration's own bot id.
   *
   * @remarks
   * The echo guard's other half: a webhook whose authors are all this id was caused by Docket's
   * own write and must not be replayed back into Docket. Persisted on the integration row so the
   * observer can decide without a network call.
   *
   * @returns the bot user id.
   */
  async botId(): Promise<string> {
    try {
      const me = await this.notion.users.me({});
      return me.id;
    } catch (err) {
      throw asConnectorError(err, 'identity lookup');
    }
  }

  /**
   * List the pages the integration may parent a database under.
   *
   * @remarks
   * A public Notion integration only sees what the person shared with it during consent, so an
   * empty result is a legitimate, common state that the setup flow must explain rather than treat
   * as an error.
   *
   * **One request, narrowed and ordered by the provider.** This used to walk the entire result set
   * with `collectPaginatedAPI` at 100 pages a request, unsorted, on every settings open — and
   * claimed an ordering in its own docstring that the call never asked for. Notion's `search`
   * takes both a title `query` and a `last_edited_time` sort, so the narrowing belongs there
   * rather than in a client that has already paid to download the whole workspace.
   *
   * @param options - Title query, cursor and page size; all optional.
   * @returns one page of shareable pages, most recently edited first, plus the next cursor.
   */
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
    } catch (err) {
      throw asConnectorError(err, 'page listing');
    }
  }

  /**
   * Describe one page by id.
   *
   * @remarks
   * Exists so the *server* records what the container page is called and where it lives, rather
   * than trusting a title the browser happened to be showing when someone pressed Create. The
   * settings surface then names the page without a Notion round trip on every load.
   *
   * @param pageId - The Notion page id.
   * @returns the page's title, URL, icon and placement.
   */
  async describePage(pageId: string): Promise<MirrorParentPage> {
    try {
      const page = await this.notion.pages.retrieve({ page_id: pageId });
      const full = fullPages([page])[0];
      return full ? toParentPage(full) : { id: pageId, title: 'Untitled' };
    } catch (err) {
      throw asConnectorError(err, 'page lookup');
    }
  }

  /**
   * List the humans in the Notion workspace.
   *
   * @remarks
   * Filtered to `type === 'person'` deliberately. Notion returns integration bots in the same
   * list — a real workspace commonly has several — and offering an automation as an assignable
   * teammate would be nonsense. Bots are also exactly what the echo guard needs to ignore.
   *
   * @returns the workspace's people, never its bots.
   */
  async listWorkspaceUsers(): Promise<MirrorExternalPerson[]> {
    try {
      const results = await collectPaginatedAPI(this.notion.users.list, {
        page_size: NOTION_PAGE_SIZE,
      });
      const people: MirrorExternalPerson[] = [];
      for (const user of results) {
        // The SDK already narrows `type: 'person'` to a shape carrying `person`, so this is the
        // only check needed — and it is the check that keeps integration bots (a real workspace
        // usually has several) out of the assignable-people list.
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
    } catch (err) {
      throw asConnectorError(err, 'people listing');
    }
  }

  /**
   * Create a database and its initial data source under the chosen parent page.
   *
   * @param spec - The designed title, parent, and columns.
   * @returns the created ids plus the property ids every later call binds to.
   * @throws {ConnectorError} When Notion accepts the write but returns no data source, which
   *   would leave Docket holding a database it can neither query nor write rows into.
   */
  async provisionDatabase(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase> {
    let created;
    try {
      created = await this.notion.databases.create({
        parent: { type: 'page_id', page_id: spec.parentPageId },
        title: [{ type: 'text', text: { content: spec.title } }],
        initial_data_source: { properties: databaseSchema(spec.columns) },
      });
    } catch (err) {
      throw asConnectorError(err, `database creation for "${spec.title}"`);
    }

    const dataSourceId = firstDataSourceId(created);
    if (dataSourceId === undefined) {
      throw new ConnectorError(
        `Notion created database "${spec.title}" but returned no data source`,
        { provider: 'notion', kind: 'provider' },
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

  /**
   * Bring an already-provisioned data source's schema up to the current design.
   *
   * @remarks
   * Used both when the user changes the design and as the repair path when the schema in Notion
   * has drifted. Notion merges the supplied properties, so unnamed ones are left alone rather
   * than destroyed — a schema update must never take a column with data in it away.
   *
   * @param dataSourceId - The data source to update.
   * @param spec - The current design.
   * @returns the refreshed Docket-field → property-id map.
   */
  async updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<Record<string, string>> {
    try {
      const params: UpdateDataSourceParameters = {
        data_source_id: dataSourceId,
        title: [{ type: 'text', text: { content: spec.title } }],
        properties: databaseSchema(spec.columns),
      };
      const updated = await this.notion.dataSources.update(params);
      return readPropertyIds(spec.columns, propertiesOf(updated));
    } catch (err) {
      throw asConnectorError(err, `schema update for "${spec.title}"`);
    }
  }

  /** Retrieve a data source, for its property ids. */
  private async retrieveDataSource(
    dataSourceId: string,
  ): Promise<{ properties: Record<string, { id?: string }> }> {
    try {
      const ds = await this.notion.dataSources.retrieve({ data_source_id: dataSourceId });
      return { properties: propertiesOf(ds) };
    } catch (err) {
      throw asConnectorError(err, 'data source lookup');
    }
  }

  /**
   * Apply one row write.
   *
   * @remarks
   * A delete is Notion's own soft delete (`in_trash`). Notion exposes no hard delete over the
   * API, and destroying a page would break the rule that a sync never destroys data at either
   * end — the row has to remain recoverable from the trash.
   *
   * @param op - The create, update, or delete to apply.
   * @returns the post-write anchor, or undefined for a delete.
   */
  async writeRow(op: MirrorRowOp): Promise<MirrorRowResult | undefined> {
    try {
      if (op.kind === 'delete') {
        if (op.externalPageId === undefined) return undefined;
        await this.notion.pages.update({ page_id: op.externalPageId, in_trash: true });
        return undefined;
      }
      const properties = (op.properties ?? {}) as never;
      let page;
      if (op.kind === 'create') {
        page = await this.notion.pages.create({
          parent: { type: 'data_source_id', data_source_id: op.dataSourceId },
          properties,
        });
      } else {
        const pageId = op.externalPageId;
        if (pageId === undefined) {
          // `page_id: ''` reaches Notion as an opaque validation error naming a field the caller
          // never set. Failing here names the actual problem: an update with nothing to update.
          throw new ConnectorError('Notion update requested with no page id', {
            provider: 'notion',
            kind: 'provider',
          });
        }
        page = await this.notion.pages.update({ page_id: pageId, properties });
      }
      if (!isFullPage(page)) {
        throw new ConnectorError('Notion accepted the write but returned no page anchor', {
          provider: 'notion',
          kind: 'provider',
        });
      }
      return { externalPageId: page.id, externalUpdatedAt: page.last_edited_time };
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw asConnectorError(err, `row ${op.kind}`);
    }
  }

  /**
   * Read the rows edited since a cursor.
   *
   * @remarks
   * Filtering on `last_edited_time` is what keeps a fifteen-minute sweep from re-reading the
   * whole database: Notion allows roughly three requests a second, and a full re-query of every
   * projected entity would spend that budget on rows that did not change.
   *
   * The archived partition is queried separately, because the default query omits trashed pages
   * and their absence is indistinguishable from "filtered out" — which must never archive a
   * Docket record on its own.
   *
   * @param dataSourceId - The data source to read.
   * @param since - RFC3339 cutoff; absent reads everything.
   * @returns the changed rows, live and trashed, deduplicated with the live copy winning.
   */
  async queryChanges(dataSourceId: string, since?: string): Promise<MirrorChange[]> {
    const filter =
      since === undefined
        ? undefined
        : ({ timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } } as const);

    const read = async (archived: boolean): Promise<PageObjectResponse[]> => {
      const args = {
        data_source_id: dataSourceId,
        page_size: NOTION_PAGE_SIZE,
        ...(filter ? { filter } : {}),
        ...(archived ? { in_trash: true } : {}),
      } as unknown as QueryDataSourceParameters;
      const results = await collectPaginatedAPI(this.notion.dataSources.query, args);
      return fullPages(results);
    };

    try {
      const live = await read(false);
      const trashed = await read(true);
      const byId = new Map<string, MirrorChange>();
      // Live first, and `has` guards the trashed pass: a page that moved to the trash between the
      // two queries appears in both, and letting the tombstone win would archive a Docket record
      // on the strength of a race.
      for (const page of live) byId.set(page.id, toChange(page, false));
      for (const page of trashed) {
        if (byId.has(page.id)) continue;
        byId.set(page.id, toChange(page, true));
      }
      return [...byId.values()];
    } catch (err) {
      throw asConnectorError(err, 'change query');
    }
  }
}

/** Read a page's title out of whichever property carries it. */
function pageTitle(page: PageObjectResponse): string {
  for (const value of Object.values(page.properties)) {
    if (value.type !== 'title') continue;
    const text = value.title.map((t) => t.plain_text).join('');
    if (text.length > 0) return text;
  }
  return 'Untitled';
}

/**
 * Which Notion parent types map to which placement, answerable at a glance.
 *
 * @remarks
 * Partial on purpose: `block_id` and any type a future API version adds fall through to
 * `undefined`, which the picker renders as a row with no placement line rather than a wrong one.
 */
const PARENT_KIND: Partial<Record<PageObjectResponse['parent']['type'], MirrorPageParentKind>> = {
  workspace: 'workspace',
  page_id: 'page',
  data_source_id: 'database',
  database_id: 'database',
};

/**
 * Map a full page response onto the picker's page shape.
 *
 * @remarks
 * Only an `emoji` icon is carried. Notion's other two icon kinds are hosted images, and a picker
 * row that fires off an authenticated image request per option — for decoration — is not worth
 * the bytes or the broken-image state when the URL expires.
 *
 * @param page - The full page from `search` or `pages.retrieve`.
 * @returns the page as the setup flow needs it.
 */
export function toParentPage(page: PageObjectResponse): MirrorParentPage {
  const parentKind = PARENT_KIND[page.parent.type];
  return {
    id: page.id,
    title: pageTitle(page),
    ...(typeof page.url === 'string' ? { url: page.url } : {}),
    ...(page.icon?.type === 'emoji' ? { icon: page.icon.emoji } : {}),
    lastEditedTime: page.last_edited_time,
    ...(parentKind !== undefined ? { parentKind } : {}),
  };
}

/** Map a full page response onto the mirror's change shape. */
function toChange(page: PageObjectResponse, archived: boolean): MirrorChange {
  return {
    externalPageId: page.id,
    externalUpdatedAt: page.last_edited_time,
    archived: archived || page.in_trash,
    properties: page.properties,
    lastEditedBy: page.last_edited_by.id,
  };
}

/**
 * Pull the first data source id off a created-database response.
 *
 * @remarks
 * `databases.create` can answer with a partial object that omits `data_sources`, so this narrows
 * rather than asserting. A missing id is surfaced by the caller as a hard error: a database
 * Docket cannot address is worse than one it never created.
 */
function firstDataSourceId(created: CreateDatabaseResponse): string | undefined {
  const sources = 'data_sources' in created ? created.data_sources : undefined;
  return sources?.[0]?.id;
}

/** Read a `url` off a response that may be a partial object. */
function hasUrl(value: unknown): value is { url: string } {
  return typeof (value as { url?: unknown } | null)?.url === 'string';
}

/** Read the `properties` map off a data-source response that may be partial. */
function propertiesOf(
  value: DataSourceObjectResponse | PartialDataSourceObjectResponse | object,
): Record<string, { id?: string }> {
  const properties = (value as { properties?: unknown }).properties;
  return typeof properties === 'object' && properties !== null
    ? (properties as Record<string, { id?: string }>)
    : {};
}

/** Re-exported so callers resolve a binding's Notion type through one implementation. */
export { provisionedKind };
export type { NotionColumnBinding };
