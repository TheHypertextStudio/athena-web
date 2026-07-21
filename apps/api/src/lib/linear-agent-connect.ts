/**
 * `@docket/api` — Linear **Agent** platform connect-flow helpers (install URL + signed state).
 *
 * @remarks
 * Linear ships three separate OAuth relationships that happen to share a vendor name, and this
 * module is the connect-flow plumbing for exactly one of them:
 *
 * 1. `LINEAR_CLIENT_ID`/`LINEAR_CLIENT_SECRET` — the Better Auth **sign-in** social provider.
 * 2. `provider: 'linear'` connector rows — the per-user data-sync OAuth grant
 *    ({@link import('@docket/integrations').LinearProviderClient}) that mirrors issues into
 *    Docket's work graph.
 * 3. `provider: 'linear_agent'` rows (this module) — a workspace-level `actor=app` install of
 *    Linear's **Agent** platform, funded by the separate `LINEAR_AGENT_CLIENT_ID`/
 *    `LINEAR_AGENT_CLIENT_SECRET`/`LINEAR_AGENT_WEBHOOK_SECRET` env trio. It authenticates as the
 *    Docket agent itself (not a connecting human) and receives `AgentSessionEvent` webhooks.
 *
 * Mirrors `github-app.ts`'s connect-flow shape exactly (signed install `state` reusing
 * `oauth-state.ts`'s envelope, an `xConfigFromEnv()` that returns `null` rather than throwing
 * when unconfigured) so the two app-level install flows read the same way at a glance.
 */
import { env } from '../env';
import { signConnectState, verifyConnectState } from './oauth-state';

/** The org + integration an in-flight Linear Agent install is for, carried through Linear in `state`. */
export interface LinearAgentInstallState {
  /** The Docket integration row the install will be recorded against. */
  readonly integrationId: string;
  /** The organization that owns the integration (re-checked on callback). */
  readonly orgId: string;
}

/**
 * Sign a Linear Agent install `state` token: `payload.signature`, where the payload carries the
 * org/integration and an absolute expiry (envelope from {@link signConnectState}).
 *
 * @param state - The org + integration the install is for.
 * @param nowMs - Current time in ms (injected for testability; defaults to `Date.now()`).
 * @returns the opaque, tamper-proof state string to hand to Linear.
 */
export function signLinearAgentInstallState(
  state: LinearAgentInstallState,
  nowMs: number = Date.now(),
): string {
  return signConnectState({ integrationId: state.integrationId, orgId: state.orgId }, nowMs);
}

/**
 * Verify and decode a Linear Agent install `state` token.
 *
 * @param token - The `state` value Linear echoed back to the callback.
 * @param nowMs - Current time in ms (injected for testability; defaults to `Date.now()`).
 * @returns the decoded {@link LinearAgentInstallState}, or `null` when the signature is bad or expired.
 */
export function verifyLinearAgentInstallState(
  token: string,
  nowMs: number = Date.now(),
): LinearAgentInstallState | null {
  const decoded = verifyConnectState(token, nowMs);
  if (!decoded) return null;
  const { integrationId, orgId } = decoded;
  if (typeof integrationId !== 'string' || typeof orgId !== 'string') return null;
  return { integrationId, orgId };
}

/** The Linear Agent app's OAuth credentials plus its registered callback URL, from env. */
export interface LinearAgentConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly redirectUri: string;
}

/**
 * The Linear Agent app's config from env, or `null` when the app is not configured.
 *
 * @remarks
 * All three `LINEAR_AGENT_*` vars are required together — a partially-configured app can neither
 * build a working authorize URL nor verify inbound webhooks, so it degrades to "unavailable" the
 * same way {@link import('./github-app').githubAppConfigFromEnv} does for the GitHub App: return
 * `null` rather than throw, so the caller can offer/hide the connect action cleanly.
 */
export function linearAgentConfigFromEnv(): LinearAgentConfig | null {
  if (
    !env.LINEAR_AGENT_CLIENT_ID ||
    !env.LINEAR_AGENT_CLIENT_SECRET ||
    !env.LINEAR_AGENT_WEBHOOK_SECRET
  ) {
    return null;
  }
  return {
    clientId: env.LINEAR_AGENT_CLIENT_ID,
    clientSecret: env.LINEAR_AGENT_CLIENT_SECRET,
    webhookSecret: env.LINEAR_AGENT_WEBHOOK_SECRET,
    redirectUri: `${env.API_URL}/internal/integrations/linear-agent/callback`,
  };
}
