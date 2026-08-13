import type {
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
} from './connector';
import type { ActivityPullInput, ActivityPullResult } from './activity-source';
import { ConnectorError } from './connector-error';
import type { EventDraft } from './observer';
import type {
  ActivitySourceProviderClient,
  ConnectorProviderClient,
  ResolvedAccount,
} from './provider-client';
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
 * GitHub's documented maximum page size for the search endpoints.
 *
 * @remarks
 * Lower than the general REST maximum. Exceeding it is a 422 rather than a clamp, so it has to be
 * respected on the way out rather than discovered from the response.
 */
const GITHUB_SEARCH_MAX_PER_PAGE = 100;

/** One `GET /search/issues` hit, narrowed to the pull-request fields the activity pull reads. */
interface GitHubSearchItem {
  readonly id: number;
  /** The GraphQL global id — stable across renames, so the preferred external id. */
  readonly node_id?: string;
  readonly number: number;
  readonly title: string;
  readonly html_url: string;
  readonly created_at?: string | null;
  readonly closed_at?: string | null;
  readonly draft?: boolean;
  /** Present on pull-request hits; `merged_at` is the only reliable merge signal. */
  readonly pull_request?: { readonly merged_at?: string | null };
}

/** The `GET /search/issues` response envelope. */
interface GitHubSearchResponse {
  readonly total_count?: number;
  readonly items?: readonly GitHubSearchItem[];
}

/**
 * The GitHub connector client (REST, Octokit-compatible shapes).
 *
 * @remarks
 * `resolveAccount` reads `GET /user` (`login`); `importWork` reads the authenticated
 * user's issues; `mirrorStatus` derives a lightweight count from the same listing;
 * `resolveExternalUrl` reconstructs the canonical `https://github.com/...` URL
 * from `owner/repo#number`-style external ids; `pullActivity` searches the person's own pull
 * requests, which is what the App-install webhook cannot see for repos it is not installed on.
 */
export class GitHubProviderClient implements ConnectorProviderClient, ActivitySourceProviderClient {
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

  /**
   * {@inheritDoc ActivitySourceProviderClient.pullActivity}
   *
   * @remarks
   * Pull requests the person authored, via the search API's `author:` qualifier over an `updated:`
   * window. This complements rather than duplicates the webhook observer: the GitHub App's
   * deliveries cover repos where it is *installed*, which is not the same set as the repos somebody
   * opens pull requests against. Both paths converge on the same deduped log, so overlap is free.
   *
   * One pull request can legitimately produce two drafts in a window — opened and then merged — and
   * they carry distinct dedupe keys because they are two different things that happened. Commits are
   * deliberately not pulled: `CanonicalEntityKind` has no `repository`, so a commit would have no
   * subject to group on and every one would become its own episode, which turns narration into one
   * line per commit.
   *
   * The window is searched rather than cursored, so re-running it costs a request and changes
   * nothing — which also absorbs the search index's eventual consistency.
   */
  async pullActivity(input: ActivityPullInput): Promise<ActivityPullResult> {
    const account = await this.resolveAccount();
    const login = account?.label;
    // Without a login there is no `author:` to search on. A pull that cannot be scoped to the person
    // must not fall back to "everything visible" — that would attribute other people's work to them.
    if (login === undefined) {
      throw new ConnectorError('github did not resolve an account login', {
        provider: 'github',
        kind: 'provider',
      });
    }
    const window = `${input.since.slice(0, 10)}..${input.until.slice(0, 10)}`;
    const query = encodeURIComponent(`author:${login} type:pr updated:${window}`);
    // Clamped to GitHub's documented ceiling for search endpoints. The port's `maxDrafts` is a
    // decision about cost, and the callers legitimately pass more than a page's worth — sending it
    // through unclamped makes GitHub answer 422, which the leased spine records as a provider
    // failure, flips the integration to `error`, and tells its owner GitHub needs attention. Every
    // tick, for a request that was only ever asking for too many rows at once.
    const perPage = Math.min(input.maxDrafts, GITHUB_SEARCH_MAX_PER_PAGE);
    const json = await this.http.getJson<GitHubSearchResponse>(
      `/search/issues?q=${query}&sort=updated&per_page=${String(perPage)}`,
    );
    const items = json.items ?? [];
    // Measured against what came back rather than against `total_count`: the `updated:` search
    // matches pull requests merely *touched* in the window, most of which yield no draft at all, so
    // a large `total_count` says nothing about whether drafts were clipped.
    const truncated = items.length >= perPage;

    const since = new Date(input.since).getTime();
    const until = new Date(input.until).getTime();
    const inWindow = (iso: string): boolean => {
      const at = new Date(iso).getTime();
      return at >= since && at < until;
    };

    const drafts: EventDraft[] = [];
    for (const pr of items) {
      // The search window is `updated:`, which is coarser than the events being recorded — a pull
      // request touched today may have been opened weeks ago. Each verb is therefore re-checked
      // against the real window rather than assumed from the match.
      const openedAt = pr.created_at;
      if (openedAt && inWindow(openedAt)) {
        drafts.push(this.toPullRequestDraft(pr, 'created', openedAt));
      }
      // A merge is a completion; a close without one is also a completion of a kind, and both are
      // more informative than silence. `merged_at` wins because it is the stronger claim.
      const closedAt = pr.pull_request?.merged_at ?? pr.closed_at;
      if (closedAt && inWindow(closedAt)) {
        drafts.push(this.toPullRequestDraft(pr, 'completed', closedAt));
      }
    }
    drafts.sort((left, right) => (left.occurredAt < right.occurredAt ? -1 : 1));
    return { drafts, truncated };
  }

  /** Project one searched pull request into a canonical draft for one of its verbs. */
  private toPullRequestDraft(
    pr: GitHubSearchItem,
    kind: 'created' | 'completed',
    occurredAt: string,
  ): EventDraft {
    const nodeId = pr.node_id ?? String(pr.id);
    return {
      kind,
      occurredAt: new Date(occurredAt).toISOString(),
      title: pr.title,
      permalink: pr.html_url,
      // `work_item`, the same canonical kind a Linear issue and a Docket task map onto — which is
      // what lets one row render any of them and lets association find a mirroring task.
      entity: {
        kind: 'work_item',
        externalId: nodeId,
        title: pr.title,
        url: pr.html_url,
      },
      detail: {
        schema: 'github.pull_request',
        number: pr.number,
        merged: pr.pull_request?.merged_at != null,
        draft: pr.draft === true,
      },
      externalId: nodeId,
      dedupeKey: `github:pr:${nodeId}:${kind}`,
    };
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
