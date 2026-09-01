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
import { buildMailerFromEnv } from '@docket/mail';
import { betterAuth } from 'better-auth';
import { verifyAccessToken } from 'better-auth/oauth2';

import { buildAuthOptions } from './auth-builder';
import { createGoogleDirectory } from './google-directory';

export {
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  hasRecoveryCodes,
  type RecoveryCodeStatus,
} from './backup-codes';
/**
 * Locally verify an OAuth Bearer access token (JWT, `jose`-based signature check against
 * the AS's own `/jwks` endpoint — no DB round-trip). Re-exported so callers outside this
 * package (the MCP resource server in `apps/api`) never import `better-auth` directly —
 * `@docket/auth` stays the single boundary around the Better Auth configuration.
 */
export { verifyAccessToken };
export { generateAppleClientSecret, type AppleClientSecretInput } from './apple-secret';
export {
  createGoogleDirectory,
  staticGoogleDirectory,
  type GoogleDirectoryPort,
} from './google-directory';
export {
  highestRoleForGroups,
  isWorkspaceEmail,
  syncAllStaff,
  syncStaffFromGoogle,
  syncStaffOnSignIn,
  type StaffSyncConfig,
  type StaffSyncOutcome,
  type StaffSyncSweep,
} from './staff-google-sync';
export type { AuthDeps, AuthEnv, PasskeyUserAdapter } from './auth-builder';
export { restoreCredentialPlugin, type RestoreWebAuthn } from './restore-credential';
export {
  adminGoogleSsoEnabled,
  buildAuthOptions,
  canRemovePasskey,
  canUseGoogleOAuth,
  isAdminOrigin,
  syncStaffOnGoogleCallback,
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
 * boundary container, so it builds its own mailer from the shared env-driven selector
 * (Resend API in production, optional Mailpit locally, capture mock under test).
 */
const mailer = buildMailerFromEnv({
  APP_MODE: env.APP_MODE,
  ...(env.RESEND_API_KEY ? { RESEND_API_KEY: env.RESEND_API_KEY } : {}),
  ...(env.SMTP_HOST ? { SMTP_HOST: env.SMTP_HOST } : {}),
  ...(env.SMTP_PORT ? { SMTP_PORT: env.SMTP_PORT } : {}),
  ...(env.SMTP_SECURE ? { SMTP_SECURE: env.SMTP_SECURE } : {}),
  ...(env.SMTP_USER ? { SMTP_USER: env.SMTP_USER } : {}),
  ...(env.SMTP_PASS ? { SMTP_PASS: env.SMTP_PASS } : {}),
  ...(env.MAIL_FROM ? { MAIL_FROM: env.MAIL_FROM } : {}),
});

/**
 * Non-production echo of the sign-up code (for e2e). Gated to `APP_MODE ∈ {local,test}`; the same
 * modes keep the echo outside production, regardless of whether local mail is captured
 * in memory or delivered to Mailpit.
 */
const devEchoSignupCode = env.APP_MODE === 'local' || env.APP_MODE === 'test';

/**
 * The Workspace group directory operator SSO reads, mounted only when SSO is switched on.
 *
 * @remarks
 * The live adapter authenticates through the GCP metadata server, so it only answers on Cloud
 * Run. Leaving it unmounted elsewhere is what keeps a developer machine from silently failing
 * every lookup: with no directory, {@link adminGoogleSsoEnabled} reports off and staff access
 * comes from `STAFF_BOOTSTRAP_EMAILS` instead.
 */
const googleDirectory = env.ADMIN_GOOGLE_SSO_ENABLED ? createGoogleDirectory() : undefined;

/** The configured Better Auth instance (handler, server API, plugins). */
export const auth = betterAuth(
  buildAuthOptions(env, {
    mailer,
    ...(devEchoSignupCode ? { devEchoSignupCode: true } : {}),
    ...(googleDirectory ? { googleDirectory } : {}),
  }),
);

/** The inferred type of the configured Better Auth instance. */
export type Auth = typeof auth;
