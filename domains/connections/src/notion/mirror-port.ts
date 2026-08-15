/**
 * Provider-agnostic port for Docket's designed Notion mirror.
 *
 * @remarks
 * The port describes the information the mirror workflow needs, without exposing an SDK request
 * or response shape. Browser, API, desktop, and in-memory implementations can therefore share
 * the same workflow contract while each provider adapter keeps its transport details local.
 */
import type { NotionPropertyKind } from './mirror-contract';

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
  readonly columns: readonly MirrorColumnSpec[];
}

/** What provisioning produced, including the property ids every later call addresses. */
export interface ProvisionedMirrorDatabase {
  readonly externalDatabaseId: string;
  readonly externalDataSourceId: string;
  readonly url?: string;
  /** Docket field key to provider property id; this binding survives a rename. */
  readonly propertyIds: Readonly<Record<string, string>>;
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
