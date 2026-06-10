import type {
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
} from '../ports/connector';
import type { ConnectorProviderClient } from './connector-provider-client';
import type { ProviderHttp } from './connector-http';

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

  /** Migration import query with cursor pagination support. */
  private static issuesQuery(cursor?: string): string {
    const after = cursor ? `, after: "${cursor}"` : '';
    return `{ issues(first: 100${after}) { nodes { id identifier title description url } pageInfo { hasNextPage endCursor } } }`;
  }

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

  /** Fetch all Linear issues via cursor pagination (max 10 pages / 1 000 items). */
  private async fetchAllIssues(): Promise<LinearIssueNode[]> {
    interface Page {
      issues?: {
        nodes?: LinearIssueNode[];
        pageInfo?: { hasNextPage: boolean; endCursor?: string };
      };
    }
    const all: LinearIssueNode[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const data = await this.query<Page>(LinearProviderClient.issuesQuery(cursor));
      all.push(...(data.issues?.nodes ?? []));
      const pageInfo = data.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      cursor = pageInfo.endCursor;
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
}
