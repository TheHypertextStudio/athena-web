/**
 * `@docket/boundaries/real` — `RealConnector` + the concrete provider clients.
 *
 * @remarks
 * The env-driven {@link Connector} that talks to a third-party provider's API with an
 * OAuth token (or personal API key). Selected only when its token is present and
 * real-shaped (see {@link selectAdapter}) and never in `APP_MODE ∈ {local,test}`. The
 * token comes from the resolved connection credential; the network edge goes through an
 * injectable {@link HttpClient}.
 *
 * One {@link RealConnector} fronts every provider but delegates the actual API shape to
 * a per-provider {@link ConnectorProviderClient}:
 *
 * - **GitHub** — REST (Octokit-compatible): the authenticated user, issues/PRs as
 *   importable work, and link resolution to the canonical `html_url`.
 * - **Linear** — GraphQL: the `viewer`, the migration import of issues
 *   (`id`/`identifier`/`title`/`description`/`url`), and link resolution.
 * - **Drive / Gmail / Calendar / Google Tasks** — Google REST APIs with an OAuth bearer
 *   token, used for the read-only work/link/mirror/signal surface.
 *
 * The Migration-vs-Connector + import/mirror business logic lives in the app layer —
 * this is only the provider I/O edge (`boundaries.md` §5). Every request-building and
 * response-mapping path here is pure and unit-tested through the injected client; only
 * the real network call (in {@link defaultHttpClient}) is the untestable IO edge.
 */
import type {
  ConnectInput,
  ConnectionResult,
  Connector,
  ConnectorProvider,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  LinkResult,
  ListContainersInput,
  MailActions,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
  WritableConnector,
} from '../ports/connector';
import { defaultHttpClient, type HttpClient } from './http';
import { GitHubProviderClient } from './connector-github';
import { LinearProviderClient } from './connector-linear';
import { GoogleProviderClient } from './connector-google';
import { ProviderHttp } from './connector-http';
import {
  isMailActionsProviderClient,
  isWritableProviderClient,
  type ConnectorProviderClient,
} from './connector-provider-client';
export type { GoogleProduct } from './connector-google';
export type { ConnectorProviderClient } from './connector-provider-client';
export { GitHubProviderClient, LinearProviderClient, GoogleProviderClient };

/** Validated configuration for {@link RealConnector} (sourced from the connection credential + env). */
export interface RealConnectorConfig {
  /** The provider this connector targets. */
  readonly provider: ConnectorProvider;
  /** OAuth access token (or provider API key) for the provider, from the connection credential. */
  readonly accessToken: string;
  /**
   * API base URL override for the provider (e.g. a GitHub Enterprise / self-hosted
   * host). Defaults to the provider's public API base.
   */
  readonly apiBase?: string;
}

/** The default public API base per provider. */
export const PROVIDER_API_BASE: Readonly<Record<ConnectorProvider, string>> = {
  github: 'https://api.github.com',
  linear: 'https://api.linear.app',
  drive: 'https://www.googleapis.com/drive/v3',
  gmail: 'https://gmail.googleapis.com/gmail/v1',
  calendar: 'https://www.googleapis.com/calendar/v3',
  gtasks: 'https://tasks.googleapis.com/tasks/v1',
};

/**
 * Build the concrete {@link ConnectorProviderClient} for a provider.
 *
 * @param config - The provider, token, and API base.
 * @param http - The injected HTTP transport.
 * @returns the provider-specific client.
 */
export function createProviderClient(
  config: Required<Pick<RealConnectorConfig, 'provider' | 'accessToken'>> & { apiBase: string },
  http: HttpClient,
): ConnectorProviderClient {
  const providerHttp = new ProviderHttp(config.provider, config.apiBase, config.accessToken, http);
  switch (config.provider) {
    case 'github':
      return new GitHubProviderClient(providerHttp);
    case 'linear':
      return new LinearProviderClient(providerHttp);
    case 'drive':
    case 'gmail':
    case 'calendar':
    case 'gtasks':
      return new GoogleProviderClient(config.provider, providerHttp);
    /* v8 ignore start -- unreachable exhaustiveness guard */
    default: {
      throw new Error(`Unknown connector provider: ${String(config.provider)}`);
    }
    /* v8 ignore stop */
  }
}

