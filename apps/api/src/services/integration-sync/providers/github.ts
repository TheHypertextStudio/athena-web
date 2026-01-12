/**
 * GitHub integration provider.
 *
 * @packageDocumentation
 */

import type { IntegrationProviderClient, ExternalIssue, ExternalWorkspace } from '../types.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * GitHub integration provider.
 */
export class GitHubProvider implements IntegrationProviderClient {
  readonly provider = 'github' as const;
  private readonly config: GitHubConfig;

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'repo user:email',
      state,
    });

    return `${GITHUB_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to exchange code: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
    };

    if (!data.access_token) {
      throw new Error('No access token received');
    }

    return {
      accessToken: data.access_token,
    };
  }

  async getAccount(accessToken: string): Promise<{
    id: string;
    email?: string;
    name?: string;
  }> {
    const [user, emails] = await Promise.all([
      this.apiRequest<{ id: number; login: string; name: string | null }>(accessToken, '/user'),
      this.apiRequest<{ email: string; primary: boolean }[]>(accessToken, '/user/emails'),
    ]);

    const primaryEmail = emails.find((e) => e.primary)?.email ?? emails[0]?.email;

    return {
      id: String(user.id),
      email: primaryEmail,
      name: user.name ?? user.login,
    };
  }

  async listWorkspaces(accessToken: string): Promise<ExternalWorkspace[]> {
    // List user's repositories
    const repos = await this.apiRequest<
      {
        id: number;
        full_name: string;
        name: string;
        owner: { login: string };
      }[]
    >(accessToken, '/user/repos?per_page=100&sort=updated');

    return repos.map((repo) => ({
      id: repo.full_name,
      name: repo.full_name,
      syncEnabled: false,
    }));
  }

  async listIssues(
    accessToken: string,
    workspaceId: string, // repo full name (owner/repo)
    options: {
      updatedSince?: Date;
      status?: string[];
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{
    issues: ExternalIssue[];
    nextCursor?: string;
  }> {
    const params = new URLSearchParams();
    params.set('per_page', String(options.limit ?? 30));
    params.set('state', 'all');
    params.set('sort', 'updated');
    params.set('direction', 'desc');

    if (options.updatedSince) {
      params.set('since', options.updatedSince.toISOString());
    }

    if (options.cursor) {
      params.set('page', options.cursor);
    }

    const response = await fetch(
      `${GITHUB_API_URL}/repos/${workspaceId}/issues?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to list issues: ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubIssue[];

    // Filter out pull requests (GitHub API returns them as issues)
    const issues = data
      .filter((issue) => !issue.pull_request)
      .map((issue) => this.mapGitHubIssue(issue, workspaceId));

    // Get next page from Link header
    const linkHeader = response.headers.get('Link');
    let nextCursor: string | undefined;

    if (linkHeader) {
      const nextMatch = /<[^>]+[?&]page=(\d+)[^>]*>;\s*rel="next"/.exec(linkHeader);
      if (nextMatch) {
        nextCursor = nextMatch[1];
      }
    }

    return { issues, nextCursor };
  }

  async getIssue(accessToken: string, issueId: string): Promise<ExternalIssue> {
    // issueId format: owner/repo#number
    const [repo, numberStr] = issueId.split('#');
    if (!repo || !numberStr) {
      throw new Error('Invalid issue ID format');
    }

    const issue = await this.apiRequest<GitHubIssue>(
      accessToken,
      `/repos/${repo}/issues/${numberStr}`,
    );

    return this.mapGitHubIssue(issue, repo);
  }

  async createIssue(
    accessToken: string,
    workspaceId: string,
    data: {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      labels?: string[];
      assignee?: string;
    },
  ): Promise<ExternalIssue> {
    const body: Record<string, unknown> = {
      title: data.title,
      body: data.description,
    };

    if (data.labels?.length) {
      body.labels = data.labels;
    }

    if (data.assignee) {
      body.assignees = [data.assignee];
    }

    const issue = await this.apiRequest<GitHubIssue>(accessToken, `/repos/${workspaceId}/issues`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return this.mapGitHubIssue(issue, workspaceId);
  }

  async updateIssue(
    accessToken: string,
    issueId: string,
    data: Partial<{
      title: string;
      description: string;
      status: string;
      priority: string;
      labels: string[];
      assignee: string;
    }>,
  ): Promise<ExternalIssue> {
    const [repo, numberStr] = issueId.split('#');
    if (!repo || !numberStr) {
      throw new Error('Invalid issue ID format');
    }

    const body: Record<string, unknown> = {};
    if (data.title) body.title = data.title;
    if (data.description) body.body = data.description;
    if (data.status) body.state = data.status === 'closed' ? 'closed' : 'open';
    if (data.labels) body.labels = data.labels;
    if (data.assignee) body.assignees = [data.assignee];

    const issue = await this.apiRequest<GitHubIssue>(
      accessToken,
      `/repos/${repo}/issues/${numberStr}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    );

    return this.mapGitHubIssue(issue, repo);
  }

  handleWebhook(
    payload: unknown,
    _signature?: string,
  ): Promise<{
    eventType: string;
    issue?: ExternalIssue;
  } | null> {
    const data = payload as {
      action?: string;
      issue?: GitHubIssue;
      repository?: { full_name: string };
    };

    if (!data.action || !data.issue || !data.repository) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      eventType: `issues.${data.action}`,
      issue: this.mapGitHubIssue(data.issue, data.repository.full_name),
    });
  }

  private async apiRequest<T>(
    accessToken: string,
    path: string,
    options?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
  ): Promise<T> {
    const response = await fetch(`${GITHUB_API_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private mapGitHubIssue(issue: GitHubIssue, repo: string): ExternalIssue {
    return {
      externalId: `${repo}#${String(issue.number)}`,
      provider: 'github',
      title: issue.title,
      description: issue.body ?? undefined,
      status: issue.state,
      priority: this.extractPriorityFromLabels(issue.labels),
      labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      assignee: issue.assignees?.[0]?.login,
      project: repo,
      url: issue.html_url,
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
    };
  }

  private extractPriorityFromLabels(labels: (string | { name: string })[]): string | undefined {
    for (const label of labels) {
      const labelName = (typeof label === 'string' ? label : label.name).toLowerCase();

      if (labelName.includes('urgent') || labelName.includes('critical')) {
        return 'urgent';
      }
      if (labelName.includes('high')) {
        return 'high';
      }
      if (labelName.includes('medium')) {
        return 'medium';
      }
      if (labelName.includes('low')) {
        return 'low';
      }
    }

    return undefined;
  }
}

/**
 * GitHub API issue type.
 */
interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: (string | { name: string })[];
  assignees?: { login: string }[];
  html_url: string;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}
