import type {
  ExternalWriteResult,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
  TaskPushOp,
} from '../ports/connector';
import type {
  FetchThreadInput,
  ListThreadsInput,
  MailActionInput,
  MailListPage,
  MailThread,
} from '../ports/mail';

/**
 * The provider-specific half of the connector: each method maps the port's
 * provider-agnostic request onto one provider API call and normalizes the response.
 *
 * @remarks
 * Implemented once per provider/product ({@link GitHubProviderClient},
 * {@link LinearProviderClient}, the per-product Google clients, `GmailProviderClient`);
 * {@link RealConnector} dispatches to the right one via the factory registry.
 */
export interface ConnectorProviderClient {
  /**
   * Validate the OAuth credential by resolving the external account identity.
   *
   * @returns the account's display label (login, email, or name), or `undefined` on failure.
   */
  resolveAccount(): Promise<string | undefined>;
  /**
   * Import all work items from the provider, each carrying provenance metadata.
   *
   * @param input - The connection scope (id, provider, optional workspace).
   * @param importedAt - ISO-8601 timestamp stamped onto each item's provenance.
   */
  importWork(input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]>;
  /**
   * Report the current read-only mirror sync state for a connection without mutating anything.
   *
   * @param input - The connection to inspect.
   */
  mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult>;
  /**
   * Derive the canonical external URL for a linked resource from its external id.
   *
   * @param input - The resource's provider and external id.
   * @returns the URL string, or `undefined` if it cannot be derived from the id alone.
   */
  resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined>;
  /**
   * Enumerate the provider's external containers (e.g. Google Tasks lists) for selection.
   *
   * @remarks
   * Required so {@link RealConnector} can call it without a runtime capability check: providers
   * with no container concept (GitHub/Linear) return an empty array.
   */
  listContainers(): Promise<ResourceRef[]>;
}

/**
 * The write-capable provider client (today `GoogleTasksProviderClient`).
 *
 * @remarks
 * Extends the read-only {@link ConnectorProviderClient} with a single `pushTask` that applies
 * one {@link TaskPushOp} to the provider. Kept as a *separate* interface so the read-only
 * providers (GitHub/Linear/Drive/Gmail/Calendar) implement nothing extra; `RealConnector`
 * narrows via {@link isWritableProviderClient} — purely structural — and exposes it through
 * {@link Connector.asWritable}. Membership must agree with the `WRITE_BACK_CAPABLE_PROVIDERS`
 * manifest (a boundary test enforces it).
 */
export interface WritableConnectorProviderClient extends ConnectorProviderClient {
  /**
   * Apply one write op to the provider.
   *
   * @param op - The create/update/delete change to apply.
   * @returns the post-write external timestamp/etag for `create`/`update`, `undefined` for `delete`.
   * @throws {ConnectorError} On auth, throttle, or provider failure.
   */
  pushTask(op: TaskPushOp): Promise<ExternalWriteResult | undefined>;
}

/** Narrow a {@link ConnectorProviderClient} to a {@link WritableConnectorProviderClient}. */
export function isWritableProviderClient(
  client: ConnectorProviderClient,
): client is WritableConnectorProviderClient {
  return typeof (client as Partial<WritableConnectorProviderClient>).pushTask === 'function';
}

/**
 * The mail-capable provider client (today `GmailProviderClient`; Outlook/Graph next).
 *
 * @remarks
 * Extends the read-only client with incremental thread listing, mailbox mutation, and
 * on-demand thread fetch. Kept as a separate interface so non-mail providers implement
 * nothing extra; `RealConnector` narrows via {@link isMailActionsProviderClient} — purely
 * structural, no provider literals — and exposes it through
 * {@link import('../ports/connector').Connector.asMailActor}. Membership must agree with
 * the `MAIL_CAPABLE_PROVIDERS` manifest (a boundary test enforces it).
 */
export interface MailActionsProviderClient extends ConnectorProviderClient {
  /**
   * List mailbox threads as ingest summaries, incrementally when a cursor is supplied.
   *
   * @param input - The connection, optional resume cursor, and page bound.
   * @returns a page + next cursor, or `cursorExpired` on a stale cursor.
   * @throws {ConnectorError} On auth, throttle, or provider failure.
   */
  listThreads(input: ListThreadsInput): Promise<MailListPage>;
  /**
   * Apply one mailbox action to a thread.
   *
   * @param input - The connection, provider, thread, and action.
   * @throws {ConnectorError} On auth, throttle, or provider failure.
   */
  applyMailAction(input: MailActionInput): Promise<void>;
  /**
   * Fetch a thread for on-demand rendering (the body is never persisted).
   *
   * @param input - The connection and thread id.
   * @returns the render-ready thread.
   */
  fetchThread(input: FetchThreadInput): Promise<MailThread>;
}

/** Narrow a {@link ConnectorProviderClient} to a {@link MailActionsProviderClient}. */
export function isMailActionsProviderClient(
  client: ConnectorProviderClient,
): client is MailActionsProviderClient {
  return typeof (client as Partial<MailActionsProviderClient>).applyMailAction === 'function';
}
