/**
 * `@docket/boundaries/real` — `RealMailer`.
 *
 * @remarks
 * The env-driven {@link Mailer} that posts a message to an HTTP email provider
 * (e.g. a transactional API). Selected only when its API key is present and
 * real-shaped (see {@link selectAdapter}) and never in `APP_MODE ∈ {local,test}`.
 * Values come from validated env; the network edge goes through an injectable
 * {@link HttpClient}. No business logic lives here — only the send edge
 * (`boundaries.md` §6).
 */
import type { Mailer, OutboundMessage } from '../ports/mailer';
import { defaultHttpClient, type HttpClient } from './http';

/** Validated configuration for {@link RealMailer} (sourced from env). */
export interface RealMailerConfig {
  /** Provider send endpoint URL. */
  readonly endpoint: string;
  /** Provider API key/token. */
  readonly apiKey: string;
  /** From address all messages are sent as. */
  readonly from: string;
}

/**
 * A real, env-driven mailer that sends via an HTTP email provider.
 *
 * @remarks
 * Issues a single POST per message; raises when the provider rejects it.
 */
export class RealMailer implements Mailer {
  private readonly config: RealMailerConfig;
  private readonly http: HttpClient;

  /**
   * @param config - Validated endpoint, key, and from-address from env.
   * @param http - HTTP transport (defaults to the platform `fetch`).
   */
  constructor(config: RealMailerConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
  }

  /** {@inheritDoc Mailer.send} */
  async send(message: OutboundMessage): Promise<void> {
    const res = await this.http(this.config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.config.from, ...message }),
    });
    if (!res.ok) throw new Error(`RealMailer send failed: ${res.status}`);
  }
}
