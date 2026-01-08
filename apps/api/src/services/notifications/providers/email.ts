/**
 * Email notification provider with dependency injection.
 *
 * @packageDocumentation
 */

import { Resend } from 'resend';
import type {
  NotificationProvider,
  NotificationContent,
  NotificationResult,
  EmailConfig,
} from '../types.js';
import { EMAIL_PROVIDERS } from '../types.js';

/**
 * Email sending interface for dependency injection.
 * Implement this interface to add new email providers.
 */
export interface EmailSender {
  /**
   * Send an email.
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param html - HTML body content
   * @param text - Plain text body content
   * @param from - From address (formatted as "Name <email>" or just "email")
   * @returns External ID from the email provider
   */
  send(to: string, subject: string, html: string, text: string, from: string): Promise<string>;
}

/**
 * Resend email sender implementation using the official SDK.
 */
export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(
    to: string,
    subject: string,
    html: string,
    text: string,
    from: string,
  ): Promise<string> {
    const { data, error } = await this.client.emails.send({
      from,
      to: [to],
      subject,
      html,
      text,
    });

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    // After error check, data is guaranteed to be non-null by Resend SDK types
    return data.id;
  }
}

/**
 * Registry of email sender factories.
 * Add new providers here to extend email functionality.
 */
const emailSenderFactories: Record<string, (config: EmailConfig) => EmailSender> = {
  [EMAIL_PROVIDERS.RESEND]: (config) => new ResendEmailSender(config.apiKey),
};

/**
 * Register a custom email sender factory.
 * Use this to add support for additional email providers at runtime.
 */
export function registerEmailSender(
  provider: string,
  factory: (config: EmailConfig) => EmailSender,
): void {
  emailSenderFactories[provider] = factory;
}

/**
 * Factory to create email senders based on configuration.
 */
export function createEmailSender(config: EmailConfig): EmailSender {
  const factory = emailSenderFactories[config.provider];
  if (!factory) {
    const supported = Object.keys(emailSenderFactories).join(', ');
    throw new Error(
      `Email provider '${config.provider}' is not registered. ` +
        `Supported providers: ${supported}. ` +
        `Use registerEmailSender() to add custom providers.`,
    );
  }
  return factory(config);
}

/**
 * Email provider for sending email notifications.
 * Uses dependency injection for the underlying email sender.
 */
export class EmailProvider implements NotificationProvider {
  readonly channel = 'email' as const;

  private readonly sender: EmailSender | null;
  private readonly fromAddress: string;

  /**
   * Create an email provider.
   * @param config - Email configuration (optional)
   * @param sender - Optional email sender for dependency injection. If not provided, creates one from config.
   */
  constructor(config?: EmailConfig, sender?: EmailSender) {
    if (config) {
      this.sender = sender ?? createEmailSender(config);
      this.fromAddress = config.fromName
        ? `${config.fromName} <${config.fromEmail}>`
        : config.fromEmail;
    } else {
      this.sender = null;
      this.fromAddress = '';
    }
  }

  async send(
    userId: string,
    content: NotificationContent,
    options?: { email?: string },
  ): Promise<NotificationResult> {
    if (!this.sender) {
      return {
        channel: 'email',
        success: false,
        error: 'Email provider not configured',
      };
    }

    const toEmail = options?.email;
    if (!toEmail) {
      return {
        channel: 'email',
        success: false,
        error: 'No email address provided',
      };
    }

    try {
      const externalId = await this.sender.send(
        toEmail,
        content.title,
        this.formatHtmlBody(content),
        content.body,
        this.fromAddress,
      );
      return {
        channel: 'email',
        success: true,
        externalId,
      };
    } catch (error) {
      return {
        channel: 'email',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send email',
      };
    }
  }

  isConfigured(): boolean {
    return this.sender !== null;
  }

  private formatHtmlBody(content: NotificationContent): string {
    const actionButton = content.actionUrl
      ? `<p><a href="${content.actionUrl}" style="display: inline-block; padding: 10px 20px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">View Details</a></p>`
      : '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 16px;">${content.title}</h1>
          <p style="margin-bottom: 16px;">${content.body}</p>
          ${actionButton}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #6b7280; font-size: 14px;">This email was sent by Project Athena</p>
        </body>
      </html>
    `;
  }
}
