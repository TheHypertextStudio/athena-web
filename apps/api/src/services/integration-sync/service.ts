/**
 * Integration sync service.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { tasks, linkedIntegrations } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { LinearProvider } from './providers/linear.js';
import { GitHubProvider } from './providers/github.js';
import type {
  IntegrationProvider,
  IntegrationProviderClient,
  IntegrationConnection,
  ExternalWorkspace,
  IntegrationSyncResult,
  ExternalIssue,
} from './types.js';
import { env } from '../../lib/env.js';

/**
 * Integration sync configuration.
 */
export interface IntegrationSyncConfig {
  linear?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  github?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
}

/**
 * Integration sync service.
 */
export class IntegrationSyncService {
  private readonly providers: Map<IntegrationProvider, IntegrationProviderClient>;

  constructor(config: IntegrationSyncConfig) {
    this.providers = new Map();

    if (config.linear) {
      this.providers.set('linear', new LinearProvider(config.linear));
    }

    if (config.github) {
      this.providers.set('github', new GitHubProvider(config.github));
    }
  }

  /**
   * Get OAuth authorization URL.
   */
  getAuthUrl(provider: IntegrationProvider, userId: string): string {
    const client = this.providers.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} is not configured`);
    }

    const state = Buffer.from(JSON.stringify({ userId, provider, timestamp: Date.now() })).toString(
      'base64url',
    );

    return client.getAuthUrl(state);
  }

  /**
   * Handle OAuth callback.
   */
  async handleOAuthCallback(
    provider: IntegrationProvider,
    code: string,
    state: string,
  ): Promise<IntegrationConnection> {
    const client = this.providers.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} is not configured`);
    }

    let stateData: { userId: string; provider: string; timestamp: number };
    try {
      const parsedState: unknown = JSON.parse(Buffer.from(state, 'base64url').toString());
      stateData = parsedState as { userId: string; provider: string; timestamp: number };
    } catch {
      throw new Error('Invalid state token');
    }

    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      throw new Error('State token expired');
    }

    const tokens = await client.exchangeCode(code);
    const account = await client.getAccount(tokens.accessToken);
    const workspaces = await client.listWorkspaces(tokens.accessToken);

    const connectionId = crypto.randomUUID();
    const now = new Date();

    await db.insert(linkedIntegrations).values({
      id: connectionId,
      userId: stateData.userId,
      provider: provider as 'linear' | 'github',
      externalAccountId: account.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      metadata: { accountName: account.name, accountEmail: account.email, workspaces },
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: connectionId,
      userId: stateData.userId,
      provider,
      externalAccountId: account.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      workspaces,
      syncEnabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get user's connections.
   */
  async getConnections(userId: string): Promise<IntegrationConnection[]> {
    const integrations = await db.query.linkedIntegrations.findMany({
      where: eq(linkedIntegrations.userId, userId),
    });

    return integrations
      .filter((i) => ['linear', 'github'].includes(i.provider))
      .map((i) => ({
        id: i.id,
        userId: i.userId,
        provider: i.provider as IntegrationProvider,
        externalAccountId: i.externalAccountId,
        accessToken: i.accessToken ?? undefined,
        refreshToken: i.refreshToken ?? undefined,
        tokenExpiresAt: i.tokenExpiresAt ?? undefined,
        workspaces: (i.metadata as { workspaces?: ExternalWorkspace[] } | null)?.workspaces ?? [],
        syncEnabled: true,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      }));
  }

  /**
   * Update workspace sync settings.
   */
  async updateWorkspaceSettings(
    connectionId: string,
    userId: string,
    workspaces: { id: string; syncEnabled: boolean }[],
  ): Promise<void> {
    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration) {
      throw new Error('Connection not found');
    }

    const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
    const existingWorkspaces = (metadata.workspaces ?? []) as ExternalWorkspace[];

    const updatedWorkspaces = existingWorkspaces.map((ws) => {
      const update = workspaces.find((w) => w.id === ws.id);
      return update ? { ...ws, syncEnabled: update.syncEnabled } : ws;
    });

    await db
      .update(linkedIntegrations)
      .set({
        metadata: { ...metadata, workspaces: updatedWorkspaces },
        updatedAt: new Date(),
      })
      .where(eq(linkedIntegrations.id, connectionId));
  }

  /**
   * Disconnect an integration.
   */
  async disconnect(connectionId: string, userId: string): Promise<void> {
    await db
      .delete(linkedIntegrations)
      .where(and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)));
  }

  /**
   * Sync issues from external provider.
   */
  async sync(connectionId: string, userId: string): Promise<IntegrationSyncResult> {
    const integration = await db.query.linkedIntegrations.findFirst({
      where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
    });

    if (!integration) {
      throw new Error('Connection not found');
    }

    const provider = integration.provider as IntegrationProvider;
    const client = this.providers.get(provider);

    if (!client || !integration.accessToken) {
      throw new Error('Provider not configured or no access token');
    }

    const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
    const workspaces = ((metadata.workspaces ?? []) as ExternalWorkspace[]).filter(
      (ws) => ws.syncEnabled,
    );

    const result: IntegrationSyncResult = {
      success: true,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsDeleted: 0,
      errors: [],
      syncedAt: new Date(),
    };

    for (const workspace of workspaces) {
      try {
        const { issues } = await client.listIssues(integration.accessToken, workspace.id, {
          limit: 100,
        });

        for (const issue of issues) {
          try {
            const syncResult = await this.syncIssue(userId, connectionId, issue);
            if (syncResult === 'created') result.itemsCreated++;
            if (syncResult === 'updated') result.itemsUpdated++;
          } catch (err) {
            result.errors.push({
              itemId: issue.externalId,
              operation: 'sync',
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
      } catch (err) {
        result.errors.push({
          operation: 'list',
          error: `Workspace ${workspace.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * Push a task to external provider.
   */
  async pushTask(
    connectionId: string,
    userId: string,
    taskId: string,
    workspaceId: string,
  ): Promise<ExternalIssue> {
    const [integration, task] = await Promise.all([
      db.query.linkedIntegrations.findFirst({
        where: and(eq(linkedIntegrations.id, connectionId), eq(linkedIntegrations.userId, userId)),
      }),
      db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.creatorId, userId)),
      }),
    ]);

    if (!integration || !task) {
      throw new Error('Connection or task not found');
    }

    const provider = integration.provider as IntegrationProvider;
    const client = this.providers.get(provider);

    if (!client || !integration.accessToken) {
      throw new Error('Provider not configured');
    }

    const issue = await client.createIssue(integration.accessToken, workspaceId, {
      title: task.title,
      description: task.description ?? undefined,
      priority: task.priority,
    });

    return issue;
  }

  /**
   * Handle incoming webhook.
   */
  async handleWebhook(
    provider: IntegrationProvider,
    payload: unknown,
    signature?: string,
  ): Promise<{ handled: boolean; eventType?: string }> {
    const client = this.providers.get(provider);
    if (!client) {
      return { handled: false };
    }

    const result = await client.handleWebhook(payload, signature);
    if (!result) {
      return { handled: false };
    }

    // If we got an issue update, we could sync it here
    // For now, just acknowledge the webhook

    return { handled: true, eventType: result.eventType };
  }

  /**
   * Sync a single issue.
   */
  private async syncIssue(
    userId: string,
    _connectionId: string,
    issue: ExternalIssue,
  ): Promise<'created' | 'updated' | 'skipped'> {
    // Simple matching by title - in production you'd track external IDs
    const existingTask = await db.query.tasks.findFirst({
      where: and(eq(tasks.creatorId, userId), eq(tasks.title, issue.title)),
    });

    const now = new Date();

    const priorityMap: Record<string, 'low' | 'medium' | 'high' | 'urgent'> = {
      urgent: 'urgent',
      high: 'high',
      medium: 'medium',
      low: 'low',
    };

    const statusMap: Record<string, 'pending' | 'in_progress' | 'completed' | 'cancelled'> = {
      Todo: 'pending',
      'In Progress': 'in_progress',
      Done: 'completed',
      Cancelled: 'cancelled',
      open: 'pending',
      closed: 'completed',
    };

    if (existingTask) {
      await db
        .update(tasks)
        .set({
          description: issue.description,
          priority: priorityMap[issue.priority ?? 'medium'] ?? 'medium',
          status: statusMap[issue.status] ?? 'pending',
          updatedAt: now,
        })
        .where(eq(tasks.id, existingTask.id));

      return 'updated';
    }

    await db.insert(tasks).values({
      id: crypto.randomUUID(),
      title: issue.title,
      description: issue.description,
      priority: priorityMap[issue.priority ?? 'medium'] ?? 'medium',
      status: statusMap[issue.status] ?? 'pending',
      creatorId: userId,
      createdAt: now,
      updatedAt: now,
    });

    return 'created';
  }
}

/**
 * Create integration sync service from environment.
 */
export function createIntegrationSyncService(
  config?: IntegrationSyncConfig,
): IntegrationSyncService {
  // If explicit config provided, use it (for testing/DI)
  if (config) {
    return new IntegrationSyncService(config);
  }

  // Build config from validated env config objects
  const envConfig: IntegrationSyncConfig = {};

  if (env.linearIntegration) {
    envConfig.linear = env.linearIntegration;
  }

  if (env.githubIntegration) {
    envConfig.github = env.githubIntegration;
  }

  return new IntegrationSyncService(envConfig);
}

// Singleton instance
let integrationSyncServiceInstance: IntegrationSyncService | null = null;

/**
 * Get the shared integration sync service instance.
 */
export function getIntegrationSyncService(): IntegrationSyncService {
  integrationSyncServiceInstance ??= createIntegrationSyncService();
  return integrationSyncServiceInstance;
}
