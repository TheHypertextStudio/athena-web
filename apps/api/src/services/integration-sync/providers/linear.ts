/**
 * Linear integration provider.
 *
 * @packageDocumentation
 */

import type { IntegrationProviderClient, ExternalIssue, ExternalWorkspace } from '../types.js';

const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_API_URL = 'https://api.linear.app/graphql';

interface LinearConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Linear integration provider.
 */
export class LinearProvider implements IntegrationProviderClient {
  readonly provider = 'linear' as const;
  private readonly config: LinearConfig;

  constructor(config: LinearConfig) {
    this.config = config;
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'read,write,issues:create',
      state,
    });

    return `${LINEAR_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to exchange code: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    };
  }

  async getAccount(accessToken: string): Promise<{
    id: string;
    email?: string;
    name?: string;
  }> {
    const query = `
      query {
        viewer {
          id
          email
          name
        }
      }
    `;

    const data = await this.graphql<{ viewer: { id: string; email: string; name: string } }>(
      accessToken,
      query,
    );

    return {
      id: data.viewer.id,
      email: data.viewer.email,
      name: data.viewer.name,
    };
  }

  async listWorkspaces(accessToken: string): Promise<ExternalWorkspace[]> {
    const query = `
      query {
        teams {
          nodes {
            id
            name
          }
        }
      }
    `;

    const data = await this.graphql<{
      teams: { nodes: { id: string; name: string }[] };
    }>(accessToken, query);

    return data.teams.nodes.map((team) => ({
      id: team.id,
      name: team.name,
      syncEnabled: false,
    }));
  }

  async listIssues(
    accessToken: string,
    workspaceId: string,
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
    const filter: Record<string, unknown> = {
      team: { id: { eq: workspaceId } },
    };

    if (options.updatedSince) {
      filter.updatedAt = { gte: options.updatedSince.toISOString() };
    }

    const query = `
      query($filter: IssueFilter, $first: Int, $after: String) {
        issues(filter: $filter, first: $first, after: $after) {
          nodes {
            id
            title
            description
            state {
              name
            }
            priority
            labels {
              nodes {
                name
              }
            }
            assignee {
              email
            }
            project {
              name
            }
            url
            createdAt
            updatedAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const data = await this.graphql<{
      issues: {
        nodes: {
          id: string;
          title: string;
          description?: string;
          state: { name: string };
          priority: number;
          labels: { nodes: { name: string }[] };
          assignee?: { email: string };
          project?: { name: string };
          url: string;
          createdAt: string;
          updatedAt: string;
        }[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor?: string;
        };
      };
    }>(accessToken, query, {
      filter,
      first: options.limit ?? 50,
      after: options.cursor,
    });

    const issues = data.issues.nodes.map((issue) => this.mapLinearIssue(issue));

    return {
      issues,
      nextCursor: data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : undefined,
    };
  }

  async getIssue(accessToken: string, issueId: string): Promise<ExternalIssue> {
    const query = `
      query($id: String!) {
        issue(id: $id) {
          id
          title
          description
          state {
            name
          }
          priority
          labels {
            nodes {
              name
            }
          }
          assignee {
            email
          }
          project {
            name
          }
          url
          createdAt
          updatedAt
        }
      }
    `;

    const data = await this.graphql<{
      issue: {
        id: string;
        title: string;
        description?: string;
        state: { name: string };
        priority: number;
        labels: { nodes: { name: string }[] };
        assignee?: { email: string };
        project?: { name: string };
        url: string;
        createdAt: string;
        updatedAt: string;
      };
    }>(accessToken, query, { id: issueId });

    return this.mapLinearIssue(data.issue);
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
    const mutation = `
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            title
            description
            state {
              name
            }
            priority
            labels {
              nodes {
                name
              }
            }
            assignee {
              email
            }
            project {
              name
            }
            url
            createdAt
            updatedAt
          }
        }
      }
    `;

    const input: Record<string, unknown> = {
      teamId: workspaceId,
      title: data.title,
      description: data.description,
    };

    if (data.priority) {
      input.priority = this.mapPriorityToLinear(data.priority);
    }

    const result = await this.graphql<{
      issueCreate: {
        success: boolean;
        issue: {
          id: string;
          title: string;
          description?: string;
          state: { name: string };
          priority: number;
          labels: { nodes: { name: string }[] };
          assignee?: { email: string };
          project?: { name: string };
          url: string;
          createdAt: string;
          updatedAt: string;
        };
      };
    }>(accessToken, mutation, { input });

    if (!result.issueCreate.success) {
      throw new Error('Failed to create issue');
    }

    return this.mapLinearIssue(result.issueCreate.issue);
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
    const mutation = `
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            title
            description
            state {
              name
            }
            priority
            labels {
              nodes {
                name
              }
            }
            assignee {
              email
            }
            project {
              name
            }
            url
            createdAt
            updatedAt
          }
        }
      }
    `;

    const input: Record<string, unknown> = {};
    if (data.title) input.title = data.title;
    if (data.description) input.description = data.description;
    if (data.priority) input.priority = this.mapPriorityToLinear(data.priority);

    const result = await this.graphql<{
      issueUpdate: {
        success: boolean;
        issue: {
          id: string;
          title: string;
          description?: string;
          state: { name: string };
          priority: number;
          labels: { nodes: { name: string }[] };
          assignee?: { email: string };
          project?: { name: string };
          url: string;
          createdAt: string;
          updatedAt: string;
        };
      };
    }>(accessToken, mutation, { id: issueId, input });

    if (!result.issueUpdate.success) {
      throw new Error('Failed to update issue');
    }

    return this.mapLinearIssue(result.issueUpdate.issue);
  }

  handleWebhook(
    payload: unknown,
    _signature?: string,
  ): Promise<{
    eventType: string;
    issue?: ExternalIssue;
  } | null> {
    const data = payload as {
      type?: string;
      action?: string;
      data?: {
        id: string;
        title?: string;
        description?: string;
        state?: { name: string };
        priority?: number;
        labels?: { nodes?: { name: string }[] };
        assignee?: { email?: string };
        project?: { name?: string };
        url?: string;
        createdAt?: string;
        updatedAt?: string;
      };
    };

    if (!data.type || !data.data) {
      return Promise.resolve(null);
    }

    const eventType = `${data.type}.${data.action ?? 'unknown'}`;

    if (data.type === 'Issue' && data.data.id) {
      return Promise.resolve({
        eventType,
        issue: {
          externalId: data.data.id,
          provider: 'linear',
          title: data.data.title ?? '',
          description: data.data.description,
          status: data.data.state?.name ?? 'unknown',
          priority: this.mapPriorityFromLinear(data.data.priority ?? 0),
          labels: data.data.labels?.nodes?.map((l) => l.name),
          assignee: data.data.assignee?.email,
          project: data.data.project?.name,
          url: data.data.url ?? '',
          createdAt: new Date(data.data.createdAt ?? Date.now()),
          updatedAt: new Date(data.data.updatedAt ?? Date.now()),
        },
      });
    }

    return Promise.resolve({ eventType });
  }

  private async graphql<T>(
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.statusText}`);
    }

    const result = (await response.json()) as { data?: T; errors?: { message: string }[] };

    if (result.errors?.length) {
      const errorMessage = result.errors[0]?.message ?? 'Unknown error';
      throw new Error(`GraphQL error: ${errorMessage}`);
    }

    if (!result.data) {
      throw new Error('GraphQL response missing data');
    }

    return result.data;
  }

  private mapLinearIssue(issue: {
    id: string;
    title: string;
    description?: string;
    state: { name: string };
    priority: number;
    labels: { nodes: { name: string }[] };
    assignee?: { email: string };
    project?: { name: string };
    url: string;
    createdAt: string;
    updatedAt: string;
  }): ExternalIssue {
    return {
      externalId: issue.id,
      provider: 'linear',
      title: issue.title,
      description: issue.description,
      status: issue.state.name,
      priority: this.mapPriorityFromLinear(issue.priority),
      labels: issue.labels.nodes.map((l) => l.name),
      assignee: issue.assignee?.email,
      project: issue.project?.name,
      url: issue.url,
      createdAt: new Date(issue.createdAt),
      updatedAt: new Date(issue.updatedAt),
    };
  }

  private mapPriorityFromLinear(priority: number): string {
    switch (priority) {
      case 1:
        return 'urgent';
      case 2:
        return 'high';
      case 3:
        return 'medium';
      case 4:
        return 'low';
      default:
        return 'medium';
    }
  }

  private mapPriorityToLinear(priority: string): number {
    switch (priority.toLowerCase()) {
      case 'urgent':
        return 1;
      case 'high':
        return 2;
      case 'medium':
        return 3;
      case 'low':
        return 4;
      default:
        return 0; // No priority
    }
  }
}
