import { generateKeyPairSync, sign } from 'node:crypto';

import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clientIdFromRequest,
  decodeJwtPayload,
  liveIntrospectionResult,
  presentedRevocationToken,
  revokeGrant,
  verifyRevocableJwt,
} from '../src/oauth-provider-live-state';
import { OAUTH_GRANT_CLAIM } from '../src/oauth-resource-contract';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';
const ISSUER = 'https://api.clearthedocket.com/api/auth';
const RESOURCES = { issuer: ISSUER, mcpResource: MCP, restResource: REST };

function encodeJwt(claims: Record<string, unknown>, keyId = 'key_1') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(input), privateKey).toString('base64url');
  return {
    token: `${input}.${signature}`,
    storedKey: {
      id: keyId,
      publicKey: JSON.stringify(publicKey.export({ format: 'jwk' })),
      alg: 'EdDSA',
      crv: 'Ed25519',
      expiresAt: null,
    },
  };
}

function queuedAdapter(results: Record<string, unknown[][]>) {
  const queues = Object.fromEntries(
    Object.entries(results).map(([model, rows]) => [model, [...rows]]),
  );
  const updateMany = vi.fn(async () => 1);
  const findMany = vi.fn(async (input: { model: string }) => {
    const queue = queues[input.model];
    if (!queue) return [];
    return queue.shift() ?? [];
  });
  return {
    adapter: { findMany, updateMany } as unknown as DBTransactionAdapter,
    findMany,
    updateMany,
  };
}

function activeRefreshAdapter(
  overrides: {
    refresh?: Record<string, unknown>;
    grant?: Record<string, unknown>;
    users?: unknown[];
    clients?: unknown[];
  } = {},
) {
  const now = Date.now();
  const refresh = {
    id: 'refresh_1',
    token: 'digest',
    clientId: 'client_1',
    userId: 'user_1',
    scopes: ['work:read', 'offline_access'],
    createdAt: new Date(now - 60_000),
    expiresAt: new Date(now + 600_000),
    revoked: null,
    referenceId: null,
    docketGrantId: 'grant_1',
    ...overrides.refresh,
  };
  const grant = {
    id: 'grant_1',
    clientId: 'client_1',
    userId: 'user_1',
    consentId: null,
    authorizationKind: 'trusted_mcp',
    resourceUri: MCP,
    createdAt: new Date(now - 60_000),
    expiresAt: new Date(now + 600_000),
    revokedAt: null,
    legacyBefore: null,
    ...overrides.grant,
  };
  const clients = overrides.clients ?? [
    {
      clientId: 'client_1',
      disabled: false,
      skipConsent: true,
      scopes: ['work:read', 'offline_access'],
      docketLegacyBefore: null,
    },
  ];
  return queuedAdapter({
    jwks: [[]],
    oauthRefreshToken: [[refresh]],
    oauthResourceGrant: [[grant], [grant]],
    user: [overrides.users ?? [{ id: 'user_1' }]],
    oauthClient: [clients],
    oauthConsent: [[]],
    oauthJwtRevocation: [[]],
  });
}

