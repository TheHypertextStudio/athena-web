/**
 * `@docket/api` — Slack connect-flow helpers: signed state round-trip, the local/test mock
 * short-circuit, and the real (non-mock) authorize-URL build + `oauth.v2.access` exchange, which
 * the callback route tests (`integrations-slack.test.ts`) never reach because `APP_MODE=test`
 * always takes the mock branch there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: {
  APP_MODE: 'local' | 'test' | 'production';
  SLACK_CLIENT_ID: string | undefined;
  SLACK_CLIENT_SECRET: string | undefined;
  API_URL: string;
  BETTER_AUTH_SECRET: string;
} = {
  APP_MODE: 'test',
  SLACK_CLIENT_ID: undefined,
  SLACK_CLIENT_SECRET: undefined,
  API_URL: 'https://api.docket.test',
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
};

vi.mock('../../src/env', () => ({ env }));

import type * as SlackApp from '../../src/lib/slack-app';

let mod!: typeof SlackApp;

beforeEach(async () => {
  vi.resetModules();
  env.APP_MODE = 'test';
  env.SLACK_CLIENT_ID = undefined;
  env.SLACK_CLIENT_SECRET = undefined;
  mod = await import('../../src/lib/slack-app');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signed connect state', () => {
  const STATE = { integrationId: 'intg_1', orgId: 'org_1', userId: 'user_1' };
  const NOW = 1_750_000_000_000;

  it('round-trips a valid, unexpired state', () => {
    const token = mod.signSlackConnectState(STATE, NOW);
    expect(mod.verifySlackConnectState(token, NOW + 1000)).toEqual(STATE);
  });

  it('rejects an expired state', () => {
    const token = mod.signSlackConnectState(STATE, NOW);
    expect(mod.verifySlackConnectState(token, NOW + 11 * 60_000)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(mod.verifySlackConnectState('garbage', NOW)).toBeNull();
  });

  it('rejects a well-signed payload whose fields are not all strings', async () => {
    // The shared envelope (signConnectState) will happily sign whatever JSON-serializable shape
    // it is given; the field-type check is slack-app's own guard, so it has to be exercised with
    // a payload the envelope accepts but slack-app's narrower type does not.
    const { signConnectState } = await import('../../src/lib/oauth-state');
    const forged = signConnectState(
      { integrationId: 'intg_1', orgId: 'org_1', userId: 42 as unknown as string },
      NOW,
    );
    expect(mod.verifySlackConnectState(forged, NOW + 1000)).toBeNull();
  });
});

describe('slackConfigured', () => {
  it('is false when the client id/secret are unset', () => {
    env.SLACK_CLIENT_ID = undefined;
    env.SLACK_CLIENT_SECRET = undefined;
    expect(mod.slackConfigured()).toBe(false);
  });

  it('is false for placeholder-shaped values', () => {
    env.SLACK_CLIENT_ID = 'your-slack-client-id';
    env.SLACK_CLIENT_SECRET = 'changeme';
    expect(mod.slackConfigured()).toBe(false);
  });

  it('is true once both are set to real-shaped values', () => {
    env.SLACK_CLIENT_ID = 'slack-client-id-123';
    env.SLACK_CLIENT_SECRET = 'slack-client-secret-456';
    expect(mod.slackConfigured()).toBe(true);
  });
});

describe('slackRedirectUri', () => {
  it('is the internal callback under API_URL', () => {
    expect(mod.slackRedirectUri()).toBe(
      'https://api.docket.test/internal/integrations/slack/callback',
    );
  });
});

describe('buildSlackAuthorizeUrl', () => {
  it('short-circuits to the callback with code=mock in local/test mode', () => {
    env.APP_MODE = 'local';
    const url = mod.buildSlackAuthorizeUrl('signed-state');
    expect(url).toBe(
      'https://api.docket.test/internal/integrations/slack/callback?code=mock&state=signed-state',
    );
  });

  it('returns null outside mock mode when the Slack app is not configured', () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = undefined;
    env.SLACK_CLIENT_SECRET = undefined;
    expect(mod.buildSlackAuthorizeUrl('signed-state')).toBeNull();
  });

  it('builds the real slack.com authorize URL with user_scope and state', () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = 'slack-client-id-123';
    env.SLACK_CLIENT_SECRET = 'slack-client-secret-456';
    const url = mod.buildSlackAuthorizeUrl('signed-state');
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('slack-client-id-123');
    expect(parsed.searchParams.get('user_scope')).toBe(mod.SLACK_USER_SCOPES.join(','));
    expect(parsed.searchParams.get('redirect_uri')).toBe(mod.slackRedirectUri());
    expect(parsed.searchParams.get('state')).toBe('signed-state');
  });
});

describe('exchangeSlackCode', () => {
  it('short-circuits to deterministic fixtures in local/test mode', async () => {
    env.APP_MODE = 'test';
    const grant = await mod.exchangeSlackCode('mock', 'user_abcdefghijklmno');
    expect(grant).toEqual({
      teamId: 'T-MOCK',
      teamName: 'Mock Workspace',
      slackUserId: 'U-MOCK-user_abcdefg',
      accessToken: 'mock',
      scope: mod.SLACK_USER_SCOPES.join(','),
    });
  });

  it('throws outside mock mode when the Slack app is not configured', async () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = undefined;
    env.SLACK_CLIENT_SECRET = undefined;
    await expect(mod.exchangeSlackCode('real-code', 'user_1')).rejects.toThrow(
      'The Slack app is not configured (SLACK_CLIENT_ID is unset)',
    );
  });

  it('exchanges a real code against oauth.v2.access and normalizes the grant', async () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = 'slack-client-id-123';
    env.SLACK_CLIENT_SECRET = 'slack-client-secret-456';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(input).toBe('https://slack.com/api/oauth.v2.access');
      expect(init?.method).toBe('POST');
      const body = new URLSearchParams(init?.body as string);
      expect(body.get('client_id')).toBe('slack-client-id-123');
      expect(body.get('client_secret')).toBe('slack-client-secret-456');
      expect(body.get('code')).toBe('real-code');
      return new Response(
        JSON.stringify({
          ok: true,
          team: { id: 'T123', name: 'Real Workspace' },
          authed_user: { id: 'U123', access_token: 'xoxp-real', scope: 'channels:history' },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const grant = await mod.exchangeSlackCode('real-code', 'user_1');
    expect(grant).toEqual({
      teamId: 'T123',
      teamName: 'Real Workspace',
      slackUserId: 'U123',
      accessToken: 'xoxp-real',
      scope: 'channels:history',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the team id as the name when Slack omits team.name', async () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = 'slack-client-id-123';
    env.SLACK_CLIENT_SECRET = 'slack-client-secret-456';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              team: { id: 'T999' },
              authed_user: { id: 'U999', access_token: 'xoxp-real' },
            }),
            { status: 200 },
          ),
      ),
    );
    const grant = await mod.exchangeSlackCode('real-code', 'user_1');
    expect(grant.teamName).toBe('T999');
    expect(grant.scope).toBe('');
  });

  it('throws with the reported error when Slack refuses the exchange', async () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = 'slack-client-id-123';
    env.SLACK_CLIENT_SECRET = 'slack-client-secret-456';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), { status: 200 }),
      ),
    );
    await expect(mod.exchangeSlackCode('bad-code', 'user_1')).rejects.toThrow(
      'Slack token exchange failed: invalid_code',
    );
  });

  it('throws a generic message when Slack refuses without naming an error', async () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = 'slack-client-id-123';
    env.SLACK_CLIENT_SECRET = 'slack-client-secret-456';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
    );
    await expect(mod.exchangeSlackCode('bad-code', 'user_1')).rejects.toThrow(
      'Slack token exchange failed: unknown error',
    );
  });

  it('throws when Slack reports ok but omits a required grant field', async () => {
    env.APP_MODE = 'production';
    env.SLACK_CLIENT_ID = 'slack-client-id-123';
    env.SLACK_CLIENT_SECRET = 'slack-client-secret-456';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, team: { id: 'T1' }, authed_user: { id: 'U1' } }),
            { status: 200 },
          ),
      ),
    );
    await expect(mod.exchangeSlackCode('code', 'user_1')).rejects.toThrow(
      'Slack token exchange returned no user grant',
    );
  });
});
