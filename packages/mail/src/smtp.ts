/**
 * `@docket/mail` - the env-driven {@link Mailer} adapters.
 *
 * @remarks
 * Two real transports live here, both env-driven and selected only outside
 * `APP_MODE ∈ {local,test}` by the app container; neither holds business logic:
 *
 * - {@link RealMailer} — posts each message to an HTTP transactional-email provider
 *   (a JSON `POST` with a bearer token). Production uses this adapter with Resend's
 *   email endpoint and `RESEND_API_KEY`; its network edge is the injectable {@link HttpClient}.
 * - {@link SmtpMailer} — sends over SMTP via {@link https://nodemailer.com | nodemailer}.
 *   This is the optional local transport exercised against Mailpit, driven by the
 *   `SMTP_*` / `MAIL_FROM` env. The single
 *   live-network call (`transporter.sendMail`) is the I/O boundary; all config parsing
 *   and message mapping around it are pure and unit-tested.
 *
 * Secrets (provider key, SMTP password) are never logged.
 */
import { realEnvValue } from '@docket/env';
import nodemailer from 'nodemailer';

import type { Mailer, OutboundMessage } from './index';
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

/** Resend's stable transactional email send endpoint. */
export const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';

/**
 * A real, env-driven mailer that sends via an HTTP email provider.
 *
 * @remarks
 * Issues a single `POST` per message with a `Bearer` token; raises a clear error when
 * the provider rejects it. The API key is held privately and never included in any
 * thrown message or log line.
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

/** Validated SMTP configuration for {@link SmtpMailer} (sourced from env). */
export interface SmtpMailerConfig {
  /** SMTP server hostname (e.g. `localhost` for Mailpit, the relay host in prod). */
  readonly host: string;
  /** SMTP server port (587 STARTTLS, 465 implicit TLS, 1025 for Mailpit). */
  readonly port: number;
  /** Whether the connection uses implicit TLS from the start (`true` for port 465). */
  readonly secure: boolean;
  /** From address all messages are sent as (`"Name <addr>"` or a bare address). */
  readonly from: string;
  /** SMTP auth username; omitted for unauthenticated relays such as Mailpit. */
  readonly user?: string;
  /** SMTP auth password; omitted for unauthenticated relays such as Mailpit. */
  readonly pass?: string;
}

/**
 * The raw env shape {@link smtpConfigFromEnv} parses. All values are optional strings
 * (the validated env keeps them lenient); parsing here decides whether a usable config
 * exists and coerces the port/secure fields.
 */
export interface SmtpEnv {
  /** `SMTP_HOST`. */
  readonly SMTP_HOST?: string;
  /** `SMTP_PORT` (string form; defaults to 587 when absent/blank). */
  readonly SMTP_PORT?: string;
  /** `SMTP_SECURE` (`"true"`/`"false"`; defaults to `true` only on port 465). */
  readonly SMTP_SECURE?: string;
  /** `SMTP_USER` (optional; omit for unauthenticated relays). */
  readonly SMTP_USER?: string;
  /** `SMTP_PASS` (optional; omit for unauthenticated relays). */
  readonly SMTP_PASS?: string;
  /** `MAIL_FROM` — the from-address every message is sent as. */
  readonly MAIL_FROM?: string;
}

/**
 * Parse the SMTP env slice into a validated {@link SmtpMailerConfig}, or `null` when
 * the minimum required values (`SMTP_HOST` + `MAIL_FROM`) are absent.
 *
 * @remarks
 * Pure: no I/O, fully unit-tested. `SMTP_PORT` defaults to `587` (the STARTTLS
 * submission port) and must be a positive integer when present. `SMTP_SECURE` is read
 * as a boolean when set; when unset it defaults to `true` for port `465` (implicit TLS)
 * and `false` otherwise (STARTTLS upgrade), matching nodemailer's own port heuristic.
 * Returning `null` lets the composition root fall back to the mock without throwing.
 *
 * @param env - The SMTP-relevant env values (typically a slice of `@docket/env`).
 * @returns the parsed config, or `null` when SMTP is not configured.
 * @throws {Error} When `SMTP_PORT` is present but not a positive integer.
 */
export function smtpConfigFromEnv(env: SmtpEnv): SmtpMailerConfig | null {
  const host = realEnvValue(env.SMTP_HOST);
  const from = realEnvValue(env.MAIL_FROM);
  if (!host || !from) return null;

  const rawPort = realEnvValue(env.SMTP_PORT);
  let port = 587;
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`SmtpMailer: SMTP_PORT must be a positive integer, got "${rawPort}"`);
    }
    port = parsed;
  }

  const rawSecure = realEnvValue(env.SMTP_SECURE)?.toLowerCase();
  const secure = rawSecure === undefined ? port === 465 : rawSecure === 'true';

  const user = realEnvValue(env.SMTP_USER);
  const pass = realEnvValue(env.SMTP_PASS);

  return {
    host,
    port,
    secure,
    from,
    ...(user ? { user } : {}),
    ...(pass ? { pass } : {}),
  };
}

