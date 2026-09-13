import { describe, expect, it } from 'vitest';
import type { BetterAuthPlugin } from 'better-auth';

import { createDocketOAuthProvider } from '../src/oauth-resource-provider';
import { wrapPostLoginAuthorizeHook } from '../src/oauth-provider-authorization-endpoints';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';
const ISSUER = 'https://api.clearthedocket.com/api/auth';

function provider() {
  return createDocketOAuthProvider(
    {
      loginPage: 'https://clearthedocket.com/sign-in',
      consentPage: 'https://clearthedocket.com/oauth/authorize',
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link', 'offline_access'],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    },
    { issuer: ISSUER, mcpResource: MCP, restResource: REST },
  );
}

describe('Docket OAuth provider composition', () => {
  it('retains and defaults the canonical resource on the original authorize endpoint', async () => {
    const plugin = provider();
    const authorize = plugin.endpoints?.['oauth2Authorize'];
    expect(authorize).toBeDefined();

    const schema = authorize?.options.query;
    expect(await schema?.['~standard'].validate({ client_id: 'client_1' })).toMatchObject({
      value: { client_id: 'client_1', resource: MCP },
    });
    expect(
      await schema?.['~standard'].validate({ client_id: 'client_1', resource: REST }),
    ).toMatchObject({ value: { client_id: 'client_1', resource: REST } });
  });

  it.each([
    ['empty', ''],
    ['comma-separated', `${REST},${MCP}`],
    ['unknown', 'https://api.example.test/v1'],
    ['trailing slash', `${REST}/`],
    ['repeated equal', [REST, REST]],
    ['repeated different', [REST, MCP]],
  ])(
    'rejects %s authorize resources before the provider serializes them',
    async (_name, resource) => {
      const schema = provider().endpoints?.['oauth2Authorize']?.options.query;
      const result = await schema?.['~standard'].validate({ client_id: 'client_1', resource });
      expect(result).toHaveProperty('issues');
    },
  );

  it('pins the shared token digest and both resource audiences in provider options', async () => {
    const options = provider().options ?? {};
    const storeTokens = options['storeTokens'] as {
      hash(token: string, type: string): Promise<string>;
    };

    await expect(storeTokens.hash('secret-token', 'refresh_token')).resolves.toBe(
      'kwu9xRtq7VwqVnj9bije56BeiktkPPwLRCfD77hsDZQ',
    );
    expect(options['validAudiences']).toEqual([MCP, REST]);
    expect(options['prefix']).toBeUndefined();
    expect(options['formatRefreshToken']).toBeUndefined();
  });

  it('wraps token and revoke parsing with untouched-request clones', () => {
    const endpoints = provider().endpoints;
    expect(endpoints?.['oauth2Token']?.options.cloneRequest).toBe(true);
    expect(endpoints?.['oauth2Revoke']?.options.cloneRequest).toBe(true);
  });

  it('declares the Docket grant fields in the same plugin schema the adapter uses', () => {
    const schema = provider().schema;
    expect(schema?.['oauthRefreshToken']?.fields).toHaveProperty('docketGrantId');
    expect(schema?.['oauthClient']?.fields).toHaveProperty('docketLegacyBefore');
    expect(schema?.['oauthClient']?.fields).toHaveProperty('docketLegacyTrusted');
    expect(schema).toHaveProperty('oauthResourceGrant');
    expect(schema).toHaveProperty('oauthJwtRevocation');
  });

  it('replaces the single pinned post-login handler without changing its matcher', () => {
    const matcher = () => true;
    const originalHandler = async () => null;
    const plugin = {
      id: 'post-login-seam-probe',
      hooks: { after: [{ matcher, handler: originalHandler }] },
    } as unknown as BetterAuthPlugin;

    wrapPostLoginAuthorizeHook(plugin, {
      issuer: ISSUER,
      mcpResource: MCP,
      restResource: REST,
    });

    expect(plugin.hooks?.after).toHaveLength(1);
    expect(plugin.hooks?.after?.[0]?.matcher).toBe(matcher);
    expect(plugin.hooks?.after?.[0]?.handler).not.toBe(originalHandler);
    expect(
      plugin.hooks?.after?.[0]?.matcher({ path: '/two-factor/verify-backup-code' } as never),
    ).toBe(true);
  });
});
