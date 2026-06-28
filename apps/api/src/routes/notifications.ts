/**
 * Notification routes for the API.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  NotificationIdParamSchema,
  NotificationsQuerySchema,
  UnreadNotificationsQuerySchema,
  UpdateNotificationPreferencesRequestSchema,
  SendNotificationRequestSchema,
  ScheduleNotificationRequestSchema,
  NotificationsResponseSchema,
  UnreadNotificationsResponseSchema,
  MarkReadResponseSchema,
  MarkAllReadResponseSchema,
  NotificationPreferencesResponseSchema,
  SendNotificationResponseSchema,
  ScheduleNotificationResponseSchema,
  NotificationChannelsResponseSchema,
} from '@athena/types/openapi/notifications';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { getNotificationService } from '../services/notifications/index.js';
import type { NotificationChannel, NotificationPriority } from '../services/notifications/types.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import {
  toNotification,
  toNotificationPreferences,
  toNotificationResult,
} from './notifications/helpers.js';

const app = createOpenAPIApp();

// Require authentication for all notification routes
app.use('*', requireAuth);

// Get notification service

// =============================================================================
// List Notifications
// =============================================================================

const getNotifications = createRoute({
  method: 'get',
  path: '/',
  tags: ['Notifications'],
  summary: 'Get notifications',
  description: 'Get notifications for the authenticated user with pagination.',
  request: {
    query: NotificationsQuerySchema,
  },
  responses: {
    200: {
      description: 'Notifications retrieved successfully',
      content: {
        'application/json': {
          schema: NotificationsResponseSchema,
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

// =============================================================================
// Get Unread Notifications
// =============================================================================

const getUnreadNotifications = createRoute({
  method: 'get',
  path: '/unread',
  tags: ['Notifications'],
  summary: 'Get unread notifications',
  description: 'Get unread notifications for the authenticated user.',
  request: {
    query: UnreadNotificationsQuerySchema,
  },
  responses: {
    200: {
      description: 'Unread notifications retrieved successfully',
      content: {
        'application/json': {
          schema: UnreadNotificationsResponseSchema,
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

// =============================================================================
// Mark Notification as Read
// =============================================================================

const markNotificationRead = createRoute({
  method: 'post',
  path: '/{id}/read',
  tags: ['Notifications'],
  summary: 'Mark notification as read',
  description: 'Mark a specific notification as read.',
  request: {
    params: NotificationIdParamSchema,
  },
  responses: {
    200: {
      description: 'Notification marked as read',
      content: {
        'application/json': {
          schema: MarkReadResponseSchema,
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
    404: {
      description: 'Notification not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Mark All Notifications as Read
// =============================================================================

const markAllNotificationsRead = createRoute({
  method: 'post',
  path: '/read-all',
  tags: ['Notifications'],
  summary: 'Mark all notifications as read',
  description: 'Mark all notifications as read for the authenticated user.',
  responses: {
    200: {
      description: 'All notifications marked as read',
      content: {
        'application/json': {
          schema: MarkAllReadResponseSchema,
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

// =============================================================================
// Get Notification Preferences
// =============================================================================

const getNotificationPreferences = createRoute({
  method: 'get',
  path: '/preferences',
  tags: ['Notifications'],
  summary: 'Get notification preferences',
  description: 'Get notification preferences for the authenticated user.',
  responses: {
    200: {
      description: 'Notification preferences retrieved',
      content: {
        'application/json': {
          schema: NotificationPreferencesResponseSchema,
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

// =============================================================================
// Update Notification Preferences
// =============================================================================

const updateNotificationPreferences = createRoute({
  method: 'patch',
  path: '/preferences',
  tags: ['Notifications'],
  summary: 'Update notification preferences',
  description: 'Update notification preferences for the authenticated user.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateNotificationPreferencesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Notification preferences updated',
      content: {
        'application/json': {
          schema: NotificationPreferencesResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
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

// =============================================================================
// Send Notification
// =============================================================================

const sendNotification = createRoute({
  method: 'post',
  path: '/send',
  tags: ['Notifications'],
  summary: 'Send notification',
  description: 'Send a notification to a user (admin/system use).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SendNotificationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Notification sent',
      content: {
        'application/json': {
          schema: SendNotificationResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
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

// =============================================================================
// Schedule Notification
// =============================================================================

const scheduleNotification = createRoute({
  method: 'post',
  path: '/schedule',
  tags: ['Notifications'],
  summary: 'Schedule notification',
  description: 'Schedule a notification for later delivery.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ScheduleNotificationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Notification scheduled',
      content: {
        'application/json': {
          schema: ScheduleNotificationResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
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

// =============================================================================
// Get Notification Channels
// =============================================================================

const getNotificationChannels = createRoute({
  method: 'get',
  path: '/channels',
  tags: ['Notifications'],
  summary: 'Get notification channels',
  description: 'Get list of configured notification channels.',
  responses: {
    200: {
      description: 'Notification channels retrieved',
      content: {
        'application/json': {
          schema: NotificationChannelsResponseSchema,
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
 * GET /notifications
 * Get notifications for the authenticated user.
 */
