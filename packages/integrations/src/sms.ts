/**
 * `@docket/integrations` - SMS sender contracts and adapters.
 *
 * @remarks
 * Notification policy decides whether SMS may be sent. This module owns the
 * provider edge for sending one already-authorized SMS message.
 */
import { realEnvValue } from '@docket/env';

import { FIXED_NOW } from './fixtures';
import { defaultHttpClient, type HttpClient } from './http';
import { firstString, optionalJsonResponse } from './json';

/** An outbound SMS message. */
export interface OutboundSms {
  /** Recipient phone number, normalized to the provider-ready format. */
  readonly to: string;
  /** Message body. */
  readonly body: string;
}

/** A sent SMS message recorded by a provider or capture adapter. */
export interface SentSms extends OutboundSms {
  /** Provider/mock message id. */
  readonly id: string;
  /** ISO-8601 timestamp the provider accepted the message. */
  readonly sentAt: string;
}

/** The SMS sender port. */
export interface SmsSender {
  /**
   * Send one SMS message.
   *
   * @param message - The recipient number and body.
   * @returns provider/capture metadata for the accepted send.
   */
  send(message: OutboundSms): Promise<SentSms>;
}

/** Construction options for {@link CaptureSmsSender}. */
export interface CaptureSmsSenderOptions {
  /** Fixed ISO-8601 "now" recorded as each message's `sentAt`. */
  readonly now?: string;
}

/** An in-memory SMS sender that captures every message for assertions. */
export class CaptureSmsSender implements SmsSender {
  private readonly now: string;
  private counter = 0;
  /** Every SMS captured so far, in send order. */
  readonly outbox: SentSms[] = [];

  /**
   * @param options - Optional fixed `now` for deterministic `sentAt` timestamps.
   */
  constructor(options: CaptureSmsSenderOptions = {}) {
    this.now = options.now ?? FIXED_NOW;
  }

  /** {@inheritDoc SmsSender.send} */
  async send(message: OutboundSms): Promise<SentSms> {
    this.counter += 1;
    const sent: SentSms = {
      ...message,
      id: `sms_${this.counter.toString().padStart(6, '0')}`,
      sentAt: this.now,
    };
    this.outbox.push(sent);
    return sent;
  }

  /** The most recently captured SMS, or `undefined` when the outbox is empty. */
  last(): SentSms | undefined {
    return this.outbox[this.outbox.length - 1];
  }
}

/** Validated configuration for {@link RealSmsSender}. */
export interface RealSmsSenderConfig {
  /** Provider send endpoint URL. */
  readonly endpoint: string;
  /** Provider API key/token. */
  readonly apiKey: string;
  /** Sender phone number configured with the provider. */
  readonly from: string;
}

/** Raw env shape parsed by {@link smsConfigFromEnv}. */
export interface SmsEnv {
  /** `SMS_ENDPOINT`. */
  readonly SMS_ENDPOINT?: string;
  /** `SMS_API_KEY`. */
  readonly SMS_API_KEY?: string;
  /** `SMS_FROM`. */
  readonly SMS_FROM?: string;
}

/** Parse SMS env into a real adapter config, or `null` when incomplete. */
export function smsConfigFromEnv(env: SmsEnv): RealSmsSenderConfig | null {
  const endpoint = realEnvValue(env.SMS_ENDPOINT);
  const apiKey = realEnvValue(env.SMS_API_KEY);
  const from = realEnvValue(env.SMS_FROM);
  if (!endpoint || !apiKey || !from) return null;
  return { endpoint, apiKey, from };
}

/** A real SMS sender that posts JSON to an HTTP SMS provider. */
export class RealSmsSender implements SmsSender {
  private readonly config: RealSmsSenderConfig;
  private readonly http: HttpClient;

  /**
   * @param config - Validated endpoint, key, and sender from env.
   * @param http - HTTP transport, defaulting to platform `fetch`.
   */
  constructor(config: RealSmsSenderConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
  }

  /** {@inheritDoc SmsSender.send} */
  async send(message: OutboundSms): Promise<SentSms> {
    const res = await this.http(this.config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.config.from, ...message }),
    });
    if (!res.ok) throw new Error(`RealSmsSender send failed: ${res.status}`);
    const payload = await optionalJsonResponse(res);
    return {
      ...message,
      id: firstString(payload, ['id', 'messageId']) ?? `sms_${res.status}`,
      sentAt: new Date().toISOString(),
    };
  }
}
