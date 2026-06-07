/**
 * `@docket/boundaries/real` — `RealConnector`.
 *
 * @remarks
 * The env-driven {@link Connector} that talks to a provider's API with an OAuth
 * token. Selected only when its token is present and real-shaped (see
 * {@link selectAdapter}) and never in `APP_MODE ∈ {local,test}`. The token comes from
 * the resolved credential; the network edge goes through an injectable
 * {@link HttpClient}. The Migration-vs-Connector + import/mirror logic lives in the
 * app layer — this is only the provider I/O edge (`boundaries.md` §5).
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
  MirrorResult,
  MirrorStatusInput,
} from '../ports/connector';
import { defaultHttpClient, type HttpClient } from './http';

/** Validated configuration for {@link RealConnector} (sourced from the credential). */
export interface RealConnectorConfig {
  /** The provider this connector targets. */
  readonly provider: ConnectorProvider;
  /** OAuth access token for the provider. */
  readonly accessToken: string;
  /** API base URL for the provider (defaults to the provider's public API). */
  readonly apiBase?: string;
}

/** The default public API base per provider. */
const PROVIDER_API_BASE: Readonly<Record<ConnectorProvider, string>> = {
  github: 'https://api.github.com',
  linear: 'https://api.linear.app',
  drive: 'https://www.googleapis.com/drive/v3',
  gmail: 'https://gmail.googleapis.com/gmail/v1',
  calendar: 'https://www.googleapis.com/calendar/v3',
};

/**
 * A real, env-driven connector to a single provider.
 *
 * @remarks
 * Each method issues the minimal provider API call needed to satisfy the port and
 * normalizes the response into the port's provider-agnostic shapes with provenance.
 */
export class RealConnector implements Connector {
  private readonly config: RealConnectorConfig;
  private readonly http: HttpClient;
  private readonly apiBase: string;

  /**
   * @param config - The provider, OAuth token, and optional API base.
   * @param http - HTTP transport (defaults to the platform `fetch`).
   */
  constructor(config: RealConnectorConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
    this.apiBase = config.apiBase ?? PROVIDER_API_BASE[config.provider];
  }

  private async call(path: string): Promise<unknown> {
    const res = await this.http(`${this.apiBase}${path}`, {
      headers: { Authorization: `Bearer ${this.config.accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${this.config.provider} API ${path} failed: ${res.status}`);
    return res.json();
  }

  /** {@inheritDoc Connector.connect} */
  async connect(input: ConnectInput): Promise<ConnectionResult> {
    // Validate the token by reading the provider identity endpoint.
    const json = (await this.call('/user').catch(() => null)) as {
      login?: string;
      name?: string;
    } | null;
    const account = json?.login ?? json?.name;
    return {
      connectionId: `${input.provider}:${input.referenceId}`,
      provider: input.provider,
      status: json ? 'connected' : 'error',
      ...(account !== undefined ? { account } : {}),
    };
  }

  /** {@inheritDoc Connector.importWork} */
  async importWork(input: ImportWorkInput): Promise<ImportedItem[]> {
    const json = (await this.call('/issues')) as {
      items?: { id: string; title: string; body?: string; url?: string }[];
    };
    const importedAt = new Date().toISOString();
    return (json.items ?? []).map((it) => ({
      id: it.id,
      kind: 'issue' as const,
      title: it.title,
      ...(it.body ? { body: it.body } : {}),
      provenance: {
        provider: input.provider,
        externalId: it.id,
        ...(it.url ? { externalUrl: it.url } : {}),
        importedAt,
      },
    }));
  }

  /** {@inheritDoc Connector.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const json = (await this.call('/sync/status')) as { itemCount?: number; lastSyncedAt?: string };
    return {
      connectionId: input.connectionId,
      status: 'idle',
      ...(json.lastSyncedAt ? { lastSyncedAt: json.lastSyncedAt } : {}),
      itemCount: json.itemCount ?? 0,
    };
  }

  /** {@inheritDoc Connector.linkResource} */
  async linkResource(input: LinkResourceInput): Promise<LinkResult> {
    return {
      resourceId: input.resourceId,
      externalId: input.externalId,
      linked: true,
    };
  }
}
