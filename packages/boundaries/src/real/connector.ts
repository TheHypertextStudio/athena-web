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
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
  WritableConnector,
} from '../ports/connector';
import type { MailActions } from '../ports/mail';
import { defaultHttpClient, type HttpClient } from './http';
import { GitHubProviderClient } from './connector-github';
import { LinearProviderClient } from './connector-linear';
import {
  GoogleCalendarProviderClient,
  GoogleDriveProviderClient,
  GoogleTasksProviderClient,
} from './connector-google';
import { GmailProviderClient } from './connector-gmail';
import { MicrosoftProviderClient } from './connector-microsoft';
import { ProviderHttp } from './connector-http';
import {
  isMailActionsProviderClient,
  isWritableProviderClient,
  type ConnectorProviderClient,
} from './connector-provider-client';
export type { GoogleProduct } from './connector-google';
export type { ConnectorProviderClient } from './connector-provider-client';
export {
  GitHubProviderClient,
  LinearProviderClient,
  GoogleCalendarProviderClient,
  GoogleDriveProviderClient,
  GoogleTasksProviderClient,
};
export { GmailProviderClient } from './connector-gmail';
export { MicrosoftProviderClient } from './connector-microsoft';

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
  outlook: 'https://graph.microsoft.com/v1.0',
};

/**
 * The per-provider client factories — the single declarative registry of which concrete
 * client fronts each provider.
 *
 * @remarks
 * `Record<ConnectorProvider, …>` so adding a provider to the union forces an entry here
 * (a compile error, not a runtime throw). Capability is carried by the client's shape:
 * a provider is mail-capable iff its client implements `MailActionsProviderClient`,
 * write-capable iff it implements `WritableConnectorProviderClient` — discovered by the
 * structural guards, never by provider literals.
 */
export const PROVIDER_CLIENT_FACTORIES: Readonly<
  Record<ConnectorProvider, (http: ProviderHttp) => ConnectorProviderClient>
> = {
  github: (http) => new GitHubProviderClient(http),
  linear: (http) => new LinearProviderClient(http),
  drive: (http) => new GoogleDriveProviderClient(http),
  gmail: (http) => new GmailProviderClient(http),
  calendar: (http) => new GoogleCalendarProviderClient(http),
  gtasks: (http) => new GoogleTasksProviderClient(http),
  outlook: (http) => new MicrosoftProviderClient(http),
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
  return PROVIDER_CLIENT_FACTORIES[config.provider](providerHttp);
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
   * Structural discovery: the capability exists iff the provider's client implements the
   * writable provider-client interface. Per-product clients mean no provider literal is
   * needed — only `GoogleTasksProviderClient` implements `pushTask`.
   */
  asWritable(): WritableConnector | undefined {
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
   * Structural discovery, mirroring {@link RealConnector.asWritable}: the capability exists
   * iff the provider's client implements `MailActionsProviderClient` (today
   * `GmailProviderClient`).
   */
  asMailActor(): MailActions | undefined {
    const client = this.client;
    if (!isMailActionsProviderClient(client)) return undefined;
    return {
      listThreads: (input) => client.listThreads(input),
      applyMailAction: (input) => client.applyMailAction(input),
      fetchThread: (input) => client.fetchThread(input),
    };
  }

  /**
   * {@inheritDoc Connector.listContainers}
   *
   * @remarks
   * Always delegates: the base provider-client contract has clients without a container
   * concept return an empty array, so no provider gate is needed.
   */
  async listContainers(_input: ListContainersInput): Promise<ResourceRef[]> {
    return this.client.listContainers();
  }
}
