/**
 * `@docket/boundaries/ports` — the `Mailer` port.
 *
 * @remarks
 * The single typed edge for transactional email. The real adapter speaks env-driven
 * SMTP / a provider API; the mock is an in-memory `CaptureMailer` whose `outbox` is
 * asserted in tests (and a `ConsoleMailer` for dev). No business logic lives here —
 * only the send edge (`boundaries.md` §6).
 */

/** An outbound email message. */
export interface OutboundMessage {
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
  send(message: OutboundMessage): Promise<void>;
}
