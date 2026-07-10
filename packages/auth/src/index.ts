/**
 * `@docket/auth` — the single Better Auth configuration + passwordless sign-up challenge.
 *
 * @remarks
 * One `betterAuth()` instance, built by {@link buildAuthOptions} from the validated
 * `@docket/env/api` contract. See `auth-builder.ts` for the full option-assembly logic and
 * the module docstring there for the detailed rationale (passwordless-passkey-first,
 * env-gated plugins, MCP/OIDC binding decisions).
 */
import { env } from '@docket/env/api';
import { isRealValue } from '@docket/env';
import { CaptureMailer, SmtpMailer, smtpConfigFromEnv } from '@docket/mail';
import type { Mailer, SmtpEnv } from '@docket/mail';
import { betterAuth } from 'better-auth';

import { buildAuthOptions } from './auth-builder';

export {
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  hasRecoveryCodes,
  type RecoveryCodeStatus,
} from './backup-codes';
export { generateAppleClientSecret, type AppleClientSecretInput } from './apple-secret';
export type { AuthDeps, AuthEnv, PasskeyUserAdapter } from './auth-builder';
export {
  buildAuthOptions,
  canUseGoogleOAuth,
  configuredSocialProviders,
  parseTrustedOrigins,
  resolvePasskeyUser,
  type SocialProvider,
} from './auth-builder';

/**
 * The mailer the auth instance sends verification (and future change-email) mail through.
 *
 * @remarks
 * `@docket/auth` sends from inside the Better Auth instance and has no access to the API's
 * boundary container, so it builds its own mailer from the same env-driven selection via
 * {@link buildMailer} (SMTP relay in prod / Mailpit locally, capture mock under `local`/`test`).
 */
function buildAuthMailer(
  mailEnv: SmtpEnv & { readonly APP_MODE: 'local' | 'test' | 'production' },
): Mailer {
  if (mailEnv.APP_MODE === 'local' || mailEnv.APP_MODE === 'test') return new CaptureMailer();
  if (!isRealValue(mailEnv.SMTP_HOST) || !isRealValue(mailEnv.MAIL_FROM)) {
    throw new Error('Missing required production mail config: SMTP_HOST and MAIL_FROM');
  }
  const config = smtpConfigFromEnv(mailEnv);
  if (!config) throw new Error('Missing required production mail config: SMTP_HOST and MAIL_FROM');
  return new SmtpMailer(config);
}

const mailer = buildAuthMailer({
  APP_MODE: env.APP_MODE,
  ...(env.SMTP_HOST ? { SMTP_HOST: env.SMTP_HOST } : {}),
  ...(env.SMTP_PORT ? { SMTP_PORT: env.SMTP_PORT } : {}),
  ...(env.SMTP_SECURE ? { SMTP_SECURE: env.SMTP_SECURE } : {}),
  ...(env.SMTP_USER ? { SMTP_USER: env.SMTP_USER } : {}),
  ...(env.SMTP_PASS ? { SMTP_PASS: env.SMTP_PASS } : {}),
  ...(env.MAIL_FROM ? { MAIL_FROM: env.MAIL_FROM } : {}),
});

/**
 * Non-production echo of the sign-up code (for e2e). Gated to `APP_MODE ∈ {local,test}`; the same
 * modes force the capture mock, so it is impossible to enable against a real
 * relay or in production.
 */
const devEchoSignupCode = env.APP_MODE === 'local' || env.APP_MODE === 'test';

/** The configured Better Auth instance (handler, server API, plugins). */
export const auth = betterAuth(
  buildAuthOptions(env, {
    mailer,
    ...(devEchoSignupCode ? { devEchoSignupCode: true } : {}),
  }),
);

/** The inferred type of the configured Better Auth instance. */
export type Auth = typeof auth;
