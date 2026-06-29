/**
 * `@docket/auth` — the single Better Auth configuration + passkey-intent signer.
 *
 * @remarks
 * One `betterAuth()` instance, built by {@link buildAuthOptions} from the validated
 * `@docket/env/api` contract. See `auth-builder.ts` for the full option-assembly logic and
 * the module docstring there for the detailed rationale (passwordless-passkey-first,
 * env-gated plugins, MCP/OIDC binding decisions).
 */
import { env } from '@docket/env/api';
import { betterAuth } from 'better-auth';

import { buildAuthOptions } from './auth-builder';

export * from './passkey-intent';
export {
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  hasRecoveryCodes,
  type RecoveryCodeStatus,
} from './backup-codes';
export type { AuthEnv, PasskeyUserAdapter } from './auth-builder';
export {
  buildAuthOptions,
  configuredSocialProviders,
  parseTrustedOrigins,
  resolvePasskeyUser,
  type SocialProvider,
} from './auth-builder';

/** The configured Better Auth instance (handler, server API, plugins). */
export const auth = betterAuth(buildAuthOptions(env));

/** The inferred type of the configured Better Auth instance. */
export type Auth = typeof auth;
