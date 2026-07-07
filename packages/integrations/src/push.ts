/**
 * `@docket/integrations` - push notification sender contracts and adapters.
 *
 * @remarks
 * Token lifecycle handling is surfaced through typed errors so the notification
 * service can disable invalid contact points without knowing provider-specific
 * response shapes.
 */
import { realEnvValue } from '@docket/env';

import { FIXED_NOW } from './fixtures';
import { defaultHttpClient, type HttpClient } from './http';
import { firstString, optionalJsonResponse } from './json';

/** An outbound push notification. */
export interface OutboundPush {
  /** Device/browser push token. */
  readonly token: string;
  /** Notification title. */
  readonly title: string;
  /** Optional notification body. */
  readonly body?: string;
  /** Optional provider data payload. */
  readonly data?: Record<string, string>;
}

/** A sent push notification recorded by a provider or capture adapter. */
export interface SentPush extends OutboundPush {
  /** Provider/mock message id. */
  readonly id: string;
  /** ISO-8601 timestamp the provider accepted the push. */
  readonly sentAt: string;
}

/** Structured push send failure kind. */
export type PushSendErrorCode = 'invalid_token' | 'provider_error';

/** A typed push provider failure. */
export class PushSendError extends Error {
  /** Machine-readable failure kind. */
  readonly code: PushSendErrorCode;

  /**
   * @param code - Machine-readable failure kind.
   * @param message - Human-readable, secret-free error text.
   */
  constructor(code: PushSendErrorCode, message: string) {
    super(message);
    this.name = 'PushSendError';
    this.code = code;
  }
}

/** The push sender port. */
export interface PushSender {
  /**
   * Send one push notification.
   *
   * @param message - The token, title/body, and optional data payload.
   * @returns provider/capture metadata for the accepted send.
   * @throws {PushSendError} When the provider reports a typed token/provider failure.
   */
  send(message: OutboundPush): Promise<SentPush>;
}

/** Construction options for {@link CapturePushSender}. */
export interface CapturePushSenderOptions {
  /** Fixed ISO-8601 "now" recorded as each push's `sentAt`. */
  readonly now?: string;
  /** Tokens that should fail with `invalid_token`, useful for adapter tests. */
  readonly invalidTokens?: ReadonlySet<string>;
}

/** An in-memory push sender that captures every message for assertions. */
export class CapturePushSender implements PushSender {
  private readonly now: string;
  private readonly invalidTokens: ReadonlySet<string>;
  private counter = 0;
  /** Every push captured so far, in send order. */
  readonly outbox: SentPush[] = [];

  /**
   * @param options - Optional deterministic clock and invalid-token set.
   */
  constructor(options: CapturePushSenderOptions = {}) {
    this.now = options.now ?? FIXED_NOW;
    this.invalidTokens = options.invalidTokens ?? new Set<string>();
  }

  /** {@inheritDoc PushSender.send} */
  async send(message: OutboundPush): Promise<SentPush> {
    if (this.invalidTokens.has(message.token)) {
      throw new PushSendError('invalid_token', 'CapturePushSender invalid token');
    }
    this.counter += 1;
    const sent: SentPush = {
      ...message,
      id: `push_${this.counter.toString().padStart(6, '0')}`,
      sentAt: this.now,
    };
    this.outbox.push(sent);
    return sent;
  }

  /** The most recently captured push, or `undefined` when the outbox is empty. */
  last(): SentPush | undefined {
    return this.outbox[this.outbox.length - 1];
  }
}

/** Validated configuration for {@link RealPushSender}. */
export interface RealPushSenderConfig {
  /** Provider send endpoint URL. */
  readonly endpoint: string;
  /** Provider API key/token. */
  readonly apiKey: string;
  /** Provider application id/bundle id. */
  readonly appId: string;
}

/** Raw env shape parsed by {@link pushConfigFromEnv}. */
export interface PushEnv {
  /** `PUSH_ENDPOINT`. */
  readonly PUSH_ENDPOINT?: string;
  /** `PUSH_API_KEY`. */
  readonly PUSH_API_KEY?: string;
  /** `PUSH_APP_ID`. */
  readonly PUSH_APP_ID?: string;
}

/** Parse push env into a real adapter config, or `null` when incomplete. */
export function pushConfigFromEnv(env: PushEnv): RealPushSenderConfig | null {
  const endpoint = realEnvValue(env.PUSH_ENDPOINT);
  const apiKey = realEnvValue(env.PUSH_API_KEY);
  const appId = realEnvValue(env.PUSH_APP_ID);
  if (!endpoint || !apiKey || !appId) return null;
  return { endpoint, apiKey, appId };
}

/** A real push sender that posts JSON to an HTTP push provider. */
export class RealPushSender implements PushSender {
  private readonly config: RealPushSenderConfig;
  private readonly http: HttpClient;

  /**
   * @param config - Validated endpoint, key, and app id from env.
   * @param http - HTTP transport, defaulting to platform `fetch`.
   */
  constructor(config: RealPushSenderConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
  }

  /** {@inheritDoc PushSender.send} */
  async send(message: OutboundPush): Promise<SentPush> {
    const res = await this.http(this.config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ appId: this.config.appId, ...message }),
    });
    const payload = await optionalJsonResponse(res);
    if (!res.ok) {
      const code = firstString(payload, ['code', 'error']);
      if (res.status === 410 || code === 'invalid_token') {
        throw new PushSendError('invalid_token', `RealPushSender invalid token: ${res.status}`);
      }
      throw new PushSendError('provider_error', `RealPushSender send failed: ${res.status}`);
    }
    return {
      ...message,
      id: firstString(payload, ['id', 'messageId']) ?? `push_${res.status}`,
      sentAt: new Date().toISOString(),
    };
  }
}
