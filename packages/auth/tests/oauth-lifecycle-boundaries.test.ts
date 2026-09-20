import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { db, oauthClient, oauthConsent, oauthRefreshToken, user } from '@docket/db';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ensureTrustedLegacyMcpGrant,
  revokeConnectedOAuthClient,
  sweepOAuthLifecycle,
} from '../src/oauth-lifecycle';

const MCP = 'https://api.clearthedocket.com/mcp';

beforeAll(async () => {
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
  });
});

async function seedUser(label: string): Promise<string> {
  const id = `user_${randomUUID()}`;
  await db.insert(user).values({ id, name: label, email: `${id}@example.test` });
  return id;
}

async function seedClient(
  input: { readonly skipConsent?: boolean; readonly legacyBefore?: Date } = {},
): Promise<string> {
  const clientId = `client_${randomUUID()}`;
  await db.insert(oauthClient).values({
    id: `row_${randomUUID()}`,
    clientId,
    name: 'Lifecycle boundary client',
    redirectUris: ['https://client.example.test/callback'],
    scopes: ['work:read', 'offline_access'],
    skipConsent: input.skipConsent ?? false,
    docketLegacyBefore: input.legacyBefore ?? null,
    docketLegacyTrusted: input.legacyBefore ? (input.skipConsent ?? false) : false,
  });
  return clientId;
}

describe('OAuth lifecycle boundaries', () => {
  it.each([
    ['disabled client', { disabled: true }, {}],
    ['non-skip-consent client', { skipConsent: false }, {}],
    ['untrusted legacy client', { docketLegacyTrusted: false }, {}],
    ['missing cutoff', { docketLegacyBefore: null }, {}],
    ['issuance after cutoff', {}, { issuedAtSeconds: 1_000_001 }],
    ['nonpositive lifetime', {}, { issuedAtSeconds: 999_999, expiresAtSeconds: 999_999 }],
    ['lifetime over fifteen minutes', {}, { issuedAtSeconds: 999_000, expiresAtSeconds: 999_901 }],
    ['expired token', {}, { expiresAtSeconds: 999_999 }],
    ['closed compatibility window', {}, { now: new Date((1_000_000 + 16 * 60) * 1_000) }],
  ])('rejects an ineligible trusted legacy grant for a %s', async (_label, clientPatch, patch) => {
    const cutoff = new Date(1_000_000 * 1_000);
    const now = new Date((1_000_000 + 60) * 1_000);
    const userId = await seedUser(`Rejected legacy ${_label}`);
    const clientId = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    if (Object.keys(clientPatch).length > 0) {
      await db.update(oauthClient).set(clientPatch).where(eq(oauthClient.clientId, clientId));
    }

    await expect(
      ensureTrustedLegacyMcpGrant({
        clientId,
        userId,
        issuedAtSeconds: 999_999,
        expiresAtSeconds: 1_000_300,
        mcpResource: MCP,
        now,
        ...patch,
      }),
    ).resolves.toBeNull();
  });

  it('rejects legacy materialization for missing or conflicting authority rows', async () => {
    const cutoff = new Date(Date.now() + 60_000);
    const input = {
      issuedAtSeconds: Math.floor(Date.now() / 1_000),
      expiresAtSeconds: Math.floor(Date.now() / 1_000) + 30,
      mcpResource: MCP,
    };
    await expect(
      ensureTrustedLegacyMcpGrant({
        ...input,
        clientId: `missing_${randomUUID()}`,
        userId: `missing_${randomUUID()}`,
      }),
    ).resolves.toBeNull();

    const clientWithMissingUser = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    await expect(
      ensureTrustedLegacyMcpGrant({
        ...input,
        clientId: clientWithMissingUser,
        userId: `missing_${randomUUID()}`,
      }),
    ).resolves.toBeNull();

    const consentUser = await seedUser('Legacy consent authority');
    const consentClient = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    await db.insert(oauthConsent).values({
      id: `consent_${randomUUID()}`,
      clientId: consentClient,
      userId: consentUser,
      scopes: ['work:read'],
    });
    await expect(
      ensureTrustedLegacyMcpGrant({ ...input, clientId: consentClient, userId: consentUser }),
    ).resolves.toBeNull();

    const refreshUser = await seedUser('Legacy refresh authority');
    const refreshClient = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    await db.insert(oauthRefreshToken).values({
      id: `refresh_${randomUUID()}`,
      token: `digest_${randomUUID()}`,
      clientId: refreshClient,
      userId: refreshUser,
      scopes: ['work:read'],
    });
    await expect(
      ensureTrustedLegacyMcpGrant({ ...input, clientId: refreshClient, userId: refreshUser }),
    ).resolves.toBeNull();
  });

  it('treats revocation of a missing relationship as a no-op', async () => {
    await expect(
      revokeConnectedOAuthClient(`missing_${randomUUID()}`, `missing_${randomUUID()}`),
    ).resolves.toBeUndefined();

    const userId = await seedUser('Default revocation clock');
    const clientId = await seedClient();
    await expect(revokeConnectedOAuthClient(userId, clientId)).resolves.toBeUndefined();
  });

  it.each([0, -1, 1.5, 1_001, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid lifecycle sweep limit (%s)',
    async (limit) => {
      await expect(sweepOAuthLifecycle(new Date(), limit)).rejects.toThrow(RangeError);
    },
  );

  it('returns zero counts when a sweep finds no expired rows', async () => {
    await expect(sweepOAuthLifecycle(new Date(-1), 1)).resolves.toEqual({
      jwtRevocationsDeleted: 0,
      grantsDeleted: 0,
    });
  });
});
