import { runWithRequestState } from '@better-auth/core/context';
import type * as OAuthProviderModule from '@better-auth/oauth-provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const providerControl = vi.hoisted(() => ({
  factory: undefined as undefined | (() => unknown),
  options: undefined as undefined | Record<string, unknown>,
}));

vi.mock('@better-auth/oauth-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof OAuthProviderModule>();
  return {
    ...actual,
    oauthProvider: (options: Record<string, unknown>) => {
      providerControl.options = options;
      return providerControl.factory
        ? providerControl.factory()
        : actual.oauthProvider(options as never);
    },
  };
});

import { createDocketOAuthProvider } from '../src/oauth-resource-provider';
import { issuanceState } from '../src/oauth-provider-types';
import { OAUTH_GRANT_CLAIM } from '../src/oauth-resource-contract';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';
const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: MCP,
  restResource: REST,
};

function options(overrides: Record<string, unknown> = {}) {
  return {
    loginPage: 'https://clearthedocket.com/sign-in',
    consentPage: 'https://clearthedocket.com/oauth/authorize',
    scopes: ['work:read', 'offline_access'],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    ...overrides,
  };
}

function endpoint(path: string, endpointOptions: Record<string, unknown> = {}) {
  return Object.assign(async () => null, { path, options: endpointOptions });
}

function fakePlugin() {
  const endpoints = Object.fromEntries(
    [
      'oauth2Authorize',
      'oauth2Consent',
      'oauth2Continue',
      'oauth2Token',
      'oauth2Introspect',
      'oauth2Revoke',
      'updateOAuthConsent',
      'deleteOAuthConsent',
    ].map((key) => [key, endpoint(`/${key}`)]),
  );
  endpoints['oauth2Authorize'] = endpoint('/oauth2Authorize', {
    query: z.object({ client_id: z.string() }),
  });
  return {
    id: 'defensive-provider',
    endpoints,
    hooks: { after: [{ matcher: () => false, handler: endpoint('/post-login') }] },
    schema: {
      oauthClient: { fields: {} },
      oauthRefreshToken: { fields: {} },
    },
  };
}

describe('Docket OAuth provider defensive composition', () => {
  afterEach(() => {
    providerControl.factory = undefined;
    providerControl.options = undefined;
  });

  it('rejects incompatible provider endpoint and schema shapes', () => {
    providerControl.factory = () => ({ id: 'missing-endpoints' });
    expect(() => createDocketOAuthProvider(options() as never, RESOURCES)).toThrow(
      'The installed OAuth provider is missing endpoints.',
    );

    providerControl.factory = () => {
      const plugin = fakePlugin();
      Reflect.deleteProperty(plugin.endpoints, 'oauth2Token');
      return plugin;
    };
    expect(() => createDocketOAuthProvider(options() as never, RESOURCES)).toThrow(
      'The installed OAuth provider is missing oauth2Token.',
    );

    providerControl.factory = () => {
      const plugin = fakePlugin();
      const authorize = plugin.endpoints['oauth2Authorize'];
      if (!authorize) throw new Error('Missing fake authorize endpoint.');
      authorize.options['query'] = 'not-a-schema';
      return plugin;
    };
    expect(() => createDocketOAuthProvider(options() as never, RESOURCES)).toThrow(
      'The installed OAuth provider authorize schema is not a Zod object.',
    );

    providerControl.factory = () => ({ ...fakePlugin(), schema: {} });
    expect(() => createDocketOAuthProvider(options() as never, RESOURCES)).toThrow(
      'The installed OAuth provider schema is missing required models.',
    );
  });

  it('fails closed when token response fields have no issuance authority', async () => {
    createDocketOAuthProvider(options(), RESOURCES);
    const fields = providerControl.options?.['customTokenResponseFields'] as (
      info: Record<string, unknown>,
    ) => Promise<unknown>;

    await runWithRequestState(new WeakMap(), async () => {
      await expect(fields({ grantType: 'refresh_token' })).rejects.toMatchObject({
        body: expect.objectContaining({ error: 'server_error' }),
      });
    });
  });

  it('validates authorization-code verification values before custom fields', async () => {
    const suppliedFields = vi.fn(async () => ({ custom_field: true }));
    createDocketOAuthProvider(options({ customTokenResponseFields: suppliedFields }), RESOURCES);
    const fields = providerControl.options?.['customTokenResponseFields'] as (
      info: Record<string, unknown>,
    ) => Promise<unknown>;

    await runWithRequestState(new WeakMap(), async () => {
      await issuanceState.set({
        kind: 'refresh_token',
        clientId: 'client_1',
        userId: 'user_1',
        resource: MCP,
        grantId: 'grant_1',
      });
      await expect(fields({ grantType: 'refresh_token' })).resolves.toEqual({
        custom_field: true,
      });
    });

    const authorizationState = {
      kind: 'authorization_code' as const,
      clientId: 'client_1',
      userId: 'user_1',
      resource: MCP,
      grantId: 'grant_1',
      verificationIdentifier: 'code:1',
      verificationSnapshot: {
        query: { client_id: 'client_1', resource: MCP },
        userId: 'user_1',
        sessionId: 'session_1',
      },
    };
    await runWithRequestState(new WeakMap(), async () => {
      await issuanceState.set(authorizationState);
      await expect(
        fields({ grantType: 'authorization_code', verificationValue: {} }),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    });
    for (const resource of [undefined, 'https://api.example.test/other']) {
      await runWithRequestState(new WeakMap(), async () => {
        await issuanceState.set(authorizationState);
        await expect(
          fields({
            grantType: 'authorization_code',
            verificationValue: {
              query: { client_id: 'client_1', resource },
              userId: 'user_1',
              sessionId: 'session_1',
            },
          }),
        ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
      });
    }
  });

  it('requires matching issuance state before adding custom access claims', async () => {
    const suppliedClaims = vi.fn(async () => ({ custom_claim: true }));
    createDocketOAuthProvider(options({ customAccessTokenClaims: suppliedClaims }), RESOURCES);
    const claims = providerControl.options?.['customAccessTokenClaims'] as (
      info: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    await runWithRequestState(new WeakMap(), async () => {
      await expect(claims({ resource: MCP, user: { id: 'user_1' } })).rejects.toMatchObject({
        body: expect.objectContaining({ error: 'server_error' }),
      });
    });
    await runWithRequestState(new WeakMap(), async () => {
      await issuanceState.set({
        kind: 'refresh_token',
        clientId: 'client_1',
        userId: 'user_1',
        resource: MCP,
        grantId: 'grant_1',
      });
      await expect(claims({ resource: MCP, user: { id: 'user_1' } })).resolves.toMatchObject({
        custom_claim: true,
        [OAUTH_GRANT_CLAIM]: 'grant_1',
        jti: expect.any(String),
      });
    });
  });
});
