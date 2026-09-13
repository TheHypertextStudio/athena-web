import type { BetterAuthPlugin } from '@better-auth/core';
import { eq } from 'drizzle-orm';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { describe, expect, it, vi } from 'vitest';

import * as resourceContract from '../src/oauth-resource-contract';

import {
  deferred,
  exchangeStoredCode,
  isolatedProviderAuth,
  seedStoredAuthorizationCode,
} from './oauth-provider-handler.support';

describe('Docket OAuth provider branch settlement', () => {
  it('runs outer hooks and rate limiting exactly once for one wrapped token request', async () => {
    const fixture = await seedStoredAuthorizationCode('single-dispatch');
    const observed = { before: 0, after: 0, onRequest: 0, rateLimit: 0 };
    const observer = {
      id: 'docket-oauth-single-dispatch-observer',
      onRequest: async () => {
        observed.onRequest += 1;
      },
      hooks: {
        before: [
          {
            matcher: (context) => context.path === '/oauth2/token',
            handler: createAuthMiddleware(async () => {
              observed.before += 1;
            }),
          },
        ],
        after: [
          {
            matcher: (context) => context.path === '/oauth2/token',
            handler: createAuthMiddleware(async () => {
              observed.after += 1;
            }),
          },
        ],
      },
      rateLimit: [
        {
          window: 60,
          max: 100,
          pathMatcher: (path) => {
            observed.rateLimit += 1;
            return path.endsWith('/oauth2/token');
          },
        },
      ],
    } satisfies BetterAuthPlugin;
    const isolatedAuth = isolatedProviderAuth(
      {
        generateRefreshToken: async () => `single-dispatch-refresh-${fixture.suffix}`,
        customAccessTokenClaims: () => ({}),
      },
      {
        plugins: [observer],
        rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },
      },
    );

    const isolatedContext = await isolatedAuth.$context;
    expect(isolatedContext.rateLimit.enabled).toBe(true);
    const response = await exchangeStoredCode(isolatedAuth.handler, fixture);

    expect(response.status, await response.clone().text()).toBe(200);
    expect(observed).toEqual({ before: 1, after: 1, onRequest: 1, rateLimit: 1 });
  });

  it('waits for a delayed refresh hash and restores the code after a sibling issuance failure', async () => {
    const {
      db,
      oauthAccessToken,
      oauthRefreshToken,
      oauthResourceGrant,
      setDatabaseQueryObserver,
      verification,
    } = await import('@docket/db');
    const { clientId, code, verifier, identifier, suffix } =
      await seedStoredAuthorizationCode('late-failure');

    const hashStarted = deferred();
    const releaseHash = deferred();
    let failAccessClaims = true;
    const refreshToken = `late-failure-refresh-${suffix}`;
    const originalHash = resourceContract.hashOAuthToken;
    const hashSpy = vi
      .spyOn(resourceContract, 'hashOAuthToken')
      .mockImplementation(async (token) => {
        if (token === refreshToken) {
          hashStarted.resolve();
          await releaseHash.promise;
        }
        return originalHash(token);
      });
    const isolatedAuth = isolatedProviderAuth({
      generateRefreshToken: async () => refreshToken,
      customAccessTokenClaims: () => {
        if (failAccessClaims) {
          throw new APIError('INTERNAL_SERVER_ERROR', {
            error: 'server_error',
            error_description: 'Injected access-token claim failure.',
          });
        }
        return {};
      },
    });
    const exchange = () => exchangeStoredCode(isolatedAuth.handler, { clientId, code, verifier });

    let settled = false;
    let refreshInsertObserved = false;
    let postSettlementAdapterUse = false;
    setDatabaseQueryObserver((query) => {
      if (!query.toLowerCase().includes('insert into "oauth_refresh_token"')) return;
      refreshInsertObserved = true;
      if (settled) postSettlementAdapterUse = true;
    });
    try {
      const failedExchange = exchange().finally(() => {
        settled = true;
      });
      await hashStarted.promise;
      await Promise.resolve();
      expect(settled).toBe(false);
      releaseHash.resolve();
      const failed = await failedExchange;
      expect(failed.status).toBe(500);
      expect(await failed.json()).toMatchObject({ error: 'server_error' });
      expect(refreshInsertObserved).toBe(true);
      await Promise.resolve();
      expect(postSettlementAdapterUse).toBe(false);
      await expect(
        db.select().from(verification).where(eq(verification.identifier, identifier)),
      ).resolves.toHaveLength(1);
      await expect(
        db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, clientId)),
      ).resolves.toHaveLength(0);
      await expect(
        db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, clientId)),
      ).resolves.toHaveLength(0);
      await expect(
        db.select().from(oauthAccessToken).where(eq(oauthAccessToken.clientId, clientId)),
      ).resolves.toHaveLength(0);

      failAccessClaims = false;
      const retried = await exchange();
      expect(retried.status, await retried.clone().text()).toBe(200);
    } finally {
      setDatabaseQueryObserver(undefined);
      hashSpy.mockRestore();
    }
  });

  it('fails closed when a prefixed refresh credential cannot correlate to its stored digest', async () => {
    const { db, oauthRefreshToken, oauthResourceGrant, verification } = await import('@docket/db');
    const fixture = await seedStoredAuthorizationCode('prefix-correlation');
    const prefixedRefresh = `encrypted:v1:refresh:${fixture.suffix}`;
    const originalHash = resourceContract.hashOAuthToken;
    let refreshHashCalls = 0;
    const hashSpy = vi
      .spyOn(resourceContract, 'hashOAuthToken')
      .mockImplementation(async (token) => {
        if (token !== prefixedRefresh) return originalHash(token);
        refreshHashCalls += 1;
        return originalHash(refreshHashCalls === 1 ? token : `${token}:binding-mismatch`);
      });
    const isolatedAuth = isolatedProviderAuth({
      generateRefreshToken: async () => prefixedRefresh,
      customAccessTokenClaims: () => ({}),
    });

    try {
      const failed = await exchangeStoredCode(isolatedAuth.handler, fixture);
      expect(failed.status).toBe(400);
      expect(await failed.json()).toMatchObject({ error: 'invalid_grant' });
      expect(refreshHashCalls).toBeGreaterThanOrEqual(2);
      await expect(
        db.select().from(verification).where(eq(verification.identifier, fixture.identifier)),
      ).resolves.toHaveLength(1);
      await expect(
        db
          .select()
          .from(oauthResourceGrant)
          .where(eq(oauthResourceGrant.clientId, fixture.clientId)),
      ).resolves.toHaveLength(0);
      await expect(
        db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, fixture.clientId)),
      ).resolves.toHaveLength(0);
    } finally {
      hashSpy.mockRestore();
    }

    const retried = await exchangeStoredCode(
      async (request) => (await import('../src/index')).auth.handler(request),
      fixture,
    );
    expect(retried.status, await retried.clone().text()).toBe(200);
  });

  it('preserves the first-in-time provider error while waiting for every token branch', async () => {
    const { db, verification } = await import('@docket/db');
    const fixture = await seedStoredAuthorizationCode('error-order');
    const accessStarted = deferred();
    const releaseAccess = deferred();
    const refreshRejected = deferred();
    const refreshError = new APIError('INTERNAL_SERVER_ERROR', {
      error: 'refresh_branch_failed_first',
      error_description: 'The refresh branch failed first.',
    });
    const accessError = new APIError('INTERNAL_SERVER_ERROR', {
      error: 'access_branch_failed_later',
      error_description: 'The access branch failed later.',
    });
    const isolatedAuth = isolatedProviderAuth({
      generateRefreshToken: () => {
        refreshRejected.resolve();
        throw refreshError;
      },
      customAccessTokenClaims: async () => {
        accessStarted.resolve();
        await releaseAccess.promise;
        throw accessError;
      },
    });

    const tokenBody = {
      grant_type: 'authorization_code',
      client_id: fixture.clientId,
      code: fixture.code,
      code_verifier: fixture.verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    } as const;
    const tokenRequest = new Request('http://localhost:4000/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenBody),
    });
    const tokenEndpoint = (
      isolatedAuth.api as unknown as Record<
        string,
        (input: Record<string, unknown>) => Promise<unknown>
      >
    )['oauth2Token'];
    if (!tokenEndpoint) throw new Error('The isolated provider did not expose oauth2Token.');

    let settled = false;
    const outcomePromise = tokenEndpoint({
      asResponse: false,
      body: tokenBody,
      headers: tokenRequest.headers,
      request: tokenRequest,
    })
      .then((response) => ({ response }))
      .catch((error: unknown) => ({ error }))
      .finally(() => {
        settled = true;
      });
    await Promise.all([accessStarted.promise, refreshRejected.promise]);
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseAccess.resolve();
    const outcome = await outcomePromise;

    expect(outcome).toEqual({ error: refreshError });
    await expect(
      db.select().from(verification).where(eq(verification.identifier, fixture.identifier)),
    ).resolves.toHaveLength(1);
  });
});
