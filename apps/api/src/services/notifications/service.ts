/**
 * Notification service - manages multi-channel notifications.
 *
 * @packageDocumentation
 */

import { db } from '../../db/index.js';
import {
  notifications,
  notificationPreferences,
  scheduledNotifications,
} from '../../db/schema/index.js';
import { eq, and, desc, isNull, lte } from 'drizzle-orm';
import rrule from 'rrule';
const { rrulestr } = rrule;
import type {
  NotificationChannel,
  NotificationContent,
  NotificationServiceConfig,
  NotificationResult,
  SendNotificationOptions,
  NotificationProvider,
  NotificationPriority,
} from './types.js';
import { EmailProvider } from './providers/email.js';
import { PushProvider } from './providers/push.js';
import { SmsProvider } from './providers/sms.js';
import { SlackProvider } from './providers/slack.js';
import { InAppProvider } from './providers/in-app.js';
import { env } from '../../lib/env.js';

/**
 * Notification service for sending notifications across multiple channels.
 */
export class NotificationService {
  private readonly providers = new Map<NotificationChannel, NotificationProvider>();

  constructor(config: NotificationServiceConfig = {}) {
    // Initialize providers
    this.providers.set('email', new EmailProvider(config.email));
    this.providers.set('push', new PushProvider(config.push));
    this.providers.set('sms', new SmsProvider(config.sms));
    this.providers.set('slack', new SlackProvider(config.slack));
    this.providers.set('in_app', new InAppProvider());
  }

  /**
   * Send a notification to a user.
   */
  async send(options: SendNotificationOptions): Promise<NotificationResult[]> {
    const { userId, channels, priority = 'normal', ...content } = options;

    // Get user preferences
    const prefs = await this.getUserPreferences(userId);

    // Determine channels to use
    const targetChannels = channels ?? this.getDefaultChannels(prefs, priority);

    // Filter channels based on preferences and quiet hours
    const effectiveChannels = this.filterChannels(targetChannels, prefs, priority);

    // Send to each channel
    const results: NotificationResult[] = [];

    for (const channel of effectiveChannels) {
      const result = await this.sendToChannel(userId, channel, content, prefs, priority);
      results.push(result);

      // Store notification record (except for in_app which stores itself)
      if (channel !== 'in_app') {
        await this.storeNotificationRecord(userId, channel, content, result, priority);
      }
    }

    return results;
  }

