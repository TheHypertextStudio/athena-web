/**
 * Provider-agnostic port for Docket's designed Notion mirror.
 *
 * @remarks
 * The port describes the information the mirror workflow needs, without exposing an SDK request
 * or response shape. Browser, API, desktop, and in-memory implementations can therefore share
 * the same workflow contract while each provider adapter keeps its transport details local.
 */
import type { NotionMirrorEntity, NotionPropertyKind } from './mirror-contract';

/** Where a page sits in the Notion workspace, as far as the picker needs to know. */
export type MirrorPageParentKind = 'workspace' | 'page' | 'database';

/** A page that can parent a designed database. */
export interface MirrorParentPage {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  /** The page's emoji icon, when it has one. */
  readonly icon?: string;
  /** ISO-8601 `last_edited_time`, used to order picker results. */
  readonly lastEditedTime?: string;
  readonly parentKind?: MirrorPageParentKind;
}

/** One page of parent-page results. */
export interface MirrorParentPageList {
  readonly items: MirrorParentPage[];
  /** The provider's opaque cursor for the next page, or null at the end. */
  readonly nextCursor: string | null;
}

/** How to narrow {@link NotionMirrorPort.listParentPages}. */
export interface MirrorParentPageQuery {
  /** A title substring; omitted or empty returns the most recently edited pages. */
  readonly query?: string;
  /** An opaque cursor from a previous call's `nextCursor`. */
  readonly cursor?: string;
  /** How many results to ask the provider for. */
  readonly limit?: number;
}

/** A human in the provider workspace, for identity matching. */
export interface MirrorExternalPerson {
  readonly externalId: string;
  readonly name: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

/** One column to provision in a mirror database. */
export interface MirrorColumnSpec {
  /** The Docket field key this column carries. */
  readonly field: string;
  /** The column title visible in Notion. */
  readonly title: string;
  /** The Notion property type, already resolved through the person representation. */
  readonly kind: NotionPropertyKind;
  /** The data source a relation column points at. */
  readonly relationDataSourceId?: string;
  /** The option set for a select, derived from live data rather than hardcoded. */
  readonly options?: readonly string[];
}

/** The database to create or bring up to date. */
export interface MirrorDatabaseSpec {
  readonly title: string;
  readonly parentPageId: string;
  /** Human-readable mirror kind stored in Notion. A Docket record id cannot enter this field. */
  readonly entityType: NotionMirrorEntity;
  readonly columns: readonly MirrorColumnSpec[];
}

/** Provider-owned facts that identify a database after an ambiguous create response. */
export interface MirrorDatabaseRecovery {
  readonly createdAtOrAfter: string;
  readonly createdBy: string;
}

/** What provisioning produced, including the property ids every later call addresses. */
export interface MirrorDatabaseBindings {
  /** Docket field key to provider property id; this binding survives a rename. */
  readonly propertyIds: Readonly<Record<string, string>>;
}

/** What provisioning produced, including the property ids every later call addresses. */
export interface ProvisionedMirrorDatabase extends MirrorDatabaseBindings {
  readonly externalDatabaseId: string;
  readonly externalDataSourceId: string;
  readonly url?: string;
}

/** One row write. */
export interface MirrorRowOp {
  readonly kind: 'create' | 'update' | 'delete';
  readonly dataSourceId: string;
  /** Absent for `create`. */
  readonly externalPageId?: string;
  /** Docket field key to a provider-formatted value. */
  readonly properties?: Record<string, unknown>;
}

/** The outcome of one row write. */
export interface MirrorRowResult {
  readonly externalPageId: string;
  readonly externalUpdatedAt: string;
}

/** A page creation Docket may adopt after losing the create response. */
export interface MirrorCreatedRow extends MirrorRowResult {
  /** When Notion created the page. */
  readonly externalCreatedAt: string;
  /** The provider user that created the page. */
  readonly createdBy: string;
}

/** Whether the complete page body was available from Notion. */
export type NotionContentState = 'complete' | 'truncated' | 'inaccessible';

/** @deprecated Use {@link NotionContentState}; retained for existing mirror callers. */
export type MirrorPageContentState = NotionContentState;

/** A Notion page body rendered as Markdown, with its retrieval completeness. */
export interface NotionPageContent {
  /** Notion-enhanced Markdown for the page body. */
  readonly markdown: string;
  /** A truncated or inaccessible body must never be interpreted as empty. */
  readonly state: NotionContentState;
  /** Blocks Notion could not include in the response. */
  readonly unknownBlockIds: readonly string[];
  /** The page's current provider edit anchor after a successful content write. */
  readonly externalUpdatedAt?: string;
}

/** @deprecated Use {@link NotionPageContent}; retained for existing mirror callers. */
export type MirrorPageContent = NotionPageContent;

/** Stable hashes for independently reconciled page properties and the long-form body. */
export interface NotionFieldAnchors {
  /** Docket field key to the last acknowledged value hash. */
  readonly properties: Readonly<Record<string, string>>;
  /** Hash of the last acknowledged complete Markdown body, when Docket could read one. */
  readonly bodyHash: string | null;
  /** Why the body hash is absent or cannot safely be used for replacement. */
  readonly bodyState: NotionContentState;
}

/** A change observed on the provider side. */
export interface MirrorChange {
  readonly externalPageId: string;
  readonly externalUpdatedAt: string;
  readonly archived: boolean;
  /** Raw provider property values, keyed by the provider property name. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** The provider user id that last edited the page, when present. */
  readonly lastEditedBy?: string;
}

/**
 * The capability the mirror's sync passes depend on.
 *
 * @remarks
 * Keeping the workflow behind an explicit port makes the in-memory adapter a real behavioral
 * substitute, rather than a UI-only fixture. It also lets a future desktop client own its own
 * provider transport without duplicating reconciliation rules.
 */
export interface NotionMirrorPort {
  /** Docket's own bot user id, used by the echo guard. */
  botId(): Promise<string>;
  /** Pages the integration may parent a database under, narrowed and paged. */
  listParentPages(options?: MirrorParentPageQuery): Promise<MirrorParentPageList>;
  /** Describe one parent page by id. */
  describePage(pageId: string): Promise<MirrorParentPage>;
  /** The workspace's people, never its bots. */
  listWorkspaceUsers(): Promise<MirrorExternalPerson[]>;
  /** Create a database and its initial data source. */
  provisionDatabase(spec: MirrorDatabaseSpec): Promise<ProvisionedMirrorDatabase>;
  /** Find databases created for a durable provisioning intent. */
  findProvisionedDatabases(
    spec: MirrorDatabaseSpec,
    recovery: MirrorDatabaseRecovery,
  ): Promise<ProvisionedMirrorDatabase[]>;
  /** Bring a provisioned data source's schema up to the current design. */
  updateDatabaseSchema(
    dataSourceId: string,
    spec: MirrorDatabaseSpec,
  ): Promise<MirrorDatabaseBindings>;
  /** Find pages the integration created after a durable local create intent. */
  queryCreatedRows(dataSourceId: string, since: string): Promise<MirrorCreatedRow[]>;
  /** Read a page body without flattening its Notion block structure into a property. */
  readPageContent(pageId: string): Promise<NotionPageContent>;
  /** Replace a page body with Docket's canonical Markdown. */
  writePageContent(pageId: string, markdown: string): Promise<NotionPageContent>;
  /** Apply one row write. */
  writeRow(op: MirrorRowOp): Promise<MirrorRowResult | undefined>;
  /** Read the rows edited since a cursor. */
  queryChanges(dataSourceId: string, since?: string): Promise<MirrorChange[]>;
}