describe('OAuth live credential state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decodes an object JWT payload and rejects malformed provider output', () => {
    const token = `e30.${Buffer.from(JSON.stringify({ sub: 'user_1' })).toString('base64url')}.sig`;
    expect(decodeJwtPayload(token)).toEqual({ sub: 'user_1' });
    for (const malformed of [
      'missing-payload',
      'e30.not-json.sig',
      `e30.${Buffer.from('null').toString('base64url')}.sig`,
      `e30.${Buffer.from('[]').toString('base64url')}.sig`,
    ]) {
      expect(() => decodeJwtPayload(malformed)).toThrow(
        expect.objectContaining({ body: expect.objectContaining({ error: 'server_error' }) }),
      );
    }
  });

  it('reads only complete Basic or form client credentials', () => {
    const context = (authorization?: string) => ({
      request: new Request('https://api.example.test', {
        headers: authorization ? { authorization } : {},
      }),
    });
    expect(
      clientIdFromRequest(
        context(`Basic ${Buffer.from('client_1:secret').toString('base64')}`) as never,
        {},
      ),
    ).toBe('client_1');
    expect(clientIdFromRequest(context('Basic Y2xpZW50XzE=') as never, {})).toBeNull();
    expect(
      clientIdFromRequest(
        context(`Basic ${Buffer.from('client_1:').toString('base64')}`) as never,
        {},
      ),
    ).toBeNull();
    expect(clientIdFromRequest(context() as never, {})).toBeNull();
    expect(clientIdFromRequest(context() as never, { client_id: 'client_1' })).toBe('client_1');

    vi.spyOn(Buffer, 'from').mockImplementationOnce(() => {
      throw new Error('decode failed');
    });
    expect(clientIdFromRequest(context('Basic broken') as never, {})).toBeNull();
  });

  it('normalizes bearer-wrapped revocation tokens and rejects absence', () => {
    expect(presentedRevocationToken({ token: 'Bearer access' })).toBe('access');
    expect(presentedRevocationToken({ token: 'opaque' })).toBe('opaque');
    expect(() => presentedRevocationToken({})).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'invalid_request' }) }),
    );
  });

  it('revokes a grant before every refresh descendant', async () => {
    const harness = queuedAdapter({});
    const now = new Date();
    await revokeGrant(harness.adapter, 'grant_1', now);
    expect(harness.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'oauthResourceGrant',
        update: { revokedAt: now },
      }),
    );
    expect(harness.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: 'oauthRefreshToken',
        update: { revoked: now },
      }),
    );
  });

  it('verifies a stored JWK and rejects claims outside Docket invariants', async () => {
    const now = Math.floor(Date.now() / 1_000);
    const valid = encodeJwt({
      iss: ISSUER,
      aud: MCP,
      azp: 'client_1',
      sub: 'user_1',
      exp: now + 60,
    });
    await expect(
      verifyRevocableJwt(
        queuedAdapter({ jwks: [[valid.storedKey]] }).adapter,
        valid.token,
        RESOURCES,
      ),
    ).resolves.toMatchObject({ azp: 'client_1' });

    const missingClient = encodeJwt({ iss: ISSUER, aud: MCP, sub: 'user_1', exp: now + 60 });
    await expect(
      verifyRevocableJwt(
        queuedAdapter({ jwks: [[missingClient.storedKey]] }).adapter,
        missingClient.token,
        RESOURCES,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyRevocableJwt(
        queuedAdapter({ jwks: [[valid.storedKey]] }).adapter,
        `${valid.token}broken`,
        RESOURCES,
      ),
    ).resolves.toBeNull();
  });

  it('accepts the REST audience through the same signed-JWT verifier', async () => {
    const now = Math.floor(Date.now() / 1_000);
    const valid = encodeJwt({
      iss: ISSUER,
      aud: REST,
      azp: 'client_1',
      sub: 'user_1',
      exp: now + 60,
    });

    await expect(
      verifyRevocableJwt(
        queuedAdapter({ jwks: [[valid.storedKey]] }).adapter,
        valid.token,
        RESOURCES,
      ),
    ).resolves.toMatchObject({ aud: REST });
  });

  it('fails closed on malformed stored signing keys', async () => {
    await expect(
      verifyRevocableJwt(
        queuedAdapter({ jwks: [[{ id: 'key', publicKey: '{' }]] }).adapter,
        'token',
        RESOURCES,
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    await expect(
      verifyRevocableJwt(
        queuedAdapter({ jwks: [[{ id: 'key', publicKey: '[]' }]] }).adapter,
        'token',
        RESOURCES,
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
  });

  it('preserves inactive provider introspection responses', async () => {
    const harness = queuedAdapter({});
    await expect(
      liveIntrospectionResult(harness.adapter, { token: 'token' }, { active: false }, RESOURCES),
    ).resolves.toEqual({ active: false });
    await expect(
      liveIntrospectionResult(harness.adapter, { token: 'token' }, { malformed: true }, RESOURCES),
    ).resolves.toEqual({ malformed: true });
    expect(harness.findMany).not.toHaveBeenCalled();
  });

  it('returns active live scopes for an authorized refresh credential', async () => {
    const harness = activeRefreshAdapter();
    await expect(
      liveIntrospectionResult(
        harness.adapter,
        { token: 'opaque-refresh' },
        { active: true, client_id: 'provider-client' },
        RESOURCES,
      ),
    ).resolves.toMatchObject({ active: true, scope: 'work:read offline_access' });
  });

  it('treats missing credentials, grants, subjects, and state as inactive', async () => {
    await expect(
      liveIntrospectionResult(
        queuedAdapter({ jwks: [[]], oauthRefreshToken: [[]] }).adapter,
        { token: 'missing' },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });
    await expect(
      liveIntrospectionResult(
        queuedAdapter({
          jwks: [[]],
          oauthRefreshToken: [
            [
              {
                id: 'refresh_1',
                token: 'digest',
                clientId: 'client_1',
                userId: 'user_1',
                scopes: ['work:read'],
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
                revoked: null,
                referenceId: null,
                docketGrantId: 'grant_1',
              },
            ],
          ],
          oauthResourceGrant: [[]],
        }).adapter,
        { token: 'missing-grant' },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });

    const now = Math.floor(Date.now() / 1_000);
    const noSubject = encodeJwt({ iss: ISSUER, aud: MCP, azp: 'client_1', exp: now + 60 });
    await expect(
      liveIntrospectionResult(
        queuedAdapter({ jwks: [[noSubject.storedKey]] }).adapter,
        { token: noSubject.token },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });

    const valid = encodeJwt({
      iss: ISSUER,
      aud: MCP,
      azp: 'client_1',
      sub: 'user_1',
      iat: now - 1,
      exp: now + 60,
      scope: 'work:read',
      jti: 'jwt_1',
      [OAUTH_GRANT_CLAIM]: 'grant_1',
    });
    await expect(
      liveIntrospectionResult(
        queuedAdapter({
          jwks: [[valid.storedKey]],
          user: [[]],
          oauthClient: [[]],
          oauthResourceGrant: [[]],
          oauthConsent: [[]],
          oauthJwtRevocation: [[]],
        }).adapter,
        { token: valid.token },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });
  });

  it('rejects malformed refresh subjects and unsupported stored audiences', async () => {
    await expect(
      liveIntrospectionResult(
        activeRefreshAdapter({ refresh: { clientId: 42 } }).adapter,
        { token: 'malformed-client' },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });

    await expect(
      liveIntrospectionResult(
        activeRefreshAdapter({ grant: { resourceUri: 'https://api.example.test/other' } }).adapter,
        { token: 'unsupported-audience' },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });
  });

  it('handles an absent exact grant row and applies REST authorization options', async () => {
    const missingGrant = activeRefreshAdapter();
    missingGrant.findMany.mockImplementation(async (input: { model: string }) => {
      if (input.model === 'jwks') return [];
      if (input.model === 'oauthRefreshToken') {
        return [
          {
            id: 'refresh_1',
            token: 'digest',
            clientId: 'client_1',
            userId: 'user_1',
            scopes: ['work:read', 'offline_access'],
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revoked: null,
            referenceId: null,
            docketGrantId: 'grant_1',
          },
        ];
      }
      if (input.model === 'oauthResourceGrant') return [undefined];
      return [];
    });
    await expect(
      liveIntrospectionResult(
        missingGrant.adapter,
        { token: 'missing-exact-grant' },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });

    const now = Math.floor(Date.now() / 1_000);
    const signed = encodeJwt({
      iss: ISSUER,
      aud: MCP,
      azp: 'client_1',
      sub: 'user_1',
      iat: now - 1,
      exp: now + 60,
      scope: 'work:read',
      jti: 'jwt_1',
      [OAUTH_GRANT_CLAIM]: 'grant_1',
    });
    await expect(
      liveIntrospectionResult(
        queuedAdapter({
          jwks: [[signed.storedKey]],
          user: [[{ id: 'user_1' }]],
          oauthClient: [
            [
              {
                clientId: 'client_1',
                disabled: false,
                skipConsent: true,
                scopes: ['work:read'],
                docketLegacyBefore: null,
              },
            ],
          ],
          oauthResourceGrant: [[undefined]],
          oauthConsent: [[]],
          oauthJwtRevocation: [[]],
        }).adapter,
        { token: signed.token },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });

    await expect(
      liveIntrospectionResult(
        activeRefreshAdapter({ grant: { resourceUri: REST } }).adapter,
        { token: 'rest-refresh' },
        { active: true },
        RESOURCES,
      ),
    ).resolves.toEqual({ active: false });
  });

  it('fails inactive when legacy materialization cannot read authority', async () => {
    const now = Math.floor(Date.now() / 1_000);
    const legacy = encodeJwt({
      iss: ISSUER,
      aud: MCP,
      azp: 'client_1',
      sub: 'user_1',
      iat: now - 1,
      exp: now + 60,
      scope: 'work:read',
      jti: 'jwt_1',
    });
    let calls = 0;
    const adapter = {
      findMany: vi.fn(async () => {
        calls += 1;
        if (calls === 1) return [legacy.storedKey];
        throw new Error('authority unavailable');
      }),
    } as unknown as DBTransactionAdapter;
    await expect(
      liveIntrospectionResult(adapter, { token: legacy.token }, { active: true }, RESOURCES),
    ).resolves.toEqual({ active: false });
  });

  it('does not hide unexpected live-state programming errors', async () => {
    const now = Math.floor(Date.now() / 1_000);
    const current = encodeJwt({
      iss: ISSUER,
      aud: MCP,
      azp: 'client_1',
      sub: 'user_1',
      iat: now - 1,
      exp: now + 60,
      scope: 'work:read',
      jti: 'jwt_1',
      [OAUTH_GRANT_CLAIM]: 'grant_1',
    });
    const malformedGrant = {
      id: 'grant_1',
      clientId: 'client_1',
      userId: 'user_1',
      consentId: null,
      authorizationKind: 'trusted_mcp',
      resourceUri: MCP,
      expiresAt: null,
      revokedAt: null,
      legacyBefore: null,
    };
    const harness = queuedAdapter({
      jwks: [[current.storedKey]],
      user: [[{ id: 'user_1' }]],
      oauthClient: [[{ clientId: 'client_1', skipConsent: true, scopes: ['work:read'] }]],
      oauthResourceGrant: [[malformedGrant]],
      oauthConsent: [[]],
      oauthJwtRevocation: [[]],
    });
    await expect(
      liveIntrospectionResult(
        harness.adapter,
        { token: current.token },
        { active: true },
        RESOURCES,
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