  /**
   * Get user's notification preferences.
   */
  async getUserPreferences(userId: string) {
    const prefs = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });

    return prefs ?? this.getDefaultPreferences();
  }

  /**
   * Update user's notification preferences.
   */
  async updateUserPreferences(
    userId: string,
    updates: Partial<{
      emailEnabled: boolean;
      pushEnabled: boolean;
      smsEnabled: boolean;
      slackEnabled: boolean;
      inAppEnabled: boolean;
      emailAddress: string;
      phoneNumber: string;
      slackWebhookUrl: string;
      slackChannel: string;
      quietHoursEnabled: boolean;
      quietHoursStart: string;
      quietHoursEnd: string;
      quietHoursTimezone: string;
      taskDeadlineReminders: boolean;
      taskAssignmentNotifications: boolean;
      taskCompletionNotifications: boolean;
      eventReminders: boolean;
      dailyPlanningReminder: boolean;
      weeklyReviewReminder: boolean;
    }>,
  ): Promise<void> {
    const existing = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });

    const now = new Date();

    if (existing) {
      await db
        .update(notificationPreferences)
        .set({ ...updates, updatedAt: now })
        .where(eq(notificationPreferences.id, existing.id));
    } else {
      await db.insert(notificationPreferences).values({
        id: crypto.randomUUID(),
        userId,
        ...updates,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Get unread notifications for a user.
   */
  async getUnreadNotifications(userId: string, limit = 50) {
    return db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, userId),
        eq(notifications.channel, 'in_app'),
        isNull(notifications.readAt),
      ),
      orderBy: [desc(notifications.createdAt)],
      limit,
    });
  }

  /**
   * Get all notifications for a user.
   */
  async getNotifications(userId: string, limit = 50, offset = 0) {
    return db.query.notifications.findMany({
      where: and(eq(notifications.userId, userId), eq(notifications.channel, 'in_app')),
      orderBy: [desc(notifications.createdAt)],
      limit,
      offset,
    });
  }

  /**
   * Mark a notification as read.
   */
  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const notification = await db.query.notifications.findFirst({
      where: and(eq(notifications.id, notificationId), eq(notifications.userId, userId)),
    });

    if (!notification) {
      return false;
    }

    await db
      .update(notifications)
      .set({ readAt: new Date(), status: 'read' })
      .where(eq(notifications.id, notificationId));

    return true;
  }

  /**
   * Mark all notifications as read for a user.
   */
  async markAllAsRead(userId: string): Promise<number> {
    // Get unread notifications first to count them
    const unread = await db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, userId),
        eq(notifications.channel, 'in_app'),
        isNull(notifications.readAt),
      ),
      columns: { id: true },
    });

    if (unread.length === 0) {
      return 0;
    }

    await db
      .update(notifications)
      .set({ readAt: new Date(), status: 'read' })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.channel, 'in_app'),
          isNull(notifications.readAt),
        ),
      );

    return unread.length;
  }

  /**
   * Schedule a notification for later delivery.
   */
  async scheduleNotification(options: {
    userId: string;
    scheduledFor: Date;
    recurrenceRule?: string;
    notificationType: string;
    channels: NotificationChannel[];
    title: string;
    bodyTemplate: string;
    data?: Record<string, unknown>;
    actionUrl?: string;
    priority?: NotificationPriority;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(scheduledNotifications).values({
      id,
      userId: options.userId,
      scheduledFor: options.scheduledFor,
      recurrenceRule: options.recurrenceRule ?? null,
      notificationType: options.notificationType,
      channels: options.channels,
      title: options.title,
      bodyTemplate: options.bodyTemplate,
      data: options.data ?? null,
      actionUrl: options.actionUrl ?? null,
      priority: options.priority ?? 'normal',
      nextRunAt: options.scheduledFor,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  }

  /**
   * Process pending scheduled notifications.
   * This should be called by a cron job or background worker.
   */
  async processScheduledNotifications(): Promise<number> {
    const now = new Date();

    const pending = await db.query.scheduledNotifications.findMany({
      where: and(
        eq(scheduledNotifications.isActive, true),
        lte(scheduledNotifications.nextRunAt, now),
      ),
    });

    let processed = 0;

    for (const scheduled of pending) {
      try {
        // Send the notification
        await this.send({
          userId: scheduled.userId,
          channels: scheduled.channels as NotificationChannel[],
          priority: scheduled.priority,
          title: scheduled.title,
          body: scheduled.bodyTemplate,
          data: scheduled.data as Record<string, unknown> | undefined,
          actionUrl: scheduled.actionUrl ?? undefined,
        });

        // Update last sent time
        await db
          .update(scheduledNotifications)
          .set({
            lastSentAt: now,
            nextRunAt: scheduled.recurrenceRule
              ? this.calculateNextRun(scheduled.recurrenceRule, now)
              : null,
            isActive: !!scheduled.recurrenceRule,
            updatedAt: now,
          })
          .where(eq(scheduledNotifications.id, scheduled.id));

        processed++;
      } catch (error) {
        console.error(`Failed to process scheduled notification ${scheduled.id}:`, error);
      }
    }

    return processed;
  }

  /**
   * List available channels that are configured.
   */
  listConfiguredChannels(): NotificationChannel[] {
    const configured: NotificationChannel[] = [];
    for (const [channel, provider] of this.providers) {
      if (provider.isConfigured()) {
        configured.push(channel);
      }
    }
    return configured;
  }

  private async sendToChannel(
    userId: string,
    channel: NotificationChannel,
    content: NotificationContent,
    prefs: Awaited<ReturnType<typeof this.getUserPreferences>>,
    priority: NotificationPriority,
  ): Promise<NotificationResult> {
    const provider = this.providers.get(channel);
    if (!provider) {
      return {
        channel,
        success: false,
        error: `Provider not found for channel: ${channel}`,
      };
    }

    // Build channel-specific options
    const options: Record<string, unknown> = { priority };

    switch (channel) {
      case 'email':
        options.email = prefs.emailAddress;
        break;
      case 'push':
        options.deviceTokens = prefs.pushDeviceTokens as string[] | undefined;
        break;
      case 'sms':
        options.phoneNumber = prefs.phoneNumber;
        break;
      case 'slack':
        options.webhookUrl = prefs.slackWebhookUrl;
        options.channel = prefs.slackChannel;
        break;
    }

    return provider.send(userId, content, options);
  }

  private async storeNotificationRecord(
    userId: string,
    channel: NotificationChannel,
    content: NotificationContent,
    result: NotificationResult,
    priority: NotificationPriority,
  ): Promise<void> {
    const now = new Date();

    await db.insert(notifications).values({
      id: result.notificationId ?? crypto.randomUUID(),
      userId,
      channel,
      status: result.success ? 'sent' : 'failed',
      priority,
      title: content.title,
      body: content.body,
      data: content.data ?? null,
      actionUrl: content.actionUrl ?? null,
      entityType: content.entityType ?? null,
      entityId: content.entityId ?? null,
      externalId: result.externalId ?? null,
      sentAt: result.success ? now : null,
      failedAt: result.success ? null : now,
      failureReason: result.error ?? null,
      createdAt: now,
    });
  }

  private getDefaultChannels(
    prefs: Awaited<ReturnType<typeof this.getUserPreferences>>,
    priority: NotificationPriority,
  ): NotificationChannel[] {
    const channels: NotificationChannel[] = [];

    if (prefs.inAppEnabled) channels.push('in_app');
    if (prefs.emailEnabled) channels.push('email');
    if (prefs.pushEnabled) channels.push('push');

    // SMS only for urgent notifications by default
    if (prefs.smsEnabled && (priority === 'urgent' || !prefs.smsUrgentOnly)) {
      channels.push('sms');
    }

    if (prefs.slackEnabled) channels.push('slack');

    return channels;
  }

  private filterChannels(
    channels: NotificationChannel[],
    prefs: Awaited<ReturnType<typeof this.getUserPreferences>>,
    priority: NotificationPriority,
  ): NotificationChannel[] {
    // Check quiet hours (urgent notifications bypass quiet hours)
    if (priority !== 'urgent' && this.isInQuietHours(prefs)) {
      // During quiet hours, only send in-app notifications
      return channels.filter((c) => c === 'in_app');
    }

    // Filter out disabled channels
    return channels.filter((channel) => {
      switch (channel) {
        case 'email':
          return prefs.emailEnabled && !!prefs.emailAddress;
        case 'push': {
          const tokens = prefs.pushDeviceTokens as unknown[] | null;
          return prefs.pushEnabled && Array.isArray(tokens) && tokens.length > 0;
        }
        case 'sms':
          return prefs.smsEnabled && !!prefs.phoneNumber;
        case 'slack':
          return prefs.slackEnabled && !!prefs.slackWebhookUrl;
        case 'in_app':
          return prefs.inAppEnabled;
        default:
          return false;
      }
    });
  }

  private isInQuietHours(prefs: Awaited<ReturnType<typeof this.getUserPreferences>>): boolean {
    if (!prefs.quietHoursEnabled || !prefs.quietHoursStart || !prefs.quietHoursEnd) {
      return false;
    }

    const now = new Date();
    const [startHour, startMin] = prefs.quietHoursStart.split(':').map(Number);
    const [endHour, endMin] = prefs.quietHoursEnd.split(':').map(Number);

    // Get current time in user's timezone using Intl API
    const timezone = prefs.quietHoursTimezone ?? 'UTC';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const currentHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const currentMin = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const currentTime = currentHour * 60 + currentMin;

    const startTime = (startHour ?? 0) * 60 + (startMin ?? 0);
    const endTime = (endHour ?? 0) * 60 + (endMin ?? 0);

    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }

    return currentTime >= startTime && currentTime < endTime;
  }

  private calculateNextRun(rruleString: string, from: Date): Date | null {
    try {
      // Parse the RRULE string using the rrule library
      const rule = rrulestr(rruleString);

      // Get the next occurrence after the given date
      const nextOccurrence = rule.after(from, false);

      return nextOccurrence;
    } catch (error) {
      // If parsing fails, log the error and return null
      console.error(`Failed to parse RRULE: ${rruleString}`, error);
      return null;
    }
  }

  private getDefaultPreferences() {
    return {
      emailEnabled: true,
      pushEnabled: true,
      smsEnabled: false,
      slackEnabled: false,
      inAppEnabled: true,
      emailAddress: null,
      phoneNumber: null,
      slackWebhookUrl: null,
      slackChannel: null,
      pushDeviceTokens: null,
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
      smsUrgentOnly: true,
      taskDeadlineReminders: true,
      taskAssignmentNotifications: true,
      taskCompletionNotifications: true,
      eventReminders: true,
      dailyPlanningReminder: true,
      weeklyReviewReminder: true,
    };
  }
}

/**
 * Create a notification service from environment variables.
 */
export function createNotificationService(): NotificationService {
  const config: NotificationServiceConfig = {};

  // Email configuration - use validated config object
  if (env.resendEmail) {
    config.email = {
      provider: 'resend',
      apiKey: env.resendEmail.apiKey,
      fromEmail: env.resendEmail.senderAddress,
      fromName: env.resendEmail.senderName,
    };
  }

  // SMS configuration (Twilio) - use validated config object
  if (env.twilioSms) {
    config.sms = {
      provider: 'twilio',
      accountSid: env.twilioSms.accountSid,
      authToken: env.twilioSms.authToken,
      fromNumber: env.twilioSms.phoneNumber,
    };
  }

  // Slack configuration
  if (env.SLACK_WEBHOOK_URL) {
    config.slack = {
      defaultWebhookUrl: env.SLACK_WEBHOOK_URL,
    };
  }

  return new NotificationService(config);
}

// Singleton instance
let notificationServiceInstance: NotificationService | null = null;

/**
 * Get the shared notification service instance.
 */
export function getNotificationService(): NotificationService {
  notificationServiceInstance ??= createNotificationService();
  return notificationServiceInstance;
}
