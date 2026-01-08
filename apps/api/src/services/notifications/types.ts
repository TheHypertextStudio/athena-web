/**
 * Notification service types.
 *
 * @packageDocumentation
 */

/**
 * Notification channels.
 */
export type NotificationChannel = 'email' | 'push' | 'sms' | 'slack' | 'in_app';

/**
 * Notification priority levels.
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Notification content.
 */
export interface NotificationContent {
  title: string;
  body: string;
  /** Additional data for the notification */
  data?: Record<string, unknown>;
  /** Action URL for deep linking */
  actionUrl?: string;
  /** Related entity type */
  entityType?: string;
  /** Related entity ID */
  entityId?: string;
}

/**
 * Options for sending a notification.
 */
export interface SendNotificationOptions extends NotificationContent {
  userId: string;
  channels?: NotificationChannel[];
  priority?: NotificationPriority;
}

/**
 * Result of sending a notification.
 */
export interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  notificationId?: string;
  externalId?: string;
  error?: string;
}

/**
 * Supported email provider identifiers.
 */
export const EMAIL_PROVIDERS = {
  RESEND: 'resend',
  SMTP: 'smtp',
} as const;

/**
 * Email provider type derived from the EMAIL_PROVIDERS constant.
 */
export type EmailProviderType = (typeof EMAIL_PROVIDERS)[keyof typeof EMAIL_PROVIDERS];

/**
 * Email notification configuration.
 */
export interface EmailConfig {
  /** Email provider identifier */
  provider: EmailProviderType;
  /** API key for email provider */
  apiKey: string;
  /** From email address */
  fromEmail: string;
  /** From name (optional) */
  fromName?: string;
  /** SMTP configuration (for SMTP provider) */
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
}

/**
 * Push notification configuration.
 */
export interface PushConfig {
  /** Push provider */
  provider: 'firebase' | 'apns' | 'web-push';
  /** Firebase configuration */
  firebase?: {
    projectId: string;
    privateKey: string;
    clientEmail: string;
  };
  /** Web Push VAPID keys */
  webPush?: {
    publicKey: string;
    privateKey: string;
    subject: string;
    /** TTL in seconds (default 86400 = 24 hours) */
    ttl?: number;
  };
}

/**
 * SMS configuration.
 */
export interface SmsConfig {
  /** SMS provider */
  provider: 'twilio' | 'vonage';
  /** Account SID or API key */
  accountSid: string;
  /** Auth token or API secret */
  authToken: string;
  /** From phone number */
  fromNumber: string;
}

/**
 * Slack configuration.
 */
export interface SlackConfig {
  /** Default webhook URL (user can override) */
  defaultWebhookUrl?: string;
}

/**
 * Full notification service configuration.
 */
export interface NotificationServiceConfig {
  email?: EmailConfig;
  push?: PushConfig;
  sms?: SmsConfig;
  slack?: SlackConfig;
}

/**
 * Interface for notification channel providers.
 */
export interface NotificationProvider {
  /** Channel type */
  readonly channel: NotificationChannel;

  /**
   * Send a notification.
   */
  send(
    userId: string,
    content: NotificationContent,
    options?: Record<string, unknown>,
  ): Promise<NotificationResult>;

  /**
   * Check if the provider is configured.
   */
  isConfigured(): boolean;
}

/**
 * Notification types for categorization.
 */
export const NOTIFICATION_TYPES = {
  // Task notifications
  TASK_ASSIGNED: 'task_assigned',
  TASK_DEADLINE_REMINDER: 'task_deadline_reminder',
  TASK_COMPLETED: 'task_completed',
  TASK_OVERDUE: 'task_overdue',

  // Event notifications
  EVENT_REMINDER: 'event_reminder',
  EVENT_INVITATION: 'event_invitation',
  EVENT_UPDATED: 'event_updated',
  EVENT_CANCELLED: 'event_cancelled',

  // Project notifications
  PROJECT_STATUS_CHANGED: 'project_status_changed',
  PROJECT_DEADLINE_APPROACHING: 'project_deadline_approaching',

  // Time tracking
  TIMER_RUNNING_LONG: 'timer_running_long',

  // Productivity
  DAILY_PLANNING_REMINDER: 'daily_planning_reminder',
  DAILY_REVIEW_REMINDER: 'daily_review_reminder',
  WEEKLY_REVIEW_REMINDER: 'weekly_review_reminder',

  // System
  ACCOUNT_ACTIVITY: 'account_activity',
  SECURITY_ALERT: 'security_alert',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
