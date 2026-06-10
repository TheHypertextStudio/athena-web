import type {
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
} from '../ports/connector';
import type { ConnectorProviderClient } from './connector-provider-client';
import type { ProviderHttp } from './connector-http';

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
 * user's issues; `mirrorStatus` derives a lightweight count from the same listing;
 * `resolveExternalUrl` reconstructs the canonical `https://github.com/...` URL
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

  /** Fetch all issues, paginating through GitHub's 100-item pages (max 10 pages / 1 000 items). */
  private async fetchIssuePages(stateFilter: 'open' | 'all'): Promise<GitHubIssue[]> {
    const all: GitHubIssue[] = [];
    for (let page = 1; page <= 10; page++) {
      const json = (await this.http.getJson(
        `/issues?filter=all&state=${stateFilter}&per_page=100&page=${page}`,
      )) as GitHubIssue[] | undefined;
      if (!Array.isArray(json) || json.length === 0) break;
      all.push(...json);
      if (json.length < 100) break;
    }
    return all;
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const issues = await this.fetchIssuePages('open');
    return issues.map((issue) => this.toItem(issue, importedAt));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const issues = await this.fetchIssuePages('all');
    return { connectionId: input.connectionId, status: 'idle', itemCount: issues.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    const match = /^([^/]+\/[^#]+)#(\d+)$/.exec(input.externalId);
    if (match) return `https://github.com/${match[1]}/issues/${match[2]}`;
    if (/^[^/]+\/[^/]+$/.test(input.externalId)) return `https://github.com/${input.externalId}`;
    return undefined;
  }
}
