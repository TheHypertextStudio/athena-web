/**
 * Account management routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  AccountOverviewResponseSchema,
  DataExportResponseSchema,
  DeleteAccountRequestSchema,
} from '@athena/types/openapi/account';
import {
  ErrorResponseSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  users,
  initiatives,
  projects,
  tasks,
  events,
  moments,
  activityStreams,
  tags,
  timeEntries,
  workspaces,
  userSettings,
  subscriptions,
  linkedIntegrations,
  // AI/Athena
  conversations,
  aiPreferences,
  // Notifications
  notificationPreferences,
  notifications,
  scheduledNotifications,
  // Attachments
  attachments,
  // Webhooks & Audit
  webhookEndpoints,
  auditLogs,
} from '../db/schema/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const accountRoutes = createOpenAPIApp();

accountRoutes.use('*', requireAuth);

const ACCOUNT_DELETE_CONFIRMATION = 'DELETE_MY_ACCOUNT' as const;
const ACCOUNT_EXPORT_VERSION = '2.0.0';
const ACCOUNT_EXPORT_FILE_PREFIX = 'athena-export';
const ACCOUNT_EXPORT_AUDIT_LOG_LIMIT = 1000;

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const getAccountOverview = createRoute({
  method: 'get',
  path: '/',
  tags: ['Account'],
  summary: 'Get account overview',
  description: 'Retrieve account information and usage statistics.',
  responses: {
    200: {
      description: 'Account overview retrieved successfully',
      content: {
        'application/json': {
          schema: AccountOverviewResponseSchema,
        },
      },
    },
    404: {
      description: 'User not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const exportUserData = createRoute({
  method: 'get',
  path: '/export',
  tags: ['Account'],
  summary: 'Export user data',
  description: 'Export all user data as JSON for GDPR compliance.',
  responses: {
    200: {
      description: 'Data export successful',
      content: {
        'application/json': {
          schema: DataExportResponseSchema,
        },
      },
    },
    404: {
      description: 'User not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const deleteAccount = createRoute({
  method: 'delete',
  path: '/',
  tags: ['Account'],
  summary: 'Delete account',
  description: 'Permanently delete the user account and all associated data.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: DeleteAccountRequestSchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: 'Account deleted successfully',
    },
    400: {
      description: 'Invalid confirmation string',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

/**
 * Export all user data.
 * GET /api/account/export
 */
