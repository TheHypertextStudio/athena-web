/**
 * Unit tests for the Linear Agent platform boundary: the OAuth2 token grant (exchange +
 * refresh), refresh-due detection, webhook signature verification, webhook payload parsing,
 * the authenticated GraphQL client, `agentActivityCreate`/`agentSessionUpdate`, and the
 * `RealLinearAgentPort` adapter. Every request-building and response-mapping path is exercised
 * through an injected fake `HttpClient` so no network is touched, mirroring `linear.test.ts`.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ConnectorError } from '../../src/connector-error';
import type { HttpClient } from '../../src/http';
import {
  LinearAgentClient,
  RealLinearAgentPort,
  agentActivityCreate,
  agentSessionUpdate,
  buildLinearAgentAuthorizeUrl,
  exchangeLinearAgentCode,
  linearAgentTokenNeedsRefresh,
  parseLinearAgentWebhook,
  refreshLinearAgentToken,
  resolveLinearAgentInstallation,
  verifyLinearAgentWebhookSignature,
  type StoredLinearAgentTokens,
} from '../../src/linear-agent';
import { assertDefined } from '@docket/test-utils';

describe('buildLinearAgentAuthorizeUrl', () => {
  it('builds an actor=app authorize URL with the default mentionable+assignable scope', () => {
    const url = new URL(
      buildLinearAgentAuthorizeUrl({
        clientId: 'client_1',
        redirectUri: 'https://docket.app/oauth/linear-agent/callback',
        state: 'csrf_1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client_1');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://docket.app/oauth/linear-agent/callback',
    );
    expect(url.searchParams.get('scope')).toBe('app:mentionable,app:assignable');
    expect(url.searchParams.get('state')).toBe('csrf_1');
    expect(url.searchParams.get('actor')).toBe('app');
  });

  it('honors an explicit scope override', () => {
    const url = new URL(
      buildLinearAgentAuthorizeUrl({
        clientId: 'c',
        redirectUri: 'https://x/callback',
        state: 's',
        scope: 'app:mentionable',
      }),
    );
    expect(url.searchParams.get('scope')).toBe('app:mentionable');
  });
});

describe('exchangeLinearAgentCode / refreshLinearAgentToken', () => {
  it('exchanges an authorization_code grant and camelCases the response', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(
        JSON.stringify({
          access_token: 'lin_agent_tok',
          token_type: 'Bearer',
          expires_in: 86_400,
          scope: 'app:mentionable,app:assignable',
          refresh_token: 'lin_agent_refresh',
        }),
        { status: 200 },
      );
    };
    const tokens = await exchangeLinearAgentCode({
      clientId: 'client_1',
      clientSecret: 'secret_1',
      redirectUri: 'https://x/callback',
      code: 'auth_code_1',
      http,
    });
    expect(tokens).toEqual({
      accessToken: 'lin_agent_tok',
      tokenType: 'Bearer',
      expiresIn: 86_400,
      scope: 'app:mentionable,app:assignable',
      refreshToken: 'lin_agent_refresh',
    });
    expect(assertDefined(calls[0]).url).toBe('https://api.linear.app/oauth/token');
    expect(assertDefined(calls[0]).init?.method).toBe('POST');
    expect((assertDefined(calls[0]).init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(assertDefined(calls[0]).init?.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('client_1');
    expect(body.get('client_secret')).toBe('secret_1');
    expect(body.get('redirect_uri')).toBe('https://x/callback');
    expect(body.get('code')).toBe('auth_code_1');
  });

  it('refreshes with a refresh_token grant', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(
        JSON.stringify({
          access_token: 'new_tok',
          token_type: 'Bearer',
          expires_in: 86_400,
          scope: 'app:mentionable',
          refresh_token: 'new_refresh',
        }),
        { status: 200 },
      );
    };
    const tokens = await refreshLinearAgentToken({
      clientId: 'client_1',
      clientSecret: 'secret_1',
      refreshToken: 'old_refresh',
      http,
    });
    expect(tokens.accessToken).toBe('new_tok');
    const body = new URLSearchParams(assertDefined(calls[0]).init?.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old_refresh');
    expect(body.has('code')).toBe(false);
  });

  it('falls back to the platform fetch when no transport is injected', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'a',
            token_type: 'Bearer',
            expires_in: 1,
            scope: 's',
            refresh_token: 'r',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await exchangeLinearAgentCode({
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://x/callback',
        code: 'code',
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the platform fetch when refreshing without an injected transport', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'refreshed',
            token_type: 'Bearer',
            expires_in: 1,
            scope: 's',
            refresh_token: 'r2',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const tokens = await refreshLinearAgentToken({
        clientId: 'c',
        clientSecret: 's',
        refreshToken: 'old_refresh',
      });
      expect(tokens.accessToken).toBe('refreshed');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws a network ConnectorError when the request never completes', async () => {
    const http: HttpClient = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(
      exchangeLinearAgentCode({
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://x/callback',
        code: 'code',
        http,
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('throws an auth ConnectorError with a body snippet on a 401', async () => {
    const http: HttpClient = async () => new Response('invalid_grant', { status: 401 });
    const err = await exchangeLinearAgentCode({
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://x/callback',
      code: 'bad',
      http,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect((err as ConnectorError).kind).toBe('auth');
    expect((err as ConnectorError).message).toContain('invalid_grant');
  });

  it('falls back to an empty snippet when reading the error body throws', async () => {
    const broken = {
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('stream consumed')),
      json: () => Promise.reject(new Error('n/a')),
    } as unknown as Response;
    const http: HttpClient = async () => broken;
    await expect(
      exchangeLinearAgentCode({
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://x/callback',
        code: 'c',
        http,
      }),
    ).rejects.toThrow(/linear-agent oauth token exchange failed: 500$/);
  });

  it('throws a provider ConnectorError when the response body is not valid JSON', async () => {
    const http: HttpClient = async () => new Response('not json<!>', { status: 200 });
    await expect(
      exchangeLinearAgentCode({
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://x/callback',
        code: 'c',
        http,
      }),
    ).rejects.toMatchObject({ kind: 'provider' });
  });

  it('throws a provider ConnectorError when the response is missing required fields', async () => {
    const http: HttpClient = async () =>
      new Response(JSON.stringify({ access_token: 'a' }), { status: 200 });
    await expect(
      exchangeLinearAgentCode({
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://x/callback',
        code: 'c',
        http,
      }),
    ).rejects.toMatchObject({ kind: 'provider' });
  });
});

describe('linearAgentTokenNeedsRefresh', () => {
  const base: StoredLinearAgentTokens = {
    accessToken: 'a',
    tokenType: 'Bearer',
    expiresIn: 86_400, // 24h
    scope: 's',
    refreshToken: 'r',
    obtainedAt: '2026-01-01T00:00:00.000Z',
  };

  it('is false well within the token lifetime', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 60_000; // 1 minute in
    expect(linearAgentTokenNeedsRefresh(base, now)).toBe(false);
  });

  it('is true once within the refresh margin of expiry', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 86_400 * 1000 - 1_000; // 1s left
    expect(linearAgentTokenNeedsRefresh(base, now)).toBe(true);
  });

  it('is true past expiry', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z') + 86_400 * 1000 + 1_000;
    expect(linearAgentTokenNeedsRefresh(base, now)).toBe(true);
  });

  it('is true when obtainedAt is unparseable (fails closed)', () => {
    expect(linearAgentTokenNeedsRefresh({ ...base, obtainedAt: 'not-a-date' }, Date.now())).toBe(
      true,
    );
  });

  it('defaults nowMs to the current time when omitted', () => {
    // obtainedAt far in the past relative to "now" (real Date.now()) → clearly due.
    expect(linearAgentTokenNeedsRefresh({ ...base, obtainedAt: '2000-01-01T00:00:00.000Z' })).toBe(
      true,
    );
  });
});

describe('verifyLinearAgentWebhookSignature', () => {
  const SECRET = 'lin_agent_whsec_test';

  function sign(body: string): string {
    return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
  }

  it('accepts a correctly-signed, fresh delivery', () => {
    const body = JSON.stringify({ webhookTimestamp: Date.now(), action: 'created' });
    expect(
      verifyLinearAgentWebhookSignature(body, { 'linear-signature': sign(body) }, SECRET),
    ).toBe(true);
  });

  it('rejects when the signature header is missing', () => {
    expect(verifyLinearAgentWebhookSignature('{}', {}, SECRET)).toBe(false);
  });

  it('rejects a signature of the wrong length', () => {
    const body = '{}';
    expect(verifyLinearAgentWebhookSignature(body, { 'linear-signature': 'short' }, SECRET)).toBe(
      false,
    );
  });

  it('rejects a same-length but incorrect signature', () => {
    const body = JSON.stringify({ webhookTimestamp: Date.now() });
    const wrong = sign(body).split('').reverse().join('');
    expect(verifyLinearAgentWebhookSignature(body, { 'linear-signature': wrong }, SECRET)).toBe(
      false,
    );
  });

  it('rejects an unparseable body even with a matching signature (matching garbage is still garbage)', () => {
    const body = 'not json';
    expect(
      verifyLinearAgentWebhookSignature(body, { 'linear-signature': sign(body) }, SECRET),
    ).toBe(false);
  });

  it('rejects a body missing webhookTimestamp', () => {
    const body = JSON.stringify({ action: 'created' });
    expect(
      verifyLinearAgentWebhookSignature(body, { 'linear-signature': sign(body) }, SECRET),
    ).toBe(false);
  });

  it('rejects a delivery outside the replay window', () => {
    const body = JSON.stringify({ webhookTimestamp: Date.now() - 5 * 60_000 });
    expect(
      verifyLinearAgentWebhookSignature(body, { 'linear-signature': sign(body) }, SECRET),
    ).toBe(false);
  });
});

describe('parseLinearAgentWebhook', () => {
  it('parses a created-action delivery', () => {
    const payload = {
      type: 'AgentSessionEvent',
      action: 'created',
      agentSession: { id: 'sess_1' },
    };
    const parsed = parseLinearAgentWebhook(payload);
    expect(parsed).toMatchObject({ action: 'created', agentSession: { id: 'sess_1' } });
  });

  it('parses a prompted-action delivery, requiring agentActivity.body', () => {
    const payload = {
      action: 'prompted',
      agentSession: { id: 'sess_1' },
      agentActivity: { id: 'act_1', body: 'Please also check the staging env.' },
    };
    const parsed = parseLinearAgentWebhook(payload);
    expect(parsed).toMatchObject({
      action: 'prompted',
      agentActivity: { body: 'Please also check the staging env.' },
    });
  });

  it('returns null for an unrecognized action', () => {
    expect(parseLinearAgentWebhook({ action: 'closed', agentSession: { id: 's' } })).toBeNull();
  });

  it('returns null when required fields are missing (e.g. agentSession.id)', () => {
    expect(parseLinearAgentWebhook({ action: 'created', agentSession: {} })).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(parseLinearAgentWebhook('garbage')).toBeNull();
    expect(parseLinearAgentWebhook(null)).toBeNull();
  });
});

describe('LinearAgentClient.query', () => {
  it('posts a bearer-authenticated GraphQL request and returns data', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    };
    const client = new LinearAgentClient('agent_tok', http);
    const data = await client.query<{ ok: boolean }>('query { x }');
    expect(data).toEqual({ ok: true });
    expect(assertDefined(calls[0]).url).toBe('https://api.linear.app/graphql');
    expect((assertDefined(calls[0]).init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer agent_tok',
    );
  });

  it('classifies an auth-shaped GraphQL error as auth', async () => {
    const http: HttpClient = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Unauthorized: token revoked' }] }), {
        status: 200,
      });
    const client = new LinearAgentClient('tok', http);
    await expect(client.query('query { x }')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('classifies a non-auth GraphQL error as provider', async () => {
    const http: HttpClient = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Internal error' }] }), { status: 200 });
    const client = new LinearAgentClient('tok', http);
    await expect(client.query('query { x }')).rejects.toMatchObject({ kind: 'provider' });
  });

  it('throws provider when the response is missing data', async () => {
    const http: HttpClient = async () => new Response(JSON.stringify({}), { status: 200 });
    const client = new LinearAgentClient('tok', http);
    await expect(client.query('query { x }')).rejects.toMatchObject({ kind: 'provider' });
  });

  it('defaults to the platform fetch when no transport is injected', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new LinearAgentClient('tok');
      await client.query('query { x }');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('agentActivityCreate', () => {
  it('posts the activity with type/body and returns the created id', async () => {
    const calls: { body: unknown }[] = [];
    const http: HttpClient = async (_url, init) => {
      calls.push({ body: JSON.parse(init?.body as string) });
      return new Response(
        JSON.stringify({
          data: { agentActivityCreate: { success: true, agentActivity: { id: 'act_1' } } },
        }),
        { status: 200 },
      );
    };
    const client = new LinearAgentClient('tok', http);
    const result = await agentActivityCreate(client, {
      agentSessionId: 'sess_1',
      type: 'thought',
      body: 'Looking into it…',
    });
    expect(result).toEqual({ id: 'act_1' });
    const variables = (
      assertDefined(calls[0]).body as { variables: { input: Record<string, unknown> } }
    ).variables.input;
    expect(variables).toMatchObject({
      agentSessionId: 'sess_1',
      content: { type: 'thought', body: 'Looking into it…' },
    });
    expect(variables).not.toHaveProperty('ephemeral');
  });

  it('carries the ephemeral flag when set', async () => {
    const calls: { body: unknown }[] = [];
    const http: HttpClient = async (_url, init) => {
      calls.push({ body: JSON.parse(init?.body as string) });
      return new Response(
        JSON.stringify({
          data: { agentActivityCreate: { success: true, agentActivity: { id: 'act_1' } } },
        }),
        { status: 200 },
      );
    };
    const client = new LinearAgentClient('tok', http);
    await agentActivityCreate(client, {
      agentSessionId: 'sess_1',
      type: 'thought',
      body: 'tick',
      ephemeral: true,
    });
    const variables = (
      assertDefined(calls[0]).body as { variables: { input: Record<string, unknown> } }
    ).variables.input;
    expect(variables).toMatchObject({ ephemeral: true });
  });

  it('carries a native select signal and its options', async () => {
    const calls: { body: unknown }[] = [];
    const http: HttpClient = async (_url, init) => {
      calls.push({ body: JSON.parse(init?.body as string) });
      return new Response(
        JSON.stringify({
          data: { agentActivityCreate: { success: true, agentActivity: { id: 'act_1' } } },
        }),
        { status: 200 },
      );
    };
    const client = new LinearAgentClient('tok', http);
    await agentActivityCreate(client, {
      agentSessionId: 'sess_1',
      type: 'elicitation',
      body: 'Approve this action?',
      signal: 'select',
      signalMetadata: {
        options: [
          { label: 'Approve', value: 'signed-approve' },
          { label: 'Reject', value: 'signed-reject' },
        ],
      },
    });
    const variables = (
      assertDefined(calls[0]).body as { variables: { input: Record<string, unknown> } }
    ).variables.input;
    expect(variables).toMatchObject({
      signal: 'select',
      signalMetadata: {
        options: [
          { label: 'Approve', value: 'signed-approve' },
          { label: 'Reject', value: 'signed-reject' },
        ],
      },
    });
  });

  it('throws provider when Linear reports success: false', async () => {
    const http: HttpClient = async () =>
      new Response(JSON.stringify({ data: { agentActivityCreate: { success: false } } }), {
        status: 200,
      });
    const client = new LinearAgentClient('tok', http);
    await expect(
      agentActivityCreate(client, { agentSessionId: 's', type: 'thought', body: 'x' }),
    ).rejects.toMatchObject({ kind: 'provider' });
  });

  it('throws provider when the created activity carries no id', async () => {
    const http: HttpClient = async () =>
      new Response(
        JSON.stringify({ data: { agentActivityCreate: { success: true, agentActivity: {} } } }),
        { status: 200 },
      );
    const client = new LinearAgentClient('tok', http);
    await expect(
      agentActivityCreate(client, { agentSessionId: 's', type: 'thought', body: 'x' }),
    ).rejects.toMatchObject({ kind: 'provider' });
  });
});

describe('resolveLinearAgentInstallation', () => {
  it('returns the installed workspace and app actor', async () => {
    const calls: { body: unknown }[] = [];
    const http: HttpClient = async (_url, init) => {
      calls.push({ body: JSON.parse(init?.body as string) });
      return new Response(
        JSON.stringify({
          data: {
            organization: { id: 'org_linear', name: 'Acme', urlKey: 'acme' },
            viewer: { id: 'app_actor' },
          },
        }),
        { status: 200 },
      );
    };

    await expect(resolveLinearAgentInstallation('token', http)).resolves.toEqual({
      workspaceId: 'org_linear',
      workspaceName: 'Acme',
      workspaceUrlKey: 'acme',
      appActorId: 'app_actor',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('agentSessionUpdate', () => {
  it('sets the session id/input and resolves on success', async () => {
    const calls: { body: unknown }[] = [];
    const http: HttpClient = async (_url, init) => {
      calls.push({ body: JSON.parse(init?.body as string) });
      return new Response(JSON.stringify({ data: { agentSessionUpdate: { success: true } } }), {
        status: 200,
      });
    };
    const client = new LinearAgentClient('tok', http);
    await expect(
      agentSessionUpdate(client, {
        agentSessionId: 'sess_1',
        externalUrls: [{ label: 'Open in Docket', url: 'https://docket.app/t/1' }],
      }),
    ).resolves.toBeUndefined();
    const body = assertDefined(calls[0]).body as { variables: Record<string, unknown> };
    expect(body.variables).toEqual({
      id: 'sess_1',
      input: { externalUrls: [{ label: 'Open in Docket', url: 'https://docket.app/t/1' }] },
    });
  });

  it('throws provider when Linear reports success: false', async () => {
    const http: HttpClient = async () =>
      new Response(JSON.stringify({ data: { agentSessionUpdate: { success: false } } }), {
        status: 200,
      });
    const client = new LinearAgentClient('tok', http);
    await expect(
      agentSessionUpdate(client, { agentSessionId: 's', externalUrls: [] }),
    ).rejects.toMatchObject({ kind: 'provider' });
  });
});

describe('RealLinearAgentPort', () => {
  it('delegates agentActivityCreate/agentSessionUpdate to the free functions via the client', async () => {
    const calls: string[] = [];
    const http: HttpClient = async (_url, init) => {
      const body = JSON.parse(init?.body as string) as { query: string };
      if (body.query.includes('AgentActivityCreate')) {
        calls.push('activity');
        return new Response(
          JSON.stringify({
            data: { agentActivityCreate: { success: true, agentActivity: { id: 'act_1' } } },
          }),
          { status: 200 },
        );
      }
      calls.push('session');
      return new Response(JSON.stringify({ data: { agentSessionUpdate: { success: true } } }), {
        status: 200,
      });
    };
    const port = new RealLinearAgentPort(new LinearAgentClient('tok', http));

    const activity = await port.agentActivityCreate({
      agentSessionId: 's',
      type: 'response',
      body: 'Done.',
    });
    expect(activity).toEqual({ id: 'act_1' });

    await expect(
      port.agentSessionUpdate({ agentSessionId: 's', externalUrls: [] }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual(['activity', 'session']);
  });
});
