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

/**
 * The provider-specific half of the connector: each method maps the port's
 * provider-agnostic request onto one provider API call and normalizes the response.
 *
 * @remarks
 * Implemented once per provider ({@link GitHubProviderClient}, {@link LinearProviderClient},
 * {@link GoogleProviderClient}); {@link RealConnector} dispatches to the right one.
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
 * The write-capable provider client (today only {@link GoogleProviderClient} for Google Tasks).
 *
 * @remarks
 * Extends the read-only {@link ConnectorProviderClient} with a single `pushTask` that applies
 * one {@link TaskPushOp} to the provider. Kept as a *separate* interface so the read-only
 * providers (GitHub/Linear/Drive/Gmail/Calendar) implement nothing extra; `RealConnector`
 * narrows to it for `gtasks` via {@link isWritableProviderClient} and exposes it through
 * {@link Connector.asWritable}.
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
