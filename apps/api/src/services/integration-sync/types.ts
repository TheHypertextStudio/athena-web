/**
 * Integration sync types.
 *
 * @packageDocumentation
 */

/**
 * Supported integration providers.
 */
export type IntegrationProvider = 'linear' | 'github';

/**
 * External issue/task from an integration.
 */
export interface ExternalIssue {
  externalId: string;
  provider: IntegrationProvider;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  labels?: string[];
  assignee?: string;
  project?: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sync mapping between local and external items.
 */
export interface SyncMapping {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  localTaskId: string;
  externalId: string;
  externalUrl: string;
  lastSyncedAt: Date;
  syncDirection: 'pull' | 'push' | 'bidirectional';
  metadata?: Record<string, unknown>;
}

/**
 * Integration connection.
 */
export interface IntegrationConnection {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  externalAccountId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  workspaces: ExternalWorkspace[];
  syncEnabled: boolean;
  lastSyncAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * External workspace/organization.
 */
export interface ExternalWorkspace {
  id: string;
  name: string;
  syncEnabled: boolean;
}

/**
 * Sync configuration.
 */
export interface SyncConfig {
  direction: 'pull' | 'push' | 'bidirectional';
  statusMapping: Record<string, string>;
  priorityMapping: Record<string, string>;
  labelMapping: Record<string, string>;
  projectMapping?: Record<string, string>;
}

/**
 * Sync result.
 */
export interface IntegrationSyncResult {
  success: boolean;
  itemsCreated: number;
  itemsUpdated: number;
  itemsDeleted: number;
  errors: {
    itemId?: string;
    operation: string;
    error: string;
  }[];
  syncedAt: Date;
}

/**
 * Integration provider client interface.
 */
export interface IntegrationProviderClient {
  provider: IntegrationProvider;

  /**
   * Get OAuth authorization URL.
   */
  getAuthUrl(state: string): string;

  /**
   * Exchange authorization code for tokens.
   */
  exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }>;

  /**
   * Get user/account info.
   */
  getAccount(accessToken: string): Promise<{
    id: string;
    email?: string;
    name?: string;
  }>;

  /**
   * List workspaces/organizations.
   */
  listWorkspaces(accessToken: string): Promise<ExternalWorkspace[]>;

  /**
   * List issues/tasks.
   */
  listIssues(
    accessToken: string,
    workspaceId: string,
    options?: {
      updatedSince?: Date;
      status?: string[];
      limit?: number;
      cursor?: string;
    },
  ): Promise<{
    issues: ExternalIssue[];
    nextCursor?: string;
  }>;

  /**
   * Get a single issue.
   */
  getIssue(accessToken: string, issueId: string): Promise<ExternalIssue>;

  /**
   * Create an issue.
   */
  createIssue(
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
  ): Promise<ExternalIssue>;

  /**
   * Update an issue.
   */
  updateIssue(
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
  ): Promise<ExternalIssue>;

  /**
   * Handle incoming webhook.
   */
  handleWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<{
    eventType: string;
    issue?: ExternalIssue;
  } | null>;
}
