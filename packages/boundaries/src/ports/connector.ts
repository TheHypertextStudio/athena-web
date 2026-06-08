/**
 * `@docket/boundaries/ports` — the `Connector` port.
 *
 * @remarks
 * The single typed edge to an external work/context provider
 * (GitHub/Drive/Linear/Gmail/Calendar/Google Tasks). The real adapters call the
 * provider API with an OAuth token; the mock returns fixture issues/docs/events/tasks
 * carrying provenance.
 * The Migration-vs-Connector logic and import / read-only-mirror are real business
 * logic exercised against this port — only the I/O edge is swapped (`boundaries.md`
 * §5).
 */

/**
 * The external providers Docket can connect to.
 *
 * @remarks
 * `gtasks` is Google Tasks (the user's personal to-dos), distinct from `calendar`
 * (Google Calendar events) and the Google document/mail surfaces (`drive`/`gmail`).
 */
export type ConnectorProvider = 'github' | 'drive' | 'linear' | 'gmail' | 'calendar' | 'gtasks';

/** Input to establish a connection to a provider for an org scope. */
export interface ConnectInput {
  /** The provider to connect. */
  readonly provider: ConnectorProvider;
  /** Docket scope the connection belongs to (usually the organization id). */
  readonly referenceId: string;
  /** Reference to the stored OAuth credential (never the secret itself). */
  readonly credentialsRef?: string;
  /** External workspace/account to scope imports to. */
  readonly externalWorkspaceId?: string;
}

/** Result of establishing a provider connection. */
export interface ConnectionResult {
  /** Stable connection id within Docket. */
  readonly connectionId: string;
  /** The connected provider. */
  readonly provider: ConnectorProvider;
  /** Connection health after the connect attempt. */
  readonly status: 'connected' | 'error';
  /** External account/login label, when known. */
  readonly account?: string;
}

/** Provenance attached to every imported item so its origin is auditable. */
export interface ItemProvenance {
  /** The provider the item came from. */
  readonly provider: ConnectorProvider;
  /** The item's native id in the source system. */
  readonly externalId: string;
  /** Canonical URL of the item in the source system, when available. */
  readonly externalUrl?: string;
  /** ISO-8601 timestamp the item was imported. */
  readonly importedAt: string;
}

/** One unit of work imported from a provider, with provenance. */
export interface ImportedItem {
  /** Stable Docket-side id for the imported item. */
  readonly id: string;
  /** The high-level kind of the source object. */
  readonly kind: 'issue' | 'document' | 'event' | 'message';
  /** Display title/summary. */
  readonly title: string;
  /** Optional body/description. */
  readonly body?: string;
  /** Where the item came from. */
  readonly provenance: ItemProvenance;
}

/** Input to import work from a provider connection. */
export interface ImportWorkInput {
  /** The connection to import from. */
  readonly connectionId: string;
  /** The provider being imported from. */
  readonly provider: ConnectorProvider;
  /** Optional external workspace to scope the import to. */
  readonly externalWorkspaceId?: string;
}

/** Input to query a read-only mirror's sync status. */
export interface MirrorStatusInput {
  /** The connection whose mirror status is requested. */
  readonly connectionId: string;
  /** The provider being mirrored. */
  readonly provider: ConnectorProvider;
}

/** The read-only-mirror sync status for a connection. */
export interface MirrorResult {
  /** The connection this status describes. */
  readonly connectionId: string;
  /** Current mirror state. */
  readonly status: 'idle' | 'syncing' | 'error';
  /** ISO-8601 timestamp of the last successful sync, when any. */
  readonly lastSyncedAt?: string;
  /** Count of items currently mirrored. */
  readonly itemCount: number;
}

/** Input to link a single Docket resource to an external one. */
export interface LinkResourceInput {
  /** The connection used to resolve the external resource. */
  readonly connectionId: string;
  /** The provider hosting the external resource. */
  readonly provider: ConnectorProvider;
  /** The Docket resource id to link. */
  readonly resourceId: string;
  /** The external resource id to link it to. */
  readonly externalId: string;
}

/** Result of linking a Docket resource to an external one. */
export interface LinkResult {
  /** The Docket resource that was linked. */
  readonly resourceId: string;
  /** The external resource it is now linked to. */
  readonly externalId: string;
  /** Canonical URL of the external resource, when available. */
  readonly externalUrl?: string;
  /** Whether the link was established. */
  readonly linked: boolean;
}

/**
 * The connector port: a single typed edge for connecting to a provider and pulling /
 * mirroring / linking its work. Implemented by the real provider adapters and
 * `MockConnector`.
 */
export interface Connector {
  /**
   * Establish a connection to the provider.
   *
   * @param input - Provider, scope, and credential reference.
   * @returns the connection id and health.
   */
  connect(input: ConnectInput): Promise<ConnectionResult>;

  /**
   * Import work items from an established connection (one-time import).
   *
   * @param input - The connection and optional workspace scope.
   * @returns the imported items, each carrying provenance.
   */
  importWork(input: ImportWorkInput): Promise<ImportedItem[]>;

  /**
   * Query the read-only mirror sync status for a connection.
   *
   * @param input - The connection and provider.
   * @returns the current mirror state.
   */
  mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult>;

  /**
   * Link a Docket resource to an external resource.
   *
   * @param input - The connection and the two resource ids.
   * @returns whether the link was established and the external URL.
   */
  linkResource(input: LinkResourceInput): Promise<LinkResult>;
}