/**
 * The subset of `nodemailer.SendMailOptions` {@link SmtpMailer} produces.
 *
 * @remarks
 * Narrowed to the fields the {@link Mailer} port carries plus the configured `from`,
 * so the mapping is fully typed without depending on nodemailer's whole option surface.
 */
export interface SendMailOptions {
  /** From address (the configured {@link SmtpMailerConfig.from}). */
  readonly from: string;
  /** Recipient address. */
  readonly to: string;
  /** Subject line. */
  readonly subject: string;
  /** HTML body, when the message provided one. */
  readonly html?: string;
  /** Plain-text body, when the message provided one. */
  readonly text?: string;
}

/**
 * Map an {@link OutboundMessage} + from-address onto nodemailer's send options.
 *
 * @remarks
 * Pure: only `html`/`text` fields actually present on the message are forwarded (so a
 * text-only message stays text-only). Validates that at least one body is set, since
 * the port documents `html`/`text` as "at least one should be set" and an empty body
 * would otherwise be silently sent.
 *
 * @param from - The configured from-address.
 * @param message - The outbound message to map.
 * @returns the nodemailer send options.
 * @throws {Error} When neither `html` nor `text` is present.
 */
export function toSendMailOptions(from: string, message: OutboundMessage): SendMailOptions {
  if (message.html === undefined && message.text === undefined) {
    throw new Error('SmtpMailer: message must set at least one of `html`/`text`');
  }
  return {
    from,
    to: message.to,
    subject: message.subject,
    ...(message.html !== undefined ? { html: message.html } : {}),
    ...(message.text !== undefined ? { text: message.text } : {}),
  };
}

/**
 * A `nodemailer`-shaped transporter: the single method {@link SmtpMailer} calls.
 *
 * @remarks
 * Declaring the narrow shape we use (rather than importing the concrete
 * `nodemailer.Transporter`) keeps the transport injectable for tests and avoids
 * coupling to nodemailer's full generic surface.
 */
export interface SmtpTransport {
  /** Send one message; resolves once the SMTP server accepts (or rejects) it. */
  sendMail(options: SendMailOptions): Promise<{ readonly rejected?: readonly unknown[] }>;
}

/** Factory that builds a {@link SmtpTransport} from a validated config. */
export type SmtpTransportFactory = (config: SmtpMailerConfig) => SmtpTransport;

/**
 * Build a real nodemailer SMTP transport from a validated {@link SmtpMailerConfig}.
 *
 * @remarks
 * The default {@link SmtpTransportFactory}. `createTransport` only opens connections
 * on the first `sendMail`, so constructing the transport is the start of the SMTP I/O
 * boundary and is `v8`-ignored (it can only be exercised against a live/Mailpit server,
 * not in unit tests, which inject a fake transport).
 *
 * @param config - Validated SMTP host/port/secure/from (+ optional auth).
 * @returns a transport whose `sendMail` performs the live SMTP send.
 */
/* v8 ignore start */
export const defaultSmtpTransportFactory: SmtpTransportFactory = (config) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
  });
/* v8 ignore stop */

/**
 * A real, env-driven mailer that sends transactional email over SMTP via nodemailer.
 *
 * @remarks
 * Constructed from a validated {@link SmtpMailerConfig} (see {@link smtpConfigFromEnv}).
 * Maps each {@link OutboundMessage} to nodemailer send options (pure, tested) and then
 * hands it to an injectable {@link SmtpTransport} — by default a real nodemailer
 * transport ({@link defaultSmtpTransportFactory}). The live `sendMail` call is wrapped
 * so transport failures surface as a clear, secret-free error.
 *
 * @example
 * ```typescript
 * const config = smtpConfigFromEnv(process.env as SmtpEnv);
 * if (config) await new SmtpMailer(config).send({ to, subject, html });
 * ```
 */
export class SmtpMailer implements Mailer {
  private readonly config: SmtpMailerConfig;
  private readonly transport: SmtpTransport;

  /**
   * @param config - Validated SMTP config from env.
   * @param transportFactory - Builds the SMTP transport (defaults to real nodemailer).
   */
  constructor(
    config: SmtpMailerConfig,
    transportFactory: SmtpTransportFactory = defaultSmtpTransportFactory,
  ) {
    this.config = config;
    this.transport = transportFactory(config);
  }

  /** {@inheritDoc Mailer.send} */
  async send(message: OutboundMessage): Promise<void> {
    const options = toSendMailOptions(this.config.from, message);
    let info: { readonly rejected?: readonly unknown[] };
    try {
      /* v8 ignore next */
      info = await this.transport.sendMail(options);
    } catch (cause) {
      // Never surface SMTP credentials: only the cause's message, never the config.
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`SmtpMailer send to ${message.to} failed: ${reason}`, { cause });
    }
    if (info.rejected && info.rejected.length > 0) {
      throw new Error(`SmtpMailer send to ${message.to} was rejected by the SMTP server`);
    }
  }
}
