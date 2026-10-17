/**
 * `@docket/mail` - the `Mailer` (send) and `InboundMailReceiver` (receive) ports.
 *
 * @remarks
 * The two typed edges email crosses. Sending: the real adapter speaks env-driven SMTP / a
 * provider API; the mock is an in-memory `CaptureMailer` whose `outbox` is asserted in tests
 * (and a `ConsoleMailer` for dev). Receiving: `ResendInboundReceiver` authenticates the
 * provider's signed webhook and fetches the message body, while `FixtureInboundReceiver` runs
 * the identical parsing offline. No business logic lives here; only the two edges do — nothing
 * in this package knows what a message *means* or who it belongs to.
 */

/** An outbound email message. */
export interface OutboundMessage {
  /** Sender override for an authorized channel identity. */
  readonly from?: string;
  /** Address used for replies. */
  readonly replyTo?: string;
  /** RFC message headers, including thread references. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Provider transport deduplication key; never a message body field. */
  readonly idempotencyKey?: string;
  /** Base64 bytes of validated private attachments, never URLs or local file paths. */
  readonly attachments?: readonly { filename: string; content: string; content_type: string }[];
  /** Recipient address. */
  readonly to: string;
  /** Subject line. */
  readonly subject: string;
  /** HTML body (at least one of `html`/`text` should be set). */
  readonly html?: string;
  /** Plain-text body (at least one of `html`/`text` should be set). */
  readonly text?: string;
}

/**
 * A message recorded as sent.
 *
 * @remarks
 * The capture mailer returns/stores these so tests can assert what was sent and
 * when; the real adapter populates `id` from the provider's accepted-message id.
 */
export interface SentMessage extends OutboundMessage {
  /** Provider/mock message id. */
  readonly id: string;
  /** ISO-8601 timestamp the message was accepted for delivery. */
  readonly sentAt: string;
}

/**
 * The mailer port: a single typed edge that sends one message. Implemented by
 * `RealMailer` and `CaptureMailer`/`ConsoleMailer`.
 */
export interface Mailer {
  /**
   * Send one transactional email.
   *
   * @param message - The recipient, subject, and body.
   */
  // Existing application test doubles return Promise<void>; preserve their port compatibility.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  send(message: OutboundMessage): Promise<SentMessage | void>;
}

export { CaptureMailer, ConsoleMailer } from './capture';
export type { CaptureMailerOptions } from './capture';
export {
  RealMailer,
  RESEND_EMAIL_ENDPOINT,
  SmtpMailer,
  defaultSmtpTransportFactory,
  smtpConfigFromEnv,
  toSendMailOptions,
} from './smtp';
export { buildMailerFromEnv } from './transport';
export type {
  RealMailerConfig,
  SendMailOptions,
  SmtpEnv,
  SmtpMailerConfig,
  SmtpTransport,
  SmtpTransportFactory,
} from './smtp';
export type { MailerEnv } from './transport';

export { htmlToText, mailboxHostOf, mailboxKeyOf, parseAddress, snippetOf } from './inbound';
export type {
  InboundAttachment,
  InboundAuthentication,
  InboundContent,
  InboundBodyStatus,
  InboundMailReceiver,
  InboundMessage,
  InboundProviderId,
  InboundReceiveResult,
  InboundRejectionCode,
  InboundWebhookRequest,
} from './inbound';
export {
  SVIX_ID_HEADER,
  SVIX_SECRET_PREFIX,
  SVIX_SIGNATURE_HEADER,
  SVIX_TIMESTAMP_HEADER,
  SVIX_TOLERANCE_SECONDS,
  signSvixPayload,
  verifySvixSignature,
} from './svix-signature';
export type { SvixVerification, SvixVerificationFailure, SvixVerifyInput } from './svix-signature';
export {
  RESEND_INBOUND_EVENT_TYPE,
  RESEND_RECEIVING_ENDPOINT,
  ResendInboundReceiver,
  readResendInboundPayload,
  toInboundMessage,
} from './resend-inbound';
export type {
  ResendInboundConfig,
  ResendInboundNotification,
  ResendPayloadRead,
} from './resend-inbound';
export { FixtureInboundReceiver, buildInboundFixturePayload } from './fixture-inbound';
export type { FixtureInboundConfig, InboundFixtureBody } from './fixture-inbound';
export { buildInboundReceiverFromEnv } from './inbound-transport';
export type { InboundMailEnv } from './inbound-transport';

export {
  MAIL_ATTACHMENT_MAX_BYTES,
  MAIL_ATTACHMENT_MAX_COUNT,
  supportedTextAttachment,
  validateTextAttachment,
} from './attachments';

export { MailSendError } from './send-error';
