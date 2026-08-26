/**
 * `@docket/api` — `toAppRuntimeEnv`'s full field projection.
 *
 * @remarks
 * Isolated in its own file: it mocks `../../src/env` outright (rather than stubbing individual
 * `process.env` keys) so every optional field on the validated env can be exercised as "present"
 * in one pass, with no risk of an env-shape change elsewhere in the suite leaking into this one.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { toAppRuntimeEnv as ToAppRuntimeEnv } from '../../src/container';

const FULL_ENV = {
  APP_MODE: 'production' as const,
  BILLING_ENABLED: true,
  STRIPE_SECRET_KEY: 'sk_live_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PRICE_TEAM: 'price_team',
  DOCKET_PRICE_LOOKUP_TEAM: 'lookup_team',
  STRIPE_BILLING_PORTAL_CONFIG_ID: 'bpc_x',
  ANTHROPIC_API_KEY: 'sk-ant-x',
  CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic',
  CLOUDFLARE_AI_GATEWAY_TOKEN: 'cf-token',
  LINEAR_WEBHOOK_SECRET: 'linear-secret',
  GITHUB_APP_WEBHOOK_SECRET: 'github-secret',
  RESEND_API_KEY: 'resend-key',
  RESEND_INBOUND_WEBHOOK_SECRET: 'resend-inbound-secret',
  RESEND_RECEIVING_API_BASE: 'https://resend.example/api',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'true',
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-pass',
  MAIL_FROM: 'athena@docket.example',
  SMS_ENDPOINT: 'https://sms.example/send',
  SMS_API_KEY: 'sms-key',
  SMS_FROM: '+15550001111',
  PUSH_ENDPOINT: 'https://push.example/send',
  PUSH_API_KEY: 'push-key',
  PUSH_APP_ID: 'push-app',
  BLOB_READ_WRITE_TOKEN: 'blob-token',
  EXPORT_BUCKET_URL: 'https://blob.example/exports',
  OPENAI_API_KEY: 'sk-openai-x',
  VOICE_REALTIME_MODEL: 'gpt-realtime-x',
  VOICE_REALTIME_VOICE: 'sage',
  GITHUB_API_BASE: 'https://api.github.example',
  LINEAR_API_BASE: 'https://api.linear.example',
  GOOGLE_GMAIL_API_BASE: 'https://gmail.googleapis.example',
  GOOGLE_CALENDAR_API_BASE: 'https://calendar.googleapis.example',
  GOOGLE_TASKS_API_BASE: 'https://tasks.googleapis.example',
};

let toAppRuntimeEnv!: typeof ToAppRuntimeEnv;

beforeAll(async () => {
  vi.doMock('../../src/env', () => ({ env: FULL_ENV }));
  ({ toAppRuntimeEnv } = await import('../../src/container'));
});

describe('toAppRuntimeEnv', () => {
  it('carries every configured field through onto the runtime env projection', () => {
    expect(toAppRuntimeEnv()).toEqual(FULL_ENV);
  });
});
