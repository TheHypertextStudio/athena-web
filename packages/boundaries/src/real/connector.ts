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
 * - **Drive / Gmail / Calendar** — Google REST APIs with an OAuth bearer token, used
 *   for the read-only link/mirror/signal surface.
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
  MirrorResult,
  MirrorStatusInput,
} from '../ports/connector';
import { defaultHttpClient, type HttpClient } from './http';

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
};

/**
 * The provider-specific half of the connector: each method maps the port's
 * provider-agnostic request onto one provider API call and normalizes the response.
 *
 * @remarks
 * Implemented once per provider ({@link GitHubProviderClient}, {@link LinearProviderClient},
 * {@link GoogleProviderClient}); {@link RealConnector} dispatches to the right one.
 */
export interface ConnectorProviderClient {
  /** Validate the credential and return the external account label, if any. */
  resolveAccount(): Promise<string | undefined>;
  /** Import the provider's work items, each carrying provenance. */
  importWork(input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]>;
  /** Report the read-only mirror sync state for the connection. */
  mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult>;
  /** Resolve and return the canonical external URL for a link, if derivable. */
  resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined>;
}

/** A small typed wrapper around the injected {@link HttpClient} for one provider. */
class ProviderHttp {
  /**
   * @param provider - The provider these calls target (used in error messages).
   * @param apiBase - The provider API base (no trailing slash assumptions).
   * @param accessToken - The bearer token / API key (never logged).
   * @param http - The injected HTTP transport.
   */
  constructor(
    private readonly provider: ConnectorProvider,
    private readonly apiBase: string,
    private readonly accessToken: string,
    private readonly http: HttpClient,
  ) {}

