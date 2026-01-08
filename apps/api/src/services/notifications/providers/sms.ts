/**
 * SMS notification provider.
 *
 * @packageDocumentation
 */

import type {
  NotificationProvider,
  NotificationContent,
  NotificationResult,
  SmsConfig,
} from '../types.js';

/**
 * SMS provider for sending text message notifications.
 */
export class SmsProvider implements NotificationProvider {
  readonly channel = 'sms' as const;

  private readonly config?: SmsConfig;

  constructor(config?: SmsConfig) {
    this.config = config;
  }

  async send(
    userId: string,
    content: NotificationContent,
    options?: { phoneNumber?: string },
  ): Promise<NotificationResult> {
    if (!this.config) {
      return {
        channel: 'sms',
        success: false,
        error: 'SMS provider not configured',
      };
    }

    const phoneNumber = options?.phoneNumber;
    if (!phoneNumber) {
      return {
        channel: 'sms',
        success: false,
        error: 'No phone number provided',
      };
    }

    try {
      const externalId = await this.sendSms(phoneNumber, content);
      return {
        channel: 'sms',
        success: true,
        externalId,
      };
    } catch (error) {
      return {
        channel: 'sms',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send SMS',
      };
    }
  }

  isConfigured(): boolean {
    return this.config !== undefined;
  }

  private async sendSms(phoneNumber: string, content: NotificationContent): Promise<string> {
    if (!this.config) {
      throw new Error('SMS provider not configured');
    }

    switch (this.config.provider) {
      case 'twilio':
        return this.sendWithTwilio(phoneNumber, content);
      case 'vonage':
        return this.sendWithVonage(phoneNumber, content);
    }
  }

  private async sendWithTwilio(phoneNumber: string, content: NotificationContent): Promise<string> {
    if (!this.config) {
      throw new Error('Twilio configuration not provided');
    }

    const messageBody = this.formatSmsBody(content);
    const formData = new URLSearchParams();
    formData.append('To', phoneNumber);
    formData.append('From', this.config.fromNumber);
    formData.append('Body', messageBody);

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio API error: ${error}`);
    }

    const data = (await response.json()) as { sid: string };
    return data.sid;
  }

  private async sendWithVonage(phoneNumber: string, content: NotificationContent): Promise<string> {
    if (!this.config) {
      throw new Error('Vonage configuration not provided');
    }

    const messageBody = this.formatSmsBody(content);

    const response = await fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.config.accountSid,
        api_secret: this.config.authToken,
        from: this.config.fromNumber,
        to: phoneNumber.replace(/^\+/, ''),
        text: messageBody,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vonage API error: ${error}`);
    }

    const data = (await response.json()) as { messages: { 'message-id': string }[] };
    const messageId = data.messages[0]?.['message-id'];
    if (!messageId) {
      throw new Error('No message ID returned from Vonage');
    }
    return messageId;
  }

  private formatSmsBody(content: NotificationContent): string {
    // SMS is limited to 160 characters (or 70 for Unicode)
    // Include link if provided, but keep message concise
    let message = `${content.title}: ${content.body}`;

    if (content.actionUrl) {
      // Leave room for URL
      const maxBodyLength = 160 - content.actionUrl.length - 1;
      if (message.length > maxBodyLength) {
        message = message.substring(0, maxBodyLength - 3) + '...';
      }
      message += ` ${content.actionUrl}`;
    } else if (message.length > 160) {
      message = message.substring(0, 157) + '...';
    }

    return message;
  }
}
