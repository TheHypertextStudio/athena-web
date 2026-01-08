/**
 * Push notification provider.
 *
 * @packageDocumentation
 */

import webpush from 'web-push';
import type {
  NotificationProvider,
  NotificationContent,
  NotificationResult,
  PushConfig,
} from '../types.js';

/**
 * Push notification provider for mobile and web push notifications.
 */
export class PushProvider implements NotificationProvider {
  readonly channel = 'push' as const;

  private readonly config?: PushConfig;
  private webPushInitialized = false;

  constructor(config?: PushConfig) {
    this.config = config;

    // Initialize web-push VAPID keys if configured
    if (config?.provider === 'web-push' && config.webPush) {
      webpush.setVapidDetails(
        config.webPush.subject,
        config.webPush.publicKey,
        config.webPush.privateKey,
      );
      this.webPushInitialized = true;
    }
  }

  async send(
    userId: string,
    content: NotificationContent,
    options?: { deviceTokens?: string[] },
  ): Promise<NotificationResult> {
    if (!this.config) {
      return {
        channel: 'push',
        success: false,
        error: 'Push provider not configured',
      };
    }

    const deviceTokens = options?.deviceTokens;
    if (!deviceTokens || deviceTokens.length === 0) {
      return {
        channel: 'push',
        success: false,
        error: 'No device tokens provided',
      };
    }

    try {
      const externalId = await this.sendPush(deviceTokens, content);
      return {
        channel: 'push',
        success: true,
        externalId,
      };
    } catch (error) {
      return {
        channel: 'push',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send push notification',
      };
    }
  }

  isConfigured(): boolean {
    return !!this.config?.firebase || !!this.config?.webPush;
  }

  private async sendPush(deviceTokens: string[], content: NotificationContent): Promise<string> {
    if (!this.config) {
      throw new Error('Push provider not configured');
    }

    switch (this.config.provider) {
      case 'firebase':
        return this.sendWithFirebase(deviceTokens, content);
      case 'web-push':
        return this.sendWithWebPush(deviceTokens, content);
      default:
        throw new Error(`Unknown push provider: ${this.config.provider}`);
    }
  }

  private async sendWithFirebase(
    deviceTokens: string[],
    content: NotificationContent,
  ): Promise<string> {
    if (!this.config?.firebase) {
      throw new Error('Firebase configuration not provided');
    }

    // Get access token using service account
    const accessToken = await this.getFirebaseAccessToken();

    const message = {
      message: {
        notification: {
          title: content.title,
          body: content.body,
        },
        data: content.data ? this.stringifyData(content.data) : undefined,
        webpush: content.actionUrl
          ? {
              fcm_options: {
                link: content.actionUrl,
              },
            }
          : undefined,
      },
    };

    const results: string[] = [];

    // Send to each device token
    for (const token of deviceTokens) {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.config.firebase.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...message,
            message: {
              ...message.message,
              token,
            },
          }),
        },
      );

      if (response.ok) {
        const data = (await response.json()) as { name: string };
        results.push(data.name);
      }
    }

    return results.join(',');
  }

  private async sendWithWebPush(
    subscriptions: string[],
    content: NotificationContent,
  ): Promise<string> {
    if (!this.webPushInitialized || !this.config?.webPush) {
      throw new Error('Web Push VAPID keys not configured');
    }

    const payload = JSON.stringify({
      title: content.title,
      body: content.body,
      icon: content.data?.['icon'] ?? '/icon-192.png',
      badge: content.data?.['badge'] ?? '/badge-72.png',
      tag: content.data?.['tag'] ?? 'notification',
      data: {
        url: content.actionUrl,
        ...content.data,
      },
    });

    const results: string[] = [];
    const errors: string[] = [];

    for (const subscriptionJson of subscriptions) {
      try {
        // Parse the subscription (stored as JSON string)
        const subscription = JSON.parse(subscriptionJson) as webpush.PushSubscription;

        const result = await webpush.sendNotification(subscription, payload, {
          TTL: this.config.webPush.ttl ?? 86400, // 24 hours default
        });

        results.push(result.statusCode.toString());
      } catch (error) {
        // Handle expired subscriptions (410 Gone)
        if (error instanceof webpush.WebPushError && error.statusCode === 410) {
          errors.push(`subscription_expired:${subscriptionJson.slice(0, 50)}`);
        } else {
          errors.push(error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }

    if (results.length === 0 && errors.length > 0) {
      throw new Error(`All push notifications failed: ${errors.join(', ')}`);
    }

    return `sent:${String(results.length)},failed:${String(errors.length)}`;
  }

  private getFirebaseAccessToken(): Promise<string> {
    if (!this.config?.firebase) {
      return Promise.reject(new Error('Firebase configuration not provided'));
    }

    // For a full implementation, you'd:
    // 1. Create a JWT with claims (iss, scope, aud, iat, exp)
    // 2. Sign it with the private key
    // 3. Exchange it for an access token
    // In production, use google-auth-library or similar.
    return Promise.reject(
      new Error('Firebase auth requires google-auth-library - implement with proper JWT signing'),
    );
  }

  private stringifyData(data: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return result;
  }
}
