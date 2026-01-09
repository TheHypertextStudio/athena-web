/**
 * Notification routes for the API.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getNotificationService } from '../services/notifications/index.js';
import type { NotificationChannel, NotificationPriority } from '../services/notifications/types.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const app = new Hono();

// Require authentication for all notification routes
app.use('*', requireAuth);

const PAGINATION_LIMIT_MIN = 1;
const PAGINATION_LIMIT_MAX = 100;
const PAGINATION_OFFSET_MIN = 0;
const DEFAULT_NOTIFICATION_LIMIT = 50;
const DEFAULT_NOTIFICATION_OFFSET = 0;
const NOTIFICATION_CHANNEL_VALUES = ['email', 'push', 'sms', 'slack', 'in_app'] as const;
const NOTIFICATION_PRIORITY_VALUES = ['low', 'normal', 'high', 'urgent'] as const;

// Get notification service
const getService = () => getNotificationService();

/**
 * GET /notifications
 * Get notifications for the authenticated user.
 */
app.get(
  '/',
  zValidator(
    'query',
    z.object({
      limit: z.coerce
        .number()
        .min(PAGINATION_LIMIT_MIN)
        .max(PAGINATION_LIMIT_MAX)
        .optional()
        .default(DEFAULT_NOTIFICATION_LIMIT),
      offset: z.coerce
        .number()
        .min(PAGINATION_OFFSET_MIN)
        .optional()
        .default(DEFAULT_NOTIFICATION_OFFSET),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { limit, offset } = c.req.valid('query');

    const service = getService();
    const notifications = await service.getNotifications(userId, limit, offset);

    return c.json({
      success: true,
      data: notifications,
      meta: {
        limit,
        offset,
        count: notifications.length,
      },
    });
  },
);

/**
 * GET /notifications/unread
 * Get unread notifications for the authenticated user.
 */
app.get(
  '/unread',
  zValidator(
    'query',
    z.object({
      limit: z.coerce
        .number()
        .min(PAGINATION_LIMIT_MIN)
        .max(PAGINATION_LIMIT_MAX)
        .optional()
        .default(DEFAULT_NOTIFICATION_LIMIT),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { limit } = c.req.valid('query');

    const service = getService();
    const notifications = await service.getUnreadNotifications(userId, limit);

    return c.json({
      success: true,
      data: notifications,
      meta: {
        count: notifications.length,
      },
    });
  },
);

/**
 * POST /notifications/:id/read
 * Mark a notification as read.
 */
app.post('/:id/read', async (c) => {
  const userId = getUserId(c);
  const notificationId = c.req.param('id');

  const service = getService();
  const success = await service.markAsRead(notificationId, userId);

  if (!success) {
    return c.json(
      {
        success: false,
        error: 'Notification not found',
      },
      404,
    );
  }

  return c.json({
    success: true,
  });
});

/**
 * POST /notifications/read-all
 * Mark all notifications as read.
 */
app.post('/read-all', async (c) => {
  const userId = getUserId(c);

  const service = getService();
  const count = await service.markAllAsRead(userId);

  return c.json({
    success: true,
    data: {
      markedRead: count,
    },
  });
});

/**
 * GET /notifications/preferences
 * Get notification preferences for the authenticated user.
 */
app.get('/preferences', async (c) => {
  const userId = getUserId(c);

  const service = getService();
  const preferences = await service.getUserPreferences(userId);

  return c.json({
    success: true,
    data: preferences,
  });
});

/**
 * PATCH /notifications/preferences
 * Update notification preferences.
 */
app.patch(
  '/preferences',
  zValidator(
    'json',
    z.object({
      emailEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      smsEnabled: z.boolean().optional(),
      slackEnabled: z.boolean().optional(),
      inAppEnabled: z.boolean().optional(),
      emailAddress: z.email().optional(),
      phoneNumber: z.string().optional(),
      slackWebhookUrl: z.url().optional(),
      slackChannel: z.string().optional(),
      quietHoursEnabled: z.boolean().optional(),
      quietHoursStart: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      quietHoursEnd: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      quietHoursTimezone: z.string().optional(),
      taskDeadlineReminders: z.boolean().optional(),
      taskAssignmentNotifications: z.boolean().optional(),
      taskCompletionNotifications: z.boolean().optional(),
      eventReminders: z.boolean().optional(),
      dailyPlanningReminder: z.boolean().optional(),
      weeklyReviewReminder: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const updates = c.req.valid('json');

    const service = getService();
    await service.updateUserPreferences(userId, updates);

    const preferences = await service.getUserPreferences(userId);

    return c.json({
      success: true,
      data: preferences,
    });
  },
);

/**
 * POST /notifications/send
 * Send a notification (admin/system use).
 */
app.post(
  '/send',
  zValidator(
    'json',
    z.object({
      userId: z.uuid(),
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(2000),
      channels: z.array(z.enum(NOTIFICATION_CHANNEL_VALUES)).optional(),
      priority: z.enum(NOTIFICATION_PRIORITY_VALUES).optional(),
      actionUrl: z.url().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid('json');

    const service = getService();
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

    return c.json({
      success: true,
      data: {
        results,
        successCount: results.filter((r) => r.success).length,
        failureCount: results.filter((r) => !r.success).length,
      },
    });
  },
);

/**
 * POST /notifications/schedule
 * Schedule a notification for later delivery.
 */
app.post(
  '/schedule',
  zValidator(
    'json',
    z.object({
      userId: z.uuid(),
      scheduledFor: z.iso.datetime(),
      recurrenceRule: z.string().optional(),
      notificationType: z.string(),
      channels: z.array(z.enum(NOTIFICATION_CHANNEL_VALUES)),
      title: z.string().min(1).max(200),
      bodyTemplate: z.string().min(1).max(2000),
      data: z.record(z.string(), z.unknown()).optional(),
      actionUrl: z.url().optional(),
      priority: z.enum(NOTIFICATION_PRIORITY_VALUES).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid('json');

    const service = getService();
    const id = await service.scheduleNotification({
      userId: body.userId,
      scheduledFor: new Date(body.scheduledFor),
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
      success: true,
      data: {
        id,
        scheduledFor: body.scheduledFor,
      },
    });
  },
);

/**
 * GET /notifications/channels
 * Get list of configured notification channels.
 */
app.get('/channels', (c) => {
  const service = getService();
  const channels = service.listConfiguredChannels();

  return c.json({
    success: true,
    data: {
      channels,
    },
  });
});

export default app;