accountRoutes.openapi(exportUserData, async (c) => {
  const userId = getUserId(c);

  // Get user profile
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Get all user data - core entities
  const [
    userInitiatives,
    userProjects,
    userTasks,
    userEvents,
    userMoments,
    userActivityStreams,
    userTags,
    userTimeEntries,
    userWorkspaces,
    settings,
    subscription,
    integrations,
  ] = await Promise.all([
    db.query.initiatives.findMany({
      where: eq(initiatives.ownerId, userId),
      with: { parent: true, projects: true },
    }),
    db.query.projects.findMany({
      where: eq(projects.ownerId, userId),
      with: { initiative: true, tasks: true },
    }),
    db.query.tasks.findMany({
      where: eq(tasks.creatorId, userId),
      with: { project: true, tags: { with: { tag: true } } },
    }),
    db.query.events.findMany({
      where: eq(events.creatorId, userId),
      with: { participants: { with: { user: true } } },
    }),
    db.query.moments.findMany({
      where: eq(moments.ownerId, userId),
    }),
    db.query.activityStreams.findMany({
      where: eq(activityStreams.ownerId, userId),
      with: { activities: true },
    }),
    db.query.tags.findMany({
      where: eq(tags.ownerId, userId),
    }),
    db.query.timeEntries.findMany({
      where: eq(timeEntries.userId, userId),
      with: { task: true },
    }),
    db.query.workspaces.findMany({
      where: eq(workspaces.ownerId, userId),
    }),
    db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    }),
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    }),
    db.query.linkedIntegrations.findMany({
      where: eq(linkedIntegrations.userId, userId),
    }),
  ]);

  // Get AI/Athena data
  const [userConversations, userAiPreferences] = await Promise.all([
    db.query.conversations.findMany({
      where: eq(conversations.userId, userId),
      with: { messages: { with: { toolCalls: true } } },
    }),
    db.query.aiPreferences.findFirst({
      where: eq(aiPreferences.userId, userId),
    }),
  ]);

  // Get notifications data
  const [userNotificationPreferences, userNotifications, userScheduledNotifications] =
    await Promise.all([
      db.query.notificationPreferences.findFirst({
        where: eq(notificationPreferences.userId, userId),
      }),
      db.query.notifications.findMany({
        where: eq(notifications.userId, userId),
      }),
      db.query.scheduledNotifications.findMany({
        where: eq(scheduledNotifications.userId, userId),
      }),
    ]);

  // Get attachments
  const userAttachments = await db.query.attachments.findMany({
    where: eq(attachments.userId, userId),
  });

  // Get webhooks
  const userWebhooks = await db.query.webhookEndpoints.findMany({
    where: eq(webhookEndpoints.userId, userId),
  });

  // Get audit logs (limited to last 1000 for performance)
  const userAuditLogs = await db.query.auditLogs.findMany({
    where: eq(auditLogs.userId, userId),
    limit: ACCOUNT_EXPORT_AUDIT_LOG_LIMIT,
    orderBy: (logs, { desc }) => [desc(logs.createdAt)],
  });

  const exportData = {
    exportVersion: ACCOUNT_EXPORT_VERSION,
    exportedAt: new Date(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    },
    settings: settings ?? {},
    subscription: subscription
      ? {
          planTier: subscription.planTier,
          status: subscription.status,
        }
      : null,
    data: {
      // Core entities
      initiatives: userInitiatives,
      projects: userProjects,
      tasks: userTasks,
      events: userEvents,
      moments: userMoments,
      activityStreams: userActivityStreams,
      tags: userTags,
      timeEntries: userTimeEntries,
      workspaces: userWorkspaces,
      // AI/Athena
      conversations: userConversations.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        summary: c.summary,
        provider: c.provider,
        model: c.model,
        totalTokens: c.totalTokens,
        createdAt: c.createdAt,
        messages: c.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCallId: m.toolCallId,
          toolName: m.toolName,
          createdAt: m.createdAt,
          toolCalls: m.toolCalls.map((tc) => ({
            id: tc.id,
            toolName: tc.toolName,
            arguments: tc.arguments,
            result: tc.result,
            error: tc.error,
            createdAt: tc.createdAt,
          })),
        })),
      })),
      aiPreferences: userAiPreferences,
      // Notifications
      notificationPreferences: userNotificationPreferences,
      notifications: userNotifications,
      scheduledNotifications: userScheduledNotifications,
      // Attachments (exclude storage paths for security)
      attachments: userAttachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        originalFilename: a.originalFilename,
        mimeType: a.mimeType,
        size: a.size,
        entityType: a.entityType,
        entityId: a.entityId,
        status: a.status,
        createdAt: a.createdAt,
      })),
      // Webhooks (exclude secrets for security)
      webhooks: userWebhooks.map((w) => ({
        id: w.id,
        url: w.url,
        description: w.description,
        events: w.events,
        isActive: w.isActive,
        createdAt: w.createdAt,
      })),
      // Audit logs (last 1000)
      auditLogs: userAuditLogs,
    },
    integrations: integrations.map((i) => ({
      provider: i.provider,
      connectedAt: i.createdAt,
    })),
    schema: {
      initiatives: {
        description: 'Strategic collections of projects',
        fields: ['id', 'name', 'description', 'status', 'parentId', 'createdAt', 'updatedAt'],
      },
      projects: {
        description: 'Time-bound collections of tasks',
        fields: [
          'id',
          'name',
          'description',
          'status',
          'deadline',
          'initiativeId',
          'createdAt',
          'updatedAt',
        ],
      },
      tasks: {
        description: 'Completable units of work',
        fields: [
          'id',
          'title',
          'description',
          'status',
          'priority',
          'deadline',
          'estimatedMinutes',
          'projectId',
          'createdAt',
          'updatedAt',
        ],
      },
      events: {
        description: 'Scheduled moments with participants',
        fields: [
          'id',
          'title',
          'description',
          'startTime',
          'endTime',
          'isAllDay',
          'location',
          'recurrenceRule',
          'createdAt',
          'updatedAt',
        ],
      },
      moments: {
        description: 'Time-bounded containers',
        fields: ['id', 'label', 'description', 'startTime', 'endTime', 'createdAt', 'updatedAt'],
      },
      activityStreams: {
        description: 'Collections of activities from a single source',
        fields: ['id', 'name', 'source', 'createdAt', 'updatedAt'],
      },
      tags: {
        description: 'Labels for organizing tasks',
        fields: ['id', 'name', 'color', 'createdAt'],
      },
      timeEntries: {
        description: 'Time tracking records',
        fields: ['id', 'taskId', 'startTime', 'endTime', 'description', 'createdAt', 'updatedAt'],
      },
      workspaces: {
        description: 'Scoped views of work',
        fields: ['id', 'name', 'description', 'createdAt', 'updatedAt'],
      },
      conversations: {
        description: 'AI assistant chat sessions',
        fields: [
          'id',
          'title',
          'status',
          'summary',
          'provider',
          'model',
          'totalTokens',
          'createdAt',
        ],
      },
      notifications: {
        description: 'Sent notifications',
        fields: ['id', 'channel', 'status', 'priority', 'title', 'body', 'sentAt', 'readAt'],
      },
      attachments: {
        description: 'File attachments',
        fields: ['id', 'filename', 'mimeType', 'size', 'entityType', 'entityId', 'createdAt'],
      },
      webhooks: {
        description: 'Webhook endpoints',
        fields: ['id', 'url', 'events', 'isActive', 'createdAt'],
      },
      auditLogs: {
        description: 'Audit trail of data changes',
        fields: ['id', 'action', 'entityType', 'entityId', 'changedFields', 'createdAt'],
      },
    },
  };

  // Set headers for file download
  const dateStr = new Date().toISOString().slice(0, 10);
  c.header('Content-Type', 'application/json');
  c.header(
    'Content-Disposition',
    `attachment; filename="${ACCOUNT_EXPORT_FILE_PREFIX}-${dateStr}.json"`,
  );

  return c.json(exportData, 200);
});