/**
 * A real, env-driven connector to a single third-party provider.
 *
 * @remarks
 * Fronts every provider behind the one {@link Connector} port and dispatches each
 * method to the provider-specific {@link ConnectorProviderClient}. The connection id is
 * derived deterministically from the provider and scope; `connect` validates the
 * credential by resolving the external account; `importWork`/`mirrorStatus`/`linkResource`
 * delegate to the provider client and normalize into the port's provider-agnostic shapes
 * with provenance.
 */
export class RealConnector implements Connector {
  private readonly provider: ConnectorProvider;
  private readonly client: ConnectorProviderClient;

  /**
   * @param config - The provider, OAuth token / API key, and optional API base.
   * @param http - HTTP transport (defaults to the platform `fetch`).
   */
  constructor(config: RealConnectorConfig, http: HttpClient = defaultHttpClient) {
    this.provider = config.provider;
    const apiBase = config.apiBase ?? PROVIDER_API_BASE[config.provider];
    this.client = createProviderClient(
      { provider: config.provider, accessToken: config.accessToken, apiBase },
      http,
    );
  }

  /**
   * {@inheritDoc Connector.connect}
   *
   * @remarks
   * Validates the credential by actually calling the provider's identity endpoint. A
   * successful call returns `status: 'connected'` (with the account label when the provider
   * supplies one); a failure THROWS a {@link ConnectorError} so the caller records the real
   * reason — it never reports a healthy connection that wasn't proven. A resolved-but-unlabeled
   * account (valid token, no display name) is still `connected`: the credential worked.
   */
  async connect(input: ConnectInput): Promise<ConnectionResult> {
    const account = await this.client.resolveAccount();
    return {
      connectionId: `${input.provider}:${input.referenceId}`,
      provider: input.provider,
      status: 'connected',
      ...(account !== undefined ? { account } : {}),
    };
  }

  /** {@inheritDoc Connector.importWork} */
  async importWork(input: ImportWorkInput): Promise<ImportedItem[]> {
    const importedAt = new Date().toISOString();
    return this.client.importWork(input, importedAt);
  }

  /** {@inheritDoc Connector.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    return this.client.mirrorStatus(input);
  }

  /**
   * {@inheritDoc Connector.linkResource}
   *
   * @remarks
   * `resolveExternalUrl` returning `undefined` means the canonical URL can't be derived from
   * the id alone (a legitimate, non-error state) — the link is still established. A real
   * provider/network failure THROWS a {@link ConnectorError} rather than being swallowed into
   * a false `linked: true`, which is what previously hid link failures.
   */
  async linkResource(input: LinkResourceInput): Promise<LinkResult> {
    const externalUrl = await this.client.resolveExternalUrl(input);
    return {
      resourceId: input.resourceId,
      externalId: input.externalId,
      ...(externalUrl !== undefined ? { externalUrl } : {}),
      linked: true,
    };
  }

  /**
   * {@inheritDoc Connector.asWritable}
   *
   * @remarks
   * Two-way write-back is gated on BOTH the provider being `gtasks` AND the underlying client
   * implementing `pushTask`: `GoogleProviderClient` is shared across Drive/Gmail/Calendar/Tasks,
   * so the provider check keeps write-back exposed only for Google Tasks even though the others
   * share the class.
   */
  asWritable(): WritableConnector | undefined {
    if (this.provider !== 'gtasks') return undefined;
    const client = this.client;
    if (!isWritableProviderClient(client)) return undefined;
    return {
      pushTask: (input) => client.pushTask(input.op),
    };
  }

  /**
   * {@inheritDoc Connector.asMailActor}
   *
   * @remarks
   * Gated on BOTH the provider being `gmail` AND the client implementing the mail methods —
   * mirroring {@link RealConnector.asWritable}. `GoogleProviderClient` is shared across the
   * Google products, so the provider check keeps mailbox actions exposed for Gmail only.
   */
  asMailActor(): MailActions | undefined {
    if (this.provider !== 'gmail') return undefined;
    const client = this.client;
    if (!isMailActionsProviderClient(client)) return undefined;
    return {
      applyMailAction: (input) => client.applyMailAction(input),
      fetchThread: (input) => client.fetchThread(input),
    };
  }

  /**
   * {@inheritDoc Connector.listContainers}
   *
   * @remarks
   * Gated to `gtasks` (the only provider with a container concept) AND the client implementing
   * `listContainers`, mirroring {@link RealConnector.asWritable}.
   */
  async listContainers(_input: ListContainersInput): Promise<ResourceRef[]> {
    if (this.provider !== 'gtasks') return [];
    return this.client.listContainers();
  }
}