  /** Issue an authenticated `GET` and parse JSON, surfacing non-2xx as a clear error. */
  async getJson(path: string, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const res = await this.http(`${this.apiBase}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        ...extraHeaders,
      },
    });
    if (!res.ok) {
      throw new Error(`${this.provider} API GET ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  /** Issue an authenticated `POST` of a JSON body and parse JSON, surfacing non-2xx as a clear error. */
  async postJson(path: string, body: unknown, auth: 'bearer' | 'raw' = 'bearer'): Promise<unknown> {
    const res = await this.http(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        Authorization: auth === 'bearer' ? `Bearer ${this.accessToken}` : this.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${this.provider} API POST ${path} failed: ${res.status}`);
    }
    return res.json();
  }
}

/** Shape of one GitHub issue/PR as returned by the GitHub REST issues endpoints. */
interface GitHubIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body?: string | null;
  readonly html_url: string;
  readonly pull_request?: unknown;
}

/**
 * The GitHub connector client (REST, Octokit-compatible shapes).
 *
 * @remarks
 * `resolveAccount` reads `GET /user` (`login`); `importWork` reads the authenticated
 * user's issues (`GET /issues`, which the REST API also returns PRs in — both are
 * importable units of work); `mirrorStatus` derives a lightweight count from the same
 * listing; `resolveExternalUrl` reconstructs the canonical `https://github.com/...` URL
 * from `owner/repo#number`-style external ids.
 */
export class GitHubProviderClient implements ConnectorProviderClient {
  /** @param http - The provider HTTP wrapper bound to GitHub. */
  constructor(private readonly http: ProviderHttp) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<string | undefined> {
    const json = (await this.http.getJson('/user')) as { login?: string; name?: string };
    return json.login ?? json.name;
  }

  /** Map a raw GitHub issue onto an {@link ImportedItem}. */
  private toItem(issue: GitHubIssue, importedAt: string): ImportedItem {
    return {
      id: String(issue.id),
      kind: 'issue',
      title: issue.title,
      ...(issue.body ? { body: issue.body } : {}),
      provenance: {
        provider: 'github',
        externalId: String(issue.number),
        externalUrl: issue.html_url,
        importedAt,
      },
    };
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const json = (await this.http.getJson('/issues?filter=all&state=open&per_page=100')) as
      | GitHubIssue[]
      | undefined;
    if (!Array.isArray(json)) return [];
    return json.map((issue) => this.toItem(issue, importedAt));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const json = (await this.http.getJson('/issues?filter=all&state=all&per_page=100')) as
      | GitHubIssue[]
      | undefined;
    return {
      connectionId: input.connectionId,
      status: 'idle',
      itemCount: Array.isArray(json) ? json.length : 0,
    };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    // `externalId` is `owner/repo#number` (or `owner/repo` for the repo itself).
    const match = /^([^/]+\/[^#]+)#(\d+)$/.exec(input.externalId);
    if (match) return `https://github.com/${match[1]}/issues/${match[2]}`;
    if (/^[^/]+\/[^/]+$/.test(input.externalId)) return `https://github.com/${input.externalId}`;
    return undefined;
  }
}

/** Shape of one Linear issue node as returned by the GraphQL issues query. */
interface LinearIssueNode {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description?: string | null;
  readonly url: string;
}

/**
 * The Linear connector client (GraphQL).
 *
 * @remarks
 * `resolveAccount` runs `{ viewer { name email } }`; `importWork` runs the migration
 * import query (`issues { nodes { id identifier title description url } }`);
 * `mirrorStatus` reuses the import query to size the mirror; `resolveExternalUrl`
 * derives the canonical Linear issue URL from the `WORKSPACE/IDENTIFIER` external id.
 * Every call is a single `POST /graphql` with a `Bearer` token.
 */
export class LinearProviderClient implements ConnectorProviderClient {
  /** {@link viewer} query: the authenticated identity. */
  private static readonly VIEWER_QUERY = '{ viewer { id name email } }';

  /** Migration import query: every issue with the fields the import maps. */
  private static readonly ISSUES_QUERY =
    '{ issues(first: 100) { nodes { id identifier title description url } } }';

  /** @param http - The provider HTTP wrapper bound to Linear. */
  constructor(private readonly http: ProviderHttp) {}

  /** Run one GraphQL query and return its `data` payload, surfacing GraphQL errors. */
  private async query<T>(query: string): Promise<T> {
    const json = (await this.http.postJson('/graphql', { query })) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (json.errors && json.errors.length > 0) {
      throw new Error(`linear GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    if (json.data === undefined) {
      throw new Error('linear GraphQL response missing data');
    }
    return json.data;
  }

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<string | undefined> {
    const data = await this.query<{ viewer?: { name?: string; email?: string } }>(
      LinearProviderClient.VIEWER_QUERY,
    );
    return data.viewer?.name ?? data.viewer?.email;
  }

  /** Map a raw Linear issue node onto an {@link ImportedItem}. */
  private toItem(node: LinearIssueNode, importedAt: string): ImportedItem {
    return {
      id: node.id,
      kind: 'issue',
      title: node.title,
      ...(node.description ? { body: node.description } : {}),
      provenance: {
        provider: 'linear',
        externalId: node.identifier,
        externalUrl: node.url,
        importedAt,
      },
    };
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const data = await this.query<{ issues?: { nodes?: LinearIssueNode[] } }>(
      LinearProviderClient.ISSUES_QUERY,
    );
    const nodes = data.issues?.nodes ?? [];
    return nodes.map((node) => this.toItem(node, importedAt));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const data = await this.query<{ issues?: { nodes?: LinearIssueNode[] } }>(
      LinearProviderClient.ISSUES_QUERY,
    );
    return {
      connectionId: input.connectionId,
      status: 'idle',
      itemCount: data.issues?.nodes?.length ?? 0,
    };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    // `externalId` is `WORKSPACE/IDENTIFIER` (e.g. `docket/DOC-7`).
    const match = /^([^/]+)\/([A-Z0-9]+-\d+)$/.exec(input.externalId);
    if (!match) return undefined;
    return `https://linear.app/${match[1]}/issue/${match[2]}`;
  }
}

/** The Google product a {@link GoogleProviderClient} targets. */
type GoogleProduct = Extract<ConnectorProvider, 'drive' | 'gmail' | 'calendar'>;

/**
 * The Google connector client (Drive / Gmail / Calendar REST, OAuth bearer).
 *
 * @remarks
 * Google's products are read here for the link/mirror/signal surface rather than a
 * full migration import: `resolveAccount` reads the product's identity endpoint;
 * `importWork` lists the product's primary collection (Drive files, Gmail messages,
 * Calendar events) and normalizes each into an {@link ImportedItem}; `mirrorStatus`
 * sizes the same listing; `resolveExternalUrl` reconstructs the canonical product URL.
 * One {@link GoogleProviderClient} is parameterized by the concrete product so the
 * three providers share the bearer-token transport and mapping scaffolding.
 */
export class GoogleProviderClient implements ConnectorProviderClient {
  /**
   * @param product - Which Google product this client targets.
   * @param http - The provider HTTP wrapper bound to the product's API base.
   */
  constructor(
    private readonly product: GoogleProduct,
    private readonly http: ProviderHttp,
  ) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<string | undefined> {
    if (this.product === 'drive') {
      const json = (await this.http.getJson('/about?fields=user')) as {
        user?: { emailAddress?: string; displayName?: string };
      };
      return json.user?.emailAddress ?? json.user?.displayName;
    }
    if (this.product === 'gmail') {
      const json = (await this.http.getJson('/users/me/profile')) as { emailAddress?: string };
      return json.emailAddress;
    }
    // calendar — the primary calendar's id is the user's email address.
    const json = (await this.http.getJson('/calendars/primary')) as {
      id?: string;
      summary?: string;
    };
    return json.id ?? json.summary;
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    if (this.product === 'drive') return this.importDrive(importedAt);
    if (this.product === 'gmail') return this.importGmail(importedAt);
    return this.importCalendar(importedAt);
  }

  /** List Drive files and map them onto document {@link ImportedItem}s. */
  private async importDrive(importedAt: string): Promise<ImportedItem[]> {
    const json = (await this.http.getJson(
      '/files?fields=files(id,name,webViewLink)&pageSize=100',
    )) as { files?: { id: string; name: string; webViewLink?: string }[] };
    return (json.files ?? []).map((f) => ({
      id: f.id,
      kind: 'document' as const,
      title: f.name,
      provenance: {
        provider: 'drive' as const,
        externalId: f.id,
        ...(f.webViewLink ? { externalUrl: f.webViewLink } : {}),
        importedAt,
      },
    }));
  }

  /** List Gmail message ids and map them onto message {@link ImportedItem}s. */
  private async importGmail(importedAt: string): Promise<ImportedItem[]> {
    const json = (await this.http.getJson('/users/me/messages?maxResults=100')) as {
      messages?: { id: string; threadId?: string }[];
    };
    return (json.messages ?? []).map((m) => ({
      id: m.id,
      kind: 'message' as const,
      title: m.id,
      provenance: {
        provider: 'gmail' as const,
        externalId: m.threadId ?? m.id,
        importedAt,
      },
    }));
  }

  /** List Calendar events and map them onto event {@link ImportedItem}s. */
  private async importCalendar(importedAt: string): Promise<ImportedItem[]> {
    const json = (await this.http.getJson('/calendars/primary/events?maxResults=100')) as {
      items?: { id: string; summary?: string; description?: string; htmlLink?: string }[];
    };
    return (json.items ?? []).map((e) => ({
      id: e.id,
      kind: 'event' as const,
      title: e.summary ?? '(no title)',
      ...(e.description ? { body: e.description } : {}),
      provenance: {
        provider: 'calendar' as const,
        externalId: e.id,
        ...(e.htmlLink ? { externalUrl: e.htmlLink } : {}),
        importedAt,
      },
    }));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const items = await this.importWork(
      { connectionId: input.connectionId, provider: this.product },
      new Date(0).toISOString(),
    );
    return { connectionId: input.connectionId, status: 'idle', itemCount: items.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    if (this.product === 'drive') return `https://drive.google.com/file/d/${input.externalId}`;
    if (this.product === 'gmail') return `https://mail.google.com/mail/#all/${input.externalId}`;
    return `https://calendar.google.com/calendar/event?eid=${input.externalId}`;
  }
}

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
      return new GoogleProviderClient(config.provider, providerHttp);
    /* v8 ignore start -- unreachable exhaustiveness guard: every `ConnectorProvider` is handled above; this only narrows the union to `never`. */
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

  /** {@inheritDoc Connector.connect} */
  async connect(input: ConnectInput): Promise<ConnectionResult> {
    const account = await this.client.resolveAccount().catch(() => undefined);
    // A null/undefined account from a thrown identity call means the credential failed.
    const ok = account !== undefined;
    return {
      connectionId: `${input.provider}:${input.referenceId}`,
      provider: input.provider,
      status: ok ? 'connected' : 'error',
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

  /** {@inheritDoc Connector.linkResource} */
  async linkResource(input: LinkResourceInput): Promise<LinkResult> {
    const externalUrl = await this.client.resolveExternalUrl(input).catch(() => undefined);
    return {
      resourceId: input.resourceId,
      externalId: input.externalId,
      ...(externalUrl !== undefined ? { externalUrl } : {}),
      linked: true,
    };
  }
}
