/**
 * Notifications OpenAPI route definitions.
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

// =============================================================================
// List Notifications
// =============================================================================

export const getNotifications = createRoute({
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

export const getUnreadNotifications = createRoute({
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

export const markNotificationRead = createRoute({
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

export const markAllNotificationsRead = createRoute({
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

export const getNotificationPreferences = createRoute({
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

export const updateNotificationPreferences = createRoute({
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

export const sendNotification = createRoute({
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

export const scheduleNotification = createRoute({
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

export const getNotificationChannels = createRoute({
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
