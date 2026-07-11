import { describe, expect, it } from 'vitest';

import { CaptureMailer } from '../src/capture';
import { RealMailer, SmtpMailer } from '../src/smtp';
import { buildMailerFromEnv } from '../src/transport';

describe('buildMailerFromEnv', () => {
  it('always captures in test mode', () => {
    expect(
      buildMailerFromEnv({
        APP_MODE: 'test',
        RESEND_API_KEY: 're_test_key',
        MAIL_FROM: 'Docket <test@example.com>',
      }),
    ).toBeInstanceOf(CaptureMailer);
  });

  it('uses Mailpit-compatible SMTP only when configured locally', () => {
    expect(
      buildMailerFromEnv({
        APP_MODE: 'local',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        MAIL_FROM: 'Docket <dev@docket.localhost>',
      }),
    ).toBeInstanceOf(SmtpMailer);
    expect(buildMailerFromEnv({ APP_MODE: 'local' })).toBeInstanceOf(CaptureMailer);
  });

  it('uses the Resend HTTPS adapter in production', () => {
    expect(
      buildMailerFromEnv({
        APP_MODE: 'production',
        RESEND_API_KEY: 're_production_key',
        MAIL_FROM: 'Docket <no-reply@example.com>',
      }),
    ).toBeInstanceOf(RealMailer);
  });

  it('does not fall back to SMTP in production', () => {
    expect(() =>
      buildMailerFromEnv({
        APP_MODE: 'production',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PASS: 'secret',
        MAIL_FROM: 'Docket <no-reply@example.com>',
      }),
    ).toThrow(/RESEND_API_KEY and MAIL_FROM/);
  });
});