app.openapi(getNotifications, async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = c.req.valid('query');

  const service = getNotificationService();
  const notifications = await service.getNotifications(userId, limit, offset);
  const response = notifications.map((notification) => toNotification(notification));

  return c.json({
    success: true as const,
    data: response,
    meta: {
      limit,
      offset,
      count: response.length,
    },
  }, 200);
});

/**
 * GET /notifications/unread
 * Get unread notifications for the authenticated user.
 */
app.openapi(getUnreadNotifications, async (c) => {
  const userId = getUserId(c);
  const { limit } = c.req.valid('query');

  const service = getNotificationService();
  const notifications = await service.getUnreadNotifications(userId, limit);
  const response = notifications.map((notification) => toNotification(notification));

  return c.json({
    success: true as const,
    data: response,
    meta: {
      count: response.length,
    },
  }, 200);
});

/**
 * POST /notifications/:id/read
 * Mark a notification as read.
 */
app.openapi(markNotificationRead, async (c) => {
  const userId = getUserId(c);
  const { id: notificationId } = c.req.valid('param');

  const service = getNotificationService();
  const success = await service.markAsRead(notificationId, userId);

  if (!success) {
    return c.json({ error: 'Not found', message: 'Notification not found' }, 404);
  }

  return c.json({
    success: true,
  }, 200);
});

/**
 * POST /notifications/read-all
 * Mark all notifications as read.
 */
app.openapi(markAllNotificationsRead, async (c) => {
  const userId = getUserId(c);

  const service = getNotificationService();
  const count = await service.markAllAsRead(userId);

  return c.json({
    success: true as const,
    data: {
      markedRead: count,
    },
  }, 200);
});

/**
 * GET /notifications/preferences
 * Get notification preferences for the authenticated user.
 */
app.openapi(getNotificationPreferences, async (c) => {
  const userId = getUserId(c);

  const service = getNotificationService();
  const preferences = await service.getUserPreferences(userId);
  const response = toNotificationPreferences(preferences, userId);

  return c.json({
    data: response,
  }, 200);
});

/**
 * PATCH /notifications/preferences
 * Update notification preferences.
 */
app.openapi(updateNotificationPreferences, async (c) => {
  const userId = getUserId(c);
  const updates = c.req.valid('json');

  const service = getNotificationService();
  await service.updateUserPreferences(userId, updates);

  const preferences = await service.getUserPreferences(userId);
  const response = toNotificationPreferences(preferences, userId);

  return c.json({
    data: response,
  }, 200);
});

/**
 * POST /notifications/send
 * Send a notification (admin/system use).
 */
app.openapi(sendNotification, async (c) => {
  const body = c.req.valid('json');

  const service = getNotificationService();
  const results = await service.send({
    userId: body.userId,
    title: body.title,
    body: body.body,
    channels: body.channels as NotificationChannel[] | undefined,
    priority: body.priority as NotificationPriority | undefined,
    actionUrl: body.actionUrl,
    entityType: body.entityType,
    entityId: body.entityId,
    data: body.data,
  });

  const responseResults = results.map((result) => toNotificationResult(result));

  return c.json({
    success: true as const,
    data: {
      results: responseResults,
      successCount: responseResults.filter((r) => r.success).length,
      failureCount: responseResults.filter((r) => !r.success).length,
    },
  }, 200);
});

/**
 * POST /notifications/schedule
 * Schedule a notification for later delivery.
 */
app.openapi(scheduleNotification, async (c) => {
  const body = c.req.valid('json');

  const service = getNotificationService();
  const id = await service.scheduleNotification({
    userId: body.userId,
    scheduledFor: body.scheduledFor,
    recurrenceRule: body.recurrenceRule,
    notificationType: body.notificationType,
    channels: body.channels as NotificationChannel[],
    title: body.title,
    bodyTemplate: body.bodyTemplate,
    data: body.data,
    actionUrl: body.actionUrl,
    priority: body.priority as NotificationPriority | undefined,
  });

  return c.json({
    success: true as const,
    data: {
      id,
      scheduledFor: body.scheduledFor,
    },
  }, 200);
});

/**
 * GET /notifications/channels
 * Get list of configured notification channels.
 */
app.openapi(getNotificationChannels, (c) => {
  const service = getNotificationService();
  const channels = service.listConfiguredChannels();

  return c.json({
    success: true as const,
    data: {
      channels,
    },
  }, 200);
});

export default app;
