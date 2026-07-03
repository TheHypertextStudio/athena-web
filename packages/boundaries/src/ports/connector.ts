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
 * §5). The mail capability's types live in `./mail`.
 */
import type { MailActions } from './mail';
import type { WorkGraphConnector } from './work-graph';

/**
 * The external providers Docket can connect to.
 *
 * @remarks
 * `gtasks` is Google Tasks (the user's personal to-dos), distinct from `calendar`
 * (Google Calendar events) and the Google document/mail surfaces (`drive`/`gmail`).
 * `outlook` is Microsoft Outlook mail via the Graph API (dormant until the Microsoft
 * OAuth credentials are configured — `/v1/config` hides unconfigured providers).
 */
export type ConnectorProvider =
  | 'github'
  | 'drive'
  | 'linear'
  | 'gmail'
  | 'calendar'
  | 'gtasks'
  | 'outlook';

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
  /**
   * The provider's external workspace/organization id, when known.
   *
   * @remarks
   * For Linear, this is the organization id — the webhook routing key that identifies which
   * connection an inbound webhook belongs to.
   */
  readonly externalWorkspaceId?: string;
  /**
   * The provider's external workspace/organization URL slug, when known.
   *
   * @remarks
   * For Linear, this is the `urlKey` — used to build canonical external URLs.
   */
  readonly externalWorkspaceSlug?: string;
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
  /**
   * The provider's own last-modified timestamp (RFC3339), when it exposes one.
   *
   * @remarks
   * The last-write-wins anchor for two-way sync: stored per task and compared against the
   * local `updatedAt` to decide which side is newer. Absent for read-only mirror providers.
   */
  readonly externalUpdatedAt?: string;
  /** The provider's entity tag for optimistic-concurrency writes, when available. */
  readonly externalEtag?: string;
  /**
   * The owning external collection id, when the provider partitions items into lists.
   *
   * @remarks
   * Google Tasks groups tasks under task lists; this records which list a task came from so a
   * write-back can address the correct `/lists/{listId}/tasks/{taskId}`.
   */
  readonly externalListId?: string;
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
  /** Whether the source item is completed/done (work items that carry a status). */
  readonly completed?: boolean;
  /** Due date (RFC3339 date) when the source carries one; `null` means explicitly unset. */
  readonly dueDate?: string | null;
  /**
   * True when this item is a tombstone — deleted at the source — rather than live content.
   *
   * @remarks
   * Two-way pulls surface deletions as tombstones (e.g. Google Tasks `showDeleted=true`) so a
   * remote delete propagates as data instead of as absence; reconciliation archives the local
   * linked task. Read-only mirror imports never set this.
   */
  readonly removed?: boolean;
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
  /**
   * Optional external container ids to scope the import to (e.g. Google Tasks list ids). When
   * absent or empty, every container is imported; when present, only the listed ones are pulled.
   */
  readonly listIds?: readonly string[];
}

/** A selectable external container (e.g. a Google Tasks list) the connector can sync from. */
export interface ResourceRef {
  /** The container's external id. */
  readonly id: string;
  /** A human-readable label for the container. */
  readonly title: string;
}

