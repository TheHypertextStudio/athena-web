/**
 * Slack notification provider.
 *
 * @packageDocumentation
 */

import type {
  NotificationProvider,
  NotificationContent,
  NotificationResult,
  SlackConfig,
} from '../types.js';

/**
 * Slack provider for sending Slack webhook notifications.
 */
export class SlackProvider implements NotificationProvider {
  readonly channel = 'slack' as const;

  private readonly config?: SlackConfig;

  constructor(config?: SlackConfig) {
    this.config = config;
  }

  async send(
    userId: string,
    content: NotificationContent,
    options?: { webhookUrl?: string; channel?: string },
  ): Promise<NotificationResult> {
    const webhookUrl = options?.webhookUrl ?? this.config?.defaultWebhookUrl;

    if (!webhookUrl) {
      return {
        channel: 'slack',
        success: false,
        error: 'No Slack webhook URL provided',
      };
    }

    try {
      await this.sendToSlack(webhookUrl, content, options?.channel);
      return {
        channel: 'slack',
        success: true,
        externalId: crypto.randomUUID(), // Slack doesn't return message IDs for webhooks
      };
    } catch (error) {
      return {
        channel: 'slack',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send Slack notification',
      };
    }
  }

  isConfigured(): boolean {
    return !!this.config?.defaultWebhookUrl;
  }

  private async sendToSlack(
    webhookUrl: string,
    content: NotificationContent,
    channel?: string,
  ): Promise<void> {
    const blocks = this.formatSlackBlocks(content);

    const payload: Record<string, unknown> = {
      blocks,
      text: `${content.title}: ${content.body}`, // Fallback text
    };

    if (channel) {
      payload['channel'] = channel;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Slack webhook error: ${error}`);
    }
  }

  private formatSlackBlocks(content: NotificationContent): unknown[] {
    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: content.title,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: content.body,
        },
      },
    ];

    // Add action button if URL provided
    if (content.actionUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Details',
              emoji: true,
            },
            url: content.actionUrl,
            style: 'primary',
          },
        ],
      });
    }

    // Add context with entity info
    if (content.entityType && content.entityId) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${content.entityType}: ${content.entityId}`,
          },
        ],
      });
    }

    return blocks;
  }
}
