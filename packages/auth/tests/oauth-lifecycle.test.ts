import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  db,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthJwtRevocation,
  oauthRefreshToken,
  oauthResourceGrant,
  user,
} from '@docket/db';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ensureTrustedLegacyMcpGrant,
  legacyGrantDeadline,
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
  input: {
    readonly skipConsent?: boolean;
    readonly legacyBefore?: Date;
  } = {},
): Promise<string> {
  const clientId = `client_${randomUUID()}`;
  await db.insert(oauthClient).values({
    id: `row_${randomUUID()}`,
    clientId,
    name: 'Lifecycle client',
    redirectUris: ['https://client.example.test/callback'],
    scopes: ['work:read', 'offline_access'],
    skipConsent: input.skipConsent ?? false,
    docketLegacyBefore: input.legacyBefore ?? null,
    docketLegacyTrusted: input.legacyBefore ? (input.skipConsent ?? false) : false,
  });
  return clientId;
}

describe('OAuth lifecycle', () => {
  it('rejects invalid sweep limits before opening a transaction', async () => {
    for (const limit of [0, -1, 1_001, 1.5, Number.NaN]) {
      await expect(sweepOAuthLifecycle(new Date(), limit)).rejects.toThrow(
        'OAuth lifecycle sweep limit must be between 1 and 1000.',
      );
    }
  });

  it('treats missing client relationships as revocation no-ops', async () => {
    await expect(
      revokeConnectedOAuthClient('missing-user', 'missing-client', new Date()),
    ).resolves.toBeUndefined();
  });

  it('does not materialize a legacy grant over an existing consent relationship', async () => {
    const cutoff = new Date('2026-09-12T12:00:00.000Z');
    const now = new Date('2026-09-12T12:05:00.000Z');
    const userId = await seedUser('Consented legacy user');
    const clientId = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    await db.insert(oauthConsent).values({
      id: `consent_${randomUUID()}`,
      clientId,
      userId,
      scopes: ['work:read'],
      createdAt: now,
    });
    await expect(
      ensureTrustedLegacyMcpGrant({
        clientId,
        userId,
        issuedAtSeconds: Math.floor(cutoff.getTime() / 1000),
        expiresAtSeconds: Math.floor(now.getTime() / 1000) + 300,
        mcpResource: MCP,
        now,
      }),
    ).resolves.toBeNull();
  });

  it('materializes one eligible trusted legacy grant and never clears its revocation tombstone', async () => {
    const cutoff = new Date('2026-09-12T12:00:00.000Z');
    const now = new Date('2026-09-12T12:05:00.000Z');
    const userId = await seedUser('Legacy user');
    const clientId = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    const input = {
      clientId,
      userId,
      issuedAtSeconds: Math.floor(cutoff.getTime() / 1000),
      expiresAtSeconds: Math.floor(now.getTime() / 1000) + 300,
      mcpResource: MCP,
      now,
    };

    const first = await ensureTrustedLegacyMcpGrant(input);
    const second = await ensureTrustedLegacyMcpGrant(input);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    if (!first) throw new Error('Expected a trusted legacy grant.');

    await revokeConnectedOAuthClient(userId, clientId, new Date(now.getTime() + 1_000));
    await expect(ensureTrustedLegacyMcpGrant(input)).resolves.toBe(first);
    const rows = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, first));
    expect(rows[0]?.revokedAt).toEqual(new Date(now.getTime() + 1_000));
  });

  it('retains legacy authority through the 15-minute window plus clock tolerance only', async () => {
    const cutoff = new Date('2026-09-12T12:00:00.000Z');
    const deadline = new Date('2026-09-12T12:16:00.000Z');
    const userId = await seedUser('Legacy deadline user');
    const clientId = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    const grantId = await ensureTrustedLegacyMcpGrant({
      clientId,
      userId,
      issuedAtSeconds: Math.floor(cutoff.getTime() / 1000),
      expiresAtSeconds: Math.floor(cutoff.getTime() / 1000) + 15 * 60,
      mcpResource: MCP,
      now: new Date(cutoff.getTime() + 5 * 60 * 1000),
    });
    if (!grantId) throw new Error('Expected a bounded trusted legacy grant.');

    expect(legacyGrantDeadline(cutoff)).toEqual(deadline);
    const [stored] = await db
      .select({ expiresAt: oauthResourceGrant.expiresAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, grantId));
    expect(stored?.expiresAt).toEqual(deadline);

    await sweepOAuthLifecycle(new Date(deadline.getTime() - 1), 1_000);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.id, grantId)),
    ).resolves.toHaveLength(1);
    await sweepOAuthLifecycle(deadline, 1_000);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.id, grantId)),
    ).resolves.toHaveLength(0);
  });

  it('revokes one user and client atomically without changing another user', async () => {
    const now = new Date('2026-09-12T12:00:00.000Z');
    const userA = await seedUser('User A');
    const userB = await seedUser('User B');
    const clientId = await seedClient();
    const consentA = `consent_${randomUUID()}`;
    const consentB = `consent_${randomUUID()}`;
    await db.insert(oauthConsent).values([
      { id: consentA, clientId, userId: userA, scopes: ['work:read', 'offline_access'] },
      { id: consentB, clientId, userId: userB, scopes: ['work:read', 'offline_access'] },
    ]);
    const grantA = `grant_${randomUUID()}`;
    const grantB = `grant_${randomUUID()}`;
    await db.insert(oauthResourceGrant).values([
      {
        id: grantA,
        clientId,
        userId: userA,
        consentId: consentA,
        authorizationKind: 'consent',
        resourceUri: MCP,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
      },
      {
        id: grantB,
        clientId,
        userId: userB,
        consentId: consentB,
        authorizationKind: 'consent',
        resourceUri: MCP,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
      },
    ]);
    await db.insert(oauthRefreshToken).values([
      {
        id: `refresh_${randomUUID()}`,
        token: `digest_${randomUUID()}`,
        clientId,
        userId: userA,
        scopes: ['work:read', 'offline_access'],
        docketGrantId: grantA,
      },
      {
        id: `refresh_${randomUUID()}`,
        token: `digest_${randomUUID()}`,
        clientId,
        userId: userB,
        scopes: ['work:read', 'offline_access'],
        docketGrantId: grantB,
      },
    ]);
    await db.insert(oauthAccessToken).values([
      {
        id: `access_${randomUUID()}`,
        token: `access-token-${randomUUID()}`,
        clientId,
        userId: userA,
        scopes: ['work:read'],
      },
      {
        id: `access_${randomUUID()}`,
        token: `access-token-${randomUUID()}`,
        clientId,
        userId: userB,
        scopes: ['work:read'],
      },
    ]);

    await revokeConnectedOAuthClient(userA, clientId, new Date(now.getTime() + 1_000));

    await expect(
      db.select().from(oauthConsent).where(eq(oauthConsent.id, consentA)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.id, grantA)),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select()
        .from(oauthRefreshToken)
        .where(and(eq(oauthRefreshToken.clientId, clientId), eq(oauthRefreshToken.userId, userA))),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthConsent).where(eq(oauthConsent.id, consentB)),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.id, grantB)),
    ).resolves.toHaveLength(1);
  });

  it('cascades an expired grant sweep through refresh and opaque access descendants', async () => {
    const now = new Date('2026-09-12T12:00:00.000Z');
    const userId = await seedUser('Grant cascade user');
    const clientId = await seedClient({ skipConsent: true });
    const grantId = `cascade-grant-${randomUUID()}`;
    const refreshId = `cascade-refresh-${randomUUID()}`;
    const accessId = `cascade-access-${randomUUID()}`;
    await db.insert(oauthResourceGrant).values({
      id: grantId,
      clientId,
      userId,
      consentId: null,
      authorizationKind: 'trusted_mcp',
      resourceUri: MCP,
      createdAt: new Date(0),
      expiresAt: new Date(1_000),
    });
    await db.insert(oauthRefreshToken).values({
      id: refreshId,
      token: `cascade-refresh-digest-${randomUUID()}`,
      clientId,
      userId,
      scopes: ['work:read', 'offline_access'],
      expiresAt: new Date(now.getTime() + 60_000),
      docketGrantId: grantId,
    });
    await db.insert(oauthAccessToken).values({
      id: accessId,
      token: `cascade-access-token-${randomUUID()}`,
      clientId,
      userId,
      refreshId,
      scopes: ['work:read'],
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await sweepOAuthLifecycle(now, 1_000);

    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.id, grantId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.id, refreshId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthAccessToken).where(eq(oauthAccessToken.id, accessId)),
    ).resolves.toHaveLength(0);
  });

  it('keeps a revoked trusted tombstone when legacy consent deletion cascades its grant', async () => {
    const cutoff = new Date('2026-09-12T12:00:00.000Z');
    const now = new Date('2026-09-12T12:05:00.000Z');
    const userId = await seedUser('Migrated trusted user');
    const clientId = await seedClient({ skipConsent: true, legacyBefore: cutoff });
    const consentId = `consent_${randomUUID()}`;
    const grantId = `grant_${randomUUID()}`;
    await db.insert(oauthConsent).values({
      id: consentId,
      clientId,
      userId,
      scopes: ['work:read', 'offline_access'],
    });
    await db.insert(oauthResourceGrant).values({
      id: grantId,
      clientId,
      userId,
      consentId,
      authorizationKind: 'consent',
      resourceUri: null,
      createdAt: cutoff,
      expiresAt: new Date(cutoff.getTime() + 30 * 24 * 60 * 60 * 1000),
      legacyBefore: cutoff,
    });
    await db.insert(oauthRefreshToken).values({
      id: `refresh_${randomUUID()}`,
      token: `digest_${randomUUID()}`,
      clientId,
      userId,
      scopes: ['work:read', 'offline_access'],
      docketGrantId: grantId,
      expiresAt: new Date(cutoff.getTime() + 24 * 60 * 60 * 1000),
    });

    await revokeConnectedOAuthClient(userId, clientId, now);

    await expect(
      db.select().from(oauthConsent).where(eq(oauthConsent.id, consentId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.docketGrantId, grantId)),
    ).resolves.toHaveLength(0);
    const tombstones = await db
      .select({
        authorizationKind: oauthResourceGrant.authorizationKind,
        revokedAt: oauthResourceGrant.revokedAt,
      })
      .from(oauthResourceGrant)
      .where(and(eq(oauthResourceGrant.clientId, clientId), eq(oauthResourceGrant.userId, userId)));
    expect(tombstones).toEqual([{ authorizationKind: 'trusted_mcp', revokedAt: now }]);
  });

  it('never reclassifies an ordinary legacy client as trusted after connected-app revocation', async () => {
    const cutoff = new Date('2026-09-12T12:00:00.000Z');
    const now = new Date('2026-09-12T12:05:00.000Z');
    const userId = await seedUser('Ordinary legacy user');
    const clientId = await seedClient({ skipConsent: false, legacyBefore: cutoff });

    await revokeConnectedOAuthClient(userId, clientId, now);
    await db
      .update(oauthClient)
      .set({ skipConsent: true })
      .where(eq(oauthClient.clientId, clientId));

    await expect(
      ensureTrustedLegacyMcpGrant({
        clientId,
        userId,
        issuedAtSeconds: Math.floor(cutoff.getTime() / 1000) - 30,
        expiresAtSeconds: Math.floor(now.getTime() / 1000) + 300,
        mcpResource: MCP,
        now,
      }),
    ).resolves.toBeNull();
    await expect(
      db
        .select()
        .from(oauthResourceGrant)
        .where(
          and(eq(oauthResourceGrant.clientId, clientId), eq(oauthResourceGrant.userId, userId)),
        ),
    ).resolves.toHaveLength(0);
  });

  it('deletes bounded expired rows while retaining future denylist and grant state', async () => {
    const now = new Date('2026-09-12T12:00:00.000Z');
    const userId = await seedUser('Sweep user');
    const clientId = await seedClient({ skipConsent: true });
    const digests = ['A'.repeat(43), 'B'.repeat(43), 'C'.repeat(43)] as const;
    const grantIds = [
      `expired_${randomUUID()}`,
      `expired_${randomUUID()}`,
      `future_${randomUUID()}`,
    ] as const;
    await db.insert(oauthJwtRevocation).values([
      { tokenDigest: digests[0], revokedAt: new Date(0), expiresAt: new Date(1_000) },
      { tokenDigest: digests[1], revokedAt: new Date(0), expiresAt: new Date(2_000) },
      { tokenDigest: digests[2], revokedAt: now, expiresAt: new Date(now.getTime() + 60_000) },
    ]);
    await db.insert(oauthResourceGrant).values([
      {
        id: grantIds[0],
        clientId,
        userId,
        consentId: null,
        authorizationKind: 'trusted_mcp',
        resourceUri: MCP,
        createdAt: new Date(0),
        expiresAt: new Date(1_000),
      },
      {
        id: grantIds[1],
        clientId,
        userId,
        consentId: null,
        authorizationKind: 'trusted_mcp',
        resourceUri: MCP,
        createdAt: new Date(0),
        expiresAt: new Date(2_000),
      },
      {
        id: grantIds[2],
        clientId,
        userId,
        consentId: null,
        authorizationKind: 'trusted_mcp',
        resourceUri: MCP,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);

    await expect(sweepOAuthLifecycle(now, 1)).resolves.toEqual({
      jwtRevocationsDeleted: 1,
      grantsDeleted: 1,
    });
    await expect(
      db
        .select()
        .from(oauthJwtRevocation)
        .where(inArray(oauthJwtRevocation.tokenDigest, [...digests])),
    ).resolves.toHaveLength(2);
    await expect(
      db
        .select()
        .from(oauthResourceGrant)
        .where(inArray(oauthResourceGrant.id, [...grantIds])),
    ).resolves.toHaveLength(2);
  });
});
