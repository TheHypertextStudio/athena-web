/** Transport result that confirms provider rejection without exposing provider response content. */
export class MailSendError extends Error {
  /** Whether a safe stable-key retry can resolve this provider response. */
  readonly disposition: 'rejected' | 'retryable';
  /** HTTP status only; never provider text or credentials. */
  readonly status: number;

  /** Classify explicit HTTP rejection separately from lost or unreadable acceptance responses. */
  constructor(status: number) {
    super(`RealMailer send failed: ${status}`);
    this.name = 'MailSendError';
    this.status = status;
    this.disposition =
      status >= 400 && status < 500 && ![408, 409, 429].includes(status) ? 'rejected' : 'retryable';
  }
}
