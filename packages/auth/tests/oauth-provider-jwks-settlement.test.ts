import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  deferred,
  exchangeStoredCode,
  isolatedProviderAuth,
  seedStoredAuthorizationCode,
} from './oauth-provider-handler.support';

async function assertJwksBranchSettlement(mode: 'cold' | 'expired'): Promise<void> {
  const {
    db,
    jwks,
    oauthRefreshToken,
    oauthResourceGrant,
    setDatabaseQueryObserver,
    verification,
  } = await import('@docket/db');
  const isolatedAuth = isolatedProviderAuth({
    generateRefreshToken: async () => `jwks-settlement-refresh-${crypto.randomUUID()}`,
    customAccessTokenClaims: () => ({}),
  });

  await db.delete(jwks);
  if (mode === 'expired') {
    const warm = await seedStoredAuthorizationCode('jwks-expired-warmup');
    const response = await exchangeStoredCode(isolatedAuth.handler, warm);
    expect(response.status, await response.clone().text()).toBe(200);
    await db.update(jwks).set({ expiresAt: new Date(Date.now() - 1_000) });
  }
  const fixture = await seedStoredAuthorizationCode(`jwks-${mode}-failure`);
  const keyStarted = deferred();
  const releaseKey = deferred();
  const refreshFailed = deferred();
  const persistenceError = new Error(`Injected ${mode} refresh persistence failure.`);
  let settled = false;
  let jwksInsertAfterSettlement = false;
  const originalGenerateKey = globalThis.crypto.subtle.generateKey.bind(globalThis.crypto.subtle);
  const generateKeySpy = vi
    .spyOn(globalThis.crypto.subtle, 'generateKey')
    .mockImplementation(async (...args) => {
      keyStarted.resolve();
      await releaseKey.promise;
      return originalGenerateKey(...args);
    });
  setDatabaseQueryObserver((query) => {
    const normalized = query.toLowerCase();
    if (normalized.includes('insert into "oauth_refresh_token"')) {
      refreshFailed.resolve();
      throw persistenceError;
    }
    if (normalized.includes('insert into "jwks"') && settled) {
      jwksInsertAfterSettlement = true;
    }
  });

  try {
    const responsePromise = exchangeStoredCode(isolatedAuth.handler, fixture).finally(() => {
      settled = true;
    });
    await Promise.all([keyStarted.promise, refreshFailed.promise]);
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseKey.resolve();
    const response = await responsePromise;
    expect(response.status).toBe(500);
    expect(jwksInsertAfterSettlement).toBe(false);
  } finally {
    generateKeySpy.mockRestore();
    setDatabaseQueryObserver(undefined);
  }

  await expect(
    db.select().from(verification).where(eq(verification.identifier, fixture.identifier)),
  ).resolves.toHaveLength(1);
  await expect(
    db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, fixture.clientId)),
  ).resolves.toHaveLength(0);
  await expect(
    db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, fixture.clientId)),
  ).resolves.toHaveLength(0);
  await expect(db.select().from(jwks)).resolves.toHaveLength(mode === 'cold' ? 0 : 1);
}

describe('patched OAuth provider JWKS branch settlement', () => {
  it('keeps the transaction open while cold-key creation outlives refresh failure', async () => {
    await assertJwksBranchSettlement('cold');
  });

  it('keeps the transaction open while expired-key rotation outlives refresh failure', async () => {
    await assertJwksBranchSettlement('expired');
  });
});