/**
 * Delete user account.
 * DELETE /api/account
 */
accountRoutes.openapi(deleteAccount, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  // Require explicit confirmation
  if (body.confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    return c.json(
      {
        error: `Invalid confirmation. Please provide confirmation: "${ACCOUNT_DELETE_CONFIRMATION}"`,
      },
      400,
    );
  }

  // Delete all user data (cascades will handle most of it)
  // But we need to explicitly delete some things for safety
  await db.delete(timeEntries).where(eq(timeEntries.userId, userId));
  await db.delete(workspaces).where(eq(workspaces.ownerId, userId));
  await db.delete(linkedIntegrations).where(eq(linkedIntegrations.userId, userId));
  await db.delete(userSettings).where(eq(userSettings.userId, userId));
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));

  // Delete the user (cascades will handle the rest)
  await db.delete(users).where(eq(users.id, userId));

  return c.body(null, 204);
});

/**
 * Get account overview.
 * GET /api/account
 */
accountRoutes.openapi(getAccountOverview, async (c) => {
  const userId = getUserId(c);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Get counts
  const [initiativeCount, projectCount, taskCount, eventCount] = await Promise.all([
    db.query.initiatives.findMany({ where: eq(initiatives.ownerId, userId) }),
    db.query.projects.findMany({ where: eq(projects.ownerId, userId) }),
    db.query.tasks.findMany({ where: eq(tasks.creatorId, userId) }),
    db.query.events.findMany({ where: eq(events.creatorId, userId) }),
  ]);

  return c.json({
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      stats: {
        initiatives: initiativeCount.length,
        projects: projectCount.length,
        tasks: taskCount.length,
        events: eventCount.length,
      },
    },
  }, 200);
});

export { accountRoutes };
