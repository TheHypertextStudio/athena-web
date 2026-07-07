/**
 * `@docket/api` — GitHub App connect-flow helpers (install URL + signed install state).
 *
 * @remarks
 * Connecting GitHub is an *installation*: Docket sends the user to the GitHub App's install page,
 * GitHub redirects back to `/internal/integrations/github/callback` with an `installation_id`, and the
 * callback records that id on the org's integration so the webhook firehose can route to it.
 *
 * To survive the round-trip through github.com, the org + integration the install is for is carried
 * in a tamper-proof `state` parameter — an HMAC (keyed by `BETTER_AUTH_SECRET`) over the payload
 * and a short expiry. That both prevents an attacker from binding an installation to another org
 * and doubles as CSRF protection on the callback. The token machinery that mints installation
 * access tokens lives in `@docket/integrations` ({@link decodeAppPrivateKey} + `mintInstallationToken`);
 * this module only handles the browser-facing connect handshake.
 */
import { decodeAppPrivateKey, type GitHubAppConfig } from '@docket/integrations';

import { env } from '../env';
import { signConnectState, verifyConnectState } from './oauth-state';

/** The org + integration an in-flight install is for, carried through GitHub in the `state` param. */
export interface InstallState {
  /** The Docket integration row the installation will be recorded against. */
  readonly integrationId: string;
  /** The organization that owns the integration (re-checked on callback). */
  readonly orgId: string;
}

/**
 * Sign an install `state` token: `payload.signature`, where payload carries the org/integration
 * and an absolute expiry (envelope from {@link signConnectState}).
 *
 * @param state - The org + integration the install is for.
 * @param nowMs - Current time in ms (injected for testability; defaults to `Date.now()`).
 * @returns the opaque, tamper-proof state string to hand to GitHub.
 */
export function signInstallState(state: InstallState, nowMs: number = Date.now()): string {
  return signConnectState({ integrationId: state.integrationId, orgId: state.orgId }, nowMs);
}

/**
 * Verify and decode an install `state` token.
 *
 * @param token - The `state` value GitHub echoed back to the callback.
 * @param nowMs - Current time in ms (injected for testability; defaults to `Date.now()`).
 * @returns the decoded {@link InstallState}, or `null` when the signature is bad or it expired.
 */
export function verifyInstallState(token: string, nowMs: number = Date.now()): InstallState | null {
  const decoded = verifyConnectState(token, nowMs);
  if (!decoded) return null;
  const { integrationId, orgId } = decoded;
  if (typeof integrationId !== 'string' || typeof orgId !== 'string') return null;
  return { integrationId, orgId };
}

/**
 * Build the GitHub App install URL for the configured app, carrying a signed `state`.
 *
 * @param state - The signed install state from {@link signInstallState}.
 * @returns the `github.com/apps/<slug>/installations/new` URL, or `null` when no app slug is set.
 */
export function buildInstallUrl(state: string): string | null {
  const slug = env.GITHUB_APP_SLUG;
  if (!slug) return null;
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * The GitHub App credentials from env (id + decoded private key) for minting installation tokens,
 * or `null` when the app is not configured.
 */
export function githubAppConfigFromEnv(): GitHubAppConfig | null {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return null;
  return {
    appId: env.GITHUB_APP_ID,
    privateKeyPem: decodeAppPrivateKey(env.GITHUB_APP_PRIVATE_KEY),
  };
}

/** The web app origin the connect callback redirects back to (first trusted origin). */
export function webAppOrigin(): string {
  const origins = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((s) => s.trim()) ?? [];
  return origins.find((s) => s.length > 0) ?? '/';
}
