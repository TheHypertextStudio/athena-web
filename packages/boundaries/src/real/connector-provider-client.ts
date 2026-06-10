import type {
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
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
}
