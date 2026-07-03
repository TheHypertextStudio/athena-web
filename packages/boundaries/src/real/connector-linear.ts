import type {
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
} from '../ports/connector';
import { ConnectorError } from '../ports/connector-error';
import type { ConnectorProviderClient, ResolvedAccount } from './connector-provider-client';
import type { ProviderHttp } from './connector-http';
import { MAX_IMPORT_PAGES, logConnectorTruncation } from './connector-log';

/** Shape of one Linear issue node as returned by the GraphQL issues query. */
interface LinearIssueNode {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description?: string | null;
  readonly url: string;
}

/** A Linear GraphQL envelope: the typed `data` payload, plus any `errors[]`. */
interface GraphQLResponse<T> {
  readonly data?: T;
  readonly errors?: { readonly message: string }[];
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

  /** Migration import query with cursor pagination support. */
  private static issuesQuery(cursor?: string): string {
    const after = cursor ? `, after: "${cursor}"` : '';
    return `{ issues(first: 100${after}) { nodes { id identifier title description url } pageInfo { hasNextPage endCursor } } }`;
  }

  /** @param http - The provider HTTP wrapper bound to Linear. */
  constructor(private readonly http: ProviderHttp) {}

  /**
   * Run one GraphQL query and return its `data` payload, surfacing GraphQL errors.
   *
   * @remarks
   * Linear can answer a 200 with a populated `errors[]` (e.g. an expired token surfaces as an
   * "authentication"/"access" GraphQL error rather than a 401), so these are raised as typed
   * {@link ConnectorError}s — auth-shaped messages become `auth` (re-auth needed) and the rest
   * `provider` — instead of a generic untyped throw the caller can't reason about.
   */
  private async query<T>(query: string): Promise<T> {
    const json = await this.http.postJson<GraphQLResponse<T>>('/graphql', { query });
    if (json.errors && json.errors.length > 0) {
      const message = json.errors.map((e) => e.message).join('; ');
      const kind = /auth|unauthorized|access|token|forbidden/i.test(message) ? 'auth' : 'provider';
      throw new ConnectorError(`linear GraphQL error: ${message}`, { provider: 'linear', kind });
    }
    if (json.data === undefined) {
      throw new ConnectorError('linear GraphQL response missing data', {
        provider: 'linear',
        kind: 'provider',
      });
    }
    return json.data;
  }

  /**
   * {@inheritDoc ConnectorProviderClient.resolveAccount}
   *
   * @remarks
   * Wraps the existing `viewer` label only — resolving the organization's
   * `externalWorkspaceId`/`externalWorkspaceSlug` (the webhook routing key and URL slug) is
   * Task 3's rich GraphQL client, not this seam.
   */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const data = await this.query<{ viewer?: { name?: string; email?: string } }>(
      LinearProviderClient.VIEWER_QUERY,
    );
    const label = data.viewer?.name ?? data.viewer?.email;
    return label !== undefined ? { label } : undefined;
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

  /** Fetch all Linear issues via cursor pagination, warning if the safety bound truncates results. */
  private async fetchAllIssues(): Promise<LinearIssueNode[]> {
    interface Page {
      issues?: {
        nodes?: LinearIssueNode[];
        pageInfo?: { hasNextPage: boolean; endCursor?: string };
      };
    }
    const all: LinearIssueNode[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (let page = 0; page < MAX_IMPORT_PAGES; page++) {
      const data = await this.query<Page>(LinearProviderClient.issuesQuery(cursor));
      all.push(...(data.issues?.nodes ?? []));
      const pageInfo = data.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      cursor = pageInfo.endCursor;
      if (page === MAX_IMPORT_PAGES - 1) truncated = true;
    }
    if (truncated) {
      logConnectorTruncation({
        provider: 'linear',
        resource: 'issues',
        fetched: all.length,
        maxPages: MAX_IMPORT_PAGES,
      });
    }
    return all;
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const nodes = await this.fetchAllIssues();
    return nodes.map((node) => this.toItem(node, importedAt));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const nodes = await this.fetchAllIssues();
    return { connectionId: input.connectionId, status: 'idle', itemCount: nodes.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    const match = /^([^/]+)\/([A-Z0-9]+-\d+)$/.exec(input.externalId);
    if (!match) return undefined;
    return `https://linear.app/${match[1]}/issue/${match[2]}`;
  }

  /**
   * {@inheritDoc ConnectorProviderClient.listContainers}
   *
   * @remarks
   * Linear has no Google-Tasks-style container concept here, so there is nothing to select.
   */
  async listContainers(): Promise<ResourceRef[]> {
    return [];
  }
}
