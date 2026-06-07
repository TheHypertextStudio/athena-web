/**
 * `@docket/boundaries/mock` — `CaptureMailer` and `ConsoleMailer`.
 *
 * @remarks
 * Offline {@link Mailer} implementations. `CaptureMailer` records every send in an
 * in-memory `outbox` that tests assert against; `ConsoleMailer` logs to the console
 * for dev. Both are deterministic except for the recorded timestamp, which derives
 * from an injectable `now` (defaulting to {@link FIXED_NOW}).
 */
import { FIXED_NOW } from '../fixtures';
import type { Mailer, OutboundMessage, SentMessage } from '../ports/mailer';

/** Construction options for {@link CaptureMailer}. */
export interface CaptureMailerOptions {
  /** Fixed ISO-8601 "now" recorded as each message's `sentAt`. */
  readonly now?: string;
}

/**
 * An in-memory mailer that captures every sent message for assertions.
 *
 * @remarks
 * Read `outbox` (or `last()`) in tests to assert what was sent. Message ids are a
 * stable per-mailer counter so assertions are deterministic.
 */
export class CaptureMailer implements Mailer {
  private readonly now: string;
  private counter = 0;
  /** Every message captured so far, in send order. */
  readonly outbox: SentMessage[] = [];

  /**
   * @param options - Optional fixed `now` for deterministic `sentAt` timestamps.
   */
  constructor(options: CaptureMailerOptions = {}) {
    this.now = options.now ?? FIXED_NOW;
  }

  /** {@inheritDoc Mailer.send} */
  async send(message: OutboundMessage): Promise<void> {
    this.counter += 1;
    this.outbox.push({
      ...message,
      id: `msg_${this.counter.toString().padStart(6, '0')}`,
      sentAt: this.now,
    });
  }

  /** The most recently captured message, or `undefined` when the outbox is empty. */
  last(): SentMessage | undefined {
    return this.outbox[this.outbox.length - 1];
  }
}

/**
 * A dev mailer that logs each message to the console instead of sending it.
 *
 * @remarks
 * Used in local dev for a visible, side-effect-free email trail.
 */
export class ConsoleMailer implements Mailer {
  /** {@inheritDoc Mailer.send} */
  async send(message: OutboundMessage): Promise<void> {
    console.info(`[ConsoleMailer] to=${message.to} subject=${message.subject}`);
  }
}
