/**
 * `@docket/api` — Slack connect-flow helpers (user-token OAuth v2 authorize + exchange).
 *
 * @remarks
 * Connecting Slack is a **user-token** OAuth v2 grant against the one shared Docket Slack app:
 * the requirement is "messages that mention *me*, DM *me*, or reply in threads *I'm* in", and
 * only user-scope event subscriptions (`message.channels/groups/im/mpim` under user scopes)
 * make Slack deliver every message the authorizing user can see — a bot token only sees
 * channels the bot was invited to and no DMs at all. The app requests NO bot scopes; everything
 * rides on `user_scope`, and the resulting `xoxp-` token lands in the Better Auth `account`
 * table (Slack user tokens do not expire while the app keeps token rotation off, so there is no
 * refresh machinery).
 *
 * The flow context (org + integration + connecting user) round-trips through Slack in a signed
 * `state` (see `oauth-state.ts`). In `APP_MODE=local`/`test` the whole handshake short-circuits
 * to deterministic fixtures so the end-to-end flow runs with zero Slack account, per the
 * boundaries discipline ("flipping to prod is purely supplying env values").
 */
import { isRealValue } from '@docket/env';

import { env } from '../env';
import { signConnectState, verifyConnectState } from './oauth-state';

/**
 * The user scopes the shared Docket app requests — history scopes turn on the matching
 * `message.*` user event subscriptions; `users:read` resolves display names for enrichment.
 */
export const SLACK_USER_SCOPES = [
  'channels:history',
  'groups:history',
  'im:history',
  'mpim:history',
  'users:read',
] as const;

/** The org + integration + connecting user an in-flight Slack grant is for. */
export interface SlackConnectState {
  /** The Docket integration row the grant will be recorded against. */
  readonly integrationId: string;
  /** The organization that owns the integration (re-checked on callback). */
  readonly orgId: string;
  /** The Better Auth user the `xoxp-` token belongs to (the callback has no session). */
  readonly userId: string;
}

/** What the callback needs from a completed `oauth.v2.access` exchange. */
export interface SlackGrant {
  /** The workspace the user authorized (`T…`) — the inbound-event routing key. */
  readonly teamId: string;
  /** The workspace's display name (the integration's account label). */
  readonly teamName: string;
  /** The authorizing user's Slack id (`U…`/`W…`) — mention matching + account identity. */
  readonly slackUserId: string;
  /** The `xoxp-` user token. */
  readonly accessToken: string;
  /** The granted user scopes (comma-separated, as Slack returns them). */
  readonly scope: string;
}

/** Whether the callback should skip the real exchange (local/test mock discipline). */
function mockMode(): boolean {
  return env.APP_MODE === 'local' || env.APP_MODE === 'test';
}

/**
 * Whether the shared Slack app's OAuth credentials are configured (real-shaped values).
 *
 * @remarks
 * Deliberately NOT auto-true in local/test: `/v1/config` advertises only real availability
 * (the same {@link isRealValue} rule as `configuredSocialProviders`). Local-mock connectability
 * is the client's `isMockMode` affordance, and the connect flow itself still short-circuits to
 * fixtures in mock mode regardless of this.
 */
export function slackConfigured(): boolean {
  return isRealValue(env.SLACK_CLIENT_ID) && isRealValue(env.SLACK_CLIENT_SECRET);
}

/** The exact redirect URI registered on the Slack app (must match authorize + access calls). */
export function slackRedirectUri(): string {
  return `${env.API_URL}/internal/integrations/slack/callback`;
}

/** Sign a Slack connect `state` token carrying the flow context. */
export function signSlackConnectState(
  state: SlackConnectState,
  nowMs: number = Date.now(),
): string {
  return signConnectState(
    { integrationId: state.integrationId, orgId: state.orgId, userId: state.userId },
    nowMs,
  );
}

/** Verify and decode a Slack connect `state` token. */
export function verifySlackConnectState(
  token: string,
  nowMs: number = Date.now(),
): SlackConnectState | null {
  const decoded = verifyConnectState(token, nowMs);
  if (!decoded) return null;
  const { integrationId, orgId, userId } = decoded;
  if (
    typeof integrationId !== 'string' ||
    typeof orgId !== 'string' ||
    typeof userId !== 'string'
  ) {
    return null;
  }
  return { integrationId, orgId, userId };
}

/**
 * Build the Slack `oauth.v2.authorize` URL for the shared app, carrying a signed `state`.
 *
 * @remarks
 * In `APP_MODE=local`/`test` this returns the callback URL directly with `code=mock`, so the
 * whole connect flow runs without a Slack app (the callback stamps deterministic fixtures).
 *
 * @param state - The signed connect state from {@link signSlackConnectState}.
 * @returns the authorize URL, or `null` when the Slack app is not configured.
 */
export function buildSlackAuthorizeUrl(state: string): string | null {
  if (mockMode()) {
    return `${slackRedirectUri()}?code=mock&state=${encodeURIComponent(state)}`;
  }
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) return null;
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    user_scope: SLACK_USER_SCOPES.join(','),
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/** The subset of Slack's `oauth.v2.access` response the exchange reads. */
interface SlackAccessResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly team?: { readonly id?: string; readonly name?: string };
  readonly authed_user?: {
    readonly id?: string;
    readonly access_token?: string;
    readonly scope?: string;
  };
}

/**
 * Exchange an OAuth `code` for the user grant via `oauth.v2.access`.
 *
 * @remarks
 * In `APP_MODE=local`/`test` (paired with `code=mock` from {@link buildSlackAuthorizeUrl}) the
 * exchange short-circuits to deterministic fixtures: workspace `T-MOCK` and a per-user
 * `U-MOCK-…` id, so local relevance routing behaves like production without credentials.
 *
 * @param code - The authorization code Slack redirected back with.
 * @param userId - The connecting Better Auth user (drives the mock fixture identity).
 * @returns the completed grant.
 * @throws {Error} when the exchange fails (`ok: false`) or the response is missing fields.
 */
export async function exchangeSlackCode(code: string, userId: string): Promise<SlackGrant> {
  if (mockMode()) {
    return {
      teamId: 'T-MOCK',
      teamName: 'Mock Workspace',
      slackUserId: `U-MOCK-${userId.slice(0, 12)}`,
      accessToken: 'mock',
      scope: SLACK_USER_SCOPES.join(','),
    };
  }
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    throw new Error('The Slack app is not configured (SLACK_CLIENT_ID is unset)');
  }
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: slackRedirectUri(),
    }),
  });
  const data = (await res.json()) as SlackAccessResponse;
  if (!data.ok) throw new Error(`Slack token exchange failed: ${data.error ?? 'unknown error'}`);
  const team = data.team;
  const authedUser = data.authed_user;
  const teamId = team?.id;
  const slackUserId = authedUser?.id;
  const accessToken = authedUser?.access_token;
  if (!teamId || !slackUserId || !accessToken) {
    throw new Error('Slack token exchange returned no user grant');
  }
  return {
    teamId,
    teamName: team.name ?? teamId,
    slackUserId,
    accessToken,
    scope: authedUser.scope ?? '',
  };
}
