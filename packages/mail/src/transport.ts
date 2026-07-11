/** Environment-driven transactional mail transport selection. */
import { realEnvValue } from '@docket/env';

import { CaptureMailer } from './capture';
import type { Mailer } from './index';
import { RealMailer, RESEND_EMAIL_ENDPOINT, SmtpMailer, smtpConfigFromEnv } from './smtp';
import type { SmtpEnv } from './smtp';

/** Runtime values used to select Docket's transactional mail transport. */
export interface MailerEnv extends SmtpEnv {
  /** Runtime mode. Tests always capture messages in memory. */
  readonly APP_MODE: 'local' | 'test' | 'production';
  /** Resend API key used by production's HTTPS transport. */
  readonly RESEND_API_KEY?: string;
}

/**
 * Build the transactional mail transport for a runtime environment.
 *
 * @remarks
 * Tests always use the deterministic capture adapter. Local development uses Mailpit when
 * `SMTP_HOST` and `MAIL_FROM` are configured, otherwise it captures in memory. Production
 * deliberately requires Resend's HTTPS API contract and never falls back to SMTP.
 *
 * @param env - Mail-related runtime environment values.
 * @returns The selected mail transport.
 * @throws {Error} When production is missing `RESEND_API_KEY` or `MAIL_FROM`.
 */
export function buildMailerFromEnv(env: MailerEnv): Mailer {
  if (env.APP_MODE === 'test') return new CaptureMailer();

  if (env.APP_MODE === 'local') {
    const smtpConfig = smtpConfigFromEnv(env);
    return smtpConfig ? new SmtpMailer(smtpConfig) : new CaptureMailer();
  }

  const apiKey = realEnvValue(env.RESEND_API_KEY);
  const from = realEnvValue(env.MAIL_FROM);
  if (!apiKey || !from) {
    throw new Error('Missing required production mail config: RESEND_API_KEY and MAIL_FROM');
  }
  return new RealMailer({ endpoint: RESEND_EMAIL_ENDPOINT, apiKey, from });
}