/** Input to enumerate a connector's external containers (task lists). */
export interface ListContainersInput {
  /** The connection whose containers are requested. */
  readonly connectionId: string;
  /** The provider being enumerated. */
  readonly provider: ConnectorProvider;
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
 * A single write operation pushed back to a writable provider (two-way sync).
 *
 * @remarks
 * Round-trip only: a `linked` Docket task always already has an `externalId`, so `create`
 * is defined for completeness but unused by the current Google Tasks write-back path. Every
 * variant carries `listId` because Google Tasks addresses tasks within a list.
 */
export type TaskPushOp =
  | {
      readonly kind: 'create';
      readonly listId: string;
      readonly title: string;
      readonly notes?: string | null;
      readonly dueDate?: string | null;
      readonly completed: boolean;
    }
  | {
      readonly kind: 'update';
      readonly listId: string;
      readonly externalId: string;
      readonly etag?: string;
      readonly title?: string;
      readonly notes?: string | null;
      readonly dueDate?: string | null;
      readonly completed?: boolean;
    }
  | {
      readonly kind: 'delete';
      readonly listId: string;
      readonly externalId: string;
    };

/** The provider's acknowledgement of a successful write, carrying the new sync anchors. */
export interface ExternalWriteResult {
  /** The external id of the written item (echoed for `update`, assigned for `create`). */
  readonly externalId: string;
  /** The provider's post-write last-modified timestamp (RFC3339) — the new echo guard. */
  readonly externalUpdatedAt: string;
  /** The provider's post-write entity tag, when available. */
  readonly externalEtag?: string;
}

/** Input to push one task change to a writable provider. */
export interface PushTaskInput {
  /** The connection performing the write. */
  readonly connectionId: string;
  /** The provider being written to. */
  readonly provider: ConnectorProvider;
  /** The change to apply. */
  readonly op: TaskPushOp;
}

/**
 * The write half of a two-way connector: pushes a local task change back to the provider.
 *
 * @remarks
 * Exposed only by connectors that support write-back (today, Google Tasks), discovered via
 * {@link Connector.asWritable}. Read-only connectors return `undefined` there and never
 * implement this. A `delete` op resolves to `undefined` — no entity remains to anchor.
 */
export interface WritableConnector {
  /**
   * Apply one write to the provider and return the post-write sync anchors.
   *
   * @param input - The connection, provider, and the change to apply.
   * @returns the new external timestamp/etag for `create`/`update`, or `undefined` for `delete`.
   * @throws {ConnectorError} On auth (`auth`), throttle (`rate_limit`), or provider failure.
   */
  pushTask(input: PushTaskInput): Promise<ExternalWriteResult | undefined>;
}

/**
 * The providers whose connectors expose task write-back (two-way sync).
 *
 * @remarks
 * The declarative manifest consumed by the mock connector's capability gate and by
 * app-layer write-back gating. Sibling of `MAIL_CAPABLE_PROVIDERS` (`./mail`): mailbox
 * mutation is a separate capability, so a mail provider never joins this set. The real
 * connectors' capability is structural (the client implements the writable provider-client
 * interface); a boundary test asserts manifest ⇔ structure agree.
 */
export const WRITE_BACK_CAPABLE_PROVIDERS: ReadonlySet<ConnectorProvider> =
  new Set<ConnectorProvider>(['gtasks']);

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

  /**
   * Return this connector's write-back capability, or `undefined` when it is read-only.
   *
   * @remarks
   * The single typed seam the sync engine uses to detect two-way support: read-only
   * connectors (GitHub/Linear/Drive/Gmail/Calendar) omit it or return `undefined`, and only
   * a write-back connector (Google Tasks) returns a {@link WritableConnector}.
   */
  asWritable?(): WritableConnector | undefined;

  /**
   * Return this connector's mailbox-actions capability, or `undefined` when it is not a mail
   * provider.
   *
   * @remarks
   * The single typed seam for mailbox write-back + on-demand thread fetch, discovered exactly
   * like {@link Connector.asWritable}. Only a mail connector (Gmail) returns a
   * {@link MailActions}; every other provider omits it or returns `undefined`.
   */
  asMailActor?(): MailActions | undefined;

  /**
   * Return this connector's work-graph capability, or `undefined` when the provider has no
   * rich work-graph concept.
   *
   * @remarks
   * The single typed seam for a rich pull of a provider workspace's
   * users/labels/projects/cycles/work-items plus field-level push mutations, discovered
   * exactly like {@link Connector.asWritable} and {@link Connector.asMailActor}. Only a
   * work-graph-capable connector (today, Linear) returns a {@link WorkGraphConnector}; every
   * other provider omits it or returns `undefined`.
   */
  asWorkGraph?(): WorkGraphConnector | undefined;

  /**
   * Enumerate the external containers (e.g. Google Tasks lists) this connection can sync from,
   * for the per-account "which lists to sync" config UI.
   *
   * @remarks
   * Optional: only connectors with a meaningful container concept (today Google Tasks) implement
   * it; the rest omit it. Read-only — never mutates the provider.
   *
   * @param input - The connection and provider to enumerate.
   * @returns the selectable containers; an empty array when the connection has none.
   */
  listContainers?(input: ListContainersInput): Promise<ResourceRef[]>;
}
