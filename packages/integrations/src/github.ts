import type {
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
} from './connector';
import { ConnectorError } from './connector-error';
import type { ConnectorProviderClient, ResolvedAccount } from './provider-client';
import type { ProviderHttp } from './provider-http';
import { MAX_IMPORT_PAGES, logConnectorTruncation } from './connector-log';

/** Shape of one GitHub issue/PR as returned by the GitHub REST issues endpoints. */
interface GitHubIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body?: string | null;
  readonly html_url: string;
  readonly pull_request?: unknown;
}

/** `GET /user` identity payload. */
interface GitHubUser {
  readonly login?: string;
  readonly name?: string;
}

/** A GitHub REST error body (`{ message }`), the non-array shape `GET /issues` can return. */
interface GitHubErrorBody {
  readonly message?: string;
}

/** The two shapes `GET /issues` can answer with: the issue array, or an error body. */
type GitHubIssuesResponse = GitHubIssue[] | GitHubErrorBody | undefined;

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
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const json = await this.http.getJson<GitHubUser>('/user');
    const label = json.login ?? json.name;
    return label !== undefined ? { label } : undefined;
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

  /**
   * Fetch all issues, paginating through GitHub's 100-item pages.
   *
   * @remarks
   * A non-array response (a bare `{ message }` error object the REST API can return with a 2xx
   * for some surfaces) is treated as a provider failure, NOT an empty success — that is exactly
   * the case that used to make a broken connector report "imported 0 items". Stops at
   * {@link MAX_IMPORT_PAGES} and logs a truncation warning if more data remained.
   */
  private async fetchIssuePages(stateFilter: 'open' | 'all'): Promise<GitHubIssue[]> {
    const all: GitHubIssue[] = [];
    let truncated = true;
    for (let page = 1; page <= MAX_IMPORT_PAGES; page++) {
      const json = await this.http.getJson<GitHubIssuesResponse>(
        `/issues?filter=all&state=${stateFilter}&per_page=100&page=${page}`,
      );
      if (!Array.isArray(json)) {
        throw new ConnectorError('github returned an unexpected (non-array) issues response', {
          provider: 'github',
          kind: 'provider',
        });
      }
      all.push(...json);
      if (json.length < 100) {
        truncated = false;
        break;
      }
    }
    if (truncated) {
      logConnectorTruncation({
        provider: 'github',
        resource: 'issues',
        fetched: all.length,
        maxPages: MAX_IMPORT_PAGES,
      });
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

  /**
   * {@inheritDoc ConnectorProviderClient.listContainers}
   *
   * @remarks
   * GitHub has no task-list container concept, so there is nothing to select — returns empty.
   */
  async listContainers(): Promise<ResourceRef[]> {
    return [];
  }
}
