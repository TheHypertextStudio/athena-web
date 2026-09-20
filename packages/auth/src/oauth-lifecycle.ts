/**
 * Docket-owned OAuth grant lifecycle operations that must remain atomic across API and provider
 * entry points.
 */
import { randomUUID } from 'node:crypto';

import {
  db,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthJwtRevocation,
  oauthRefreshToken,
  oauthResourceGrant,
  user,
  type Database,
} from '@docket/db';
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';

const LEGACY_ACCESS_LIFETIME_MS = 15 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 60 * 1000;

type OAuthTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

interface LegacyClientState {
  readonly clientId: string;
  readonly disabled: boolean | null;
  readonly skipConsent: boolean | null;
  readonly legacyBefore: Date | null;
  readonly legacyTrusted: boolean | null;
}

/** Inputs needed to materialize one bounded pre-cutover trusted MCP authorization. */
export interface TrustedLegacyGrantInput {
  readonly clientId: string;
  readonly userId: string;
  readonly issuedAtSeconds: number;
  readonly expiresAtSeconds: number;
  readonly mcpResource: string;
  readonly now?: Date;
}

/** Counts returned by one bounded OAuth maintenance pass. */
export interface OAuthLifecycleSweepResult {
  readonly jwtRevocationsDeleted: number;
  readonly grantsDeleted: number;
}

/** Return the last instant when a pre-cutover MCP authorization may remain observable. */
export function legacyGrantDeadline(cutoff: Date): Date {
  return new Date(cutoff.getTime() + LEGACY_ACCESS_LIFETIME_MS + CLOCK_TOLERANCE_MS);
}

async function lockedLegacyClient(
  transaction: OAuthTransaction,
  clientId: string,
): Promise<LegacyClientState | null> {
  const clients = await transaction
    .select({
      clientId: oauthClient.clientId,
      disabled: oauthClient.disabled,
      skipConsent: oauthClient.skipConsent,
      legacyBefore: oauthClient.docketLegacyBefore,
      legacyTrusted: oauthClient.docketLegacyTrusted,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .for('update');
  return clients.length === 1 ? (clients[0] ?? null) : null;
}

function acceptsLegacyToken(
  client: LegacyClientState,
  input: TrustedLegacyGrantInput,
  now: Date,
): client is LegacyClientState & { readonly legacyBefore: Date } {
  if (client.disabled || !client.skipConsent || !client.legacyTrusted || !client.legacyBefore) {
    return false;
  }
  const cutoffSeconds = Math.floor(client.legacyBefore.getTime() / 1000);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return ![
    input.issuedAtSeconds > cutoffSeconds,
    input.expiresAtSeconds <= input.issuedAtSeconds,
    input.expiresAtSeconds - input.issuedAtSeconds > 15 * 60,
    input.expiresAtSeconds <= nowSeconds,
    legacyGrantDeadline(client.legacyBefore).getTime() <= now.getTime(),
  ].includes(true);
}

async function legacyGrantRows(
  transaction: OAuthTransaction,
  input: TrustedLegacyGrantInput,
): Promise<readonly { readonly id: string }[]> {
  return transaction
    .select({ id: oauthResourceGrant.id })
    .from(oauthResourceGrant)
    .where(
      and(
        eq(oauthResourceGrant.clientId, input.clientId),
        eq(oauthResourceGrant.userId, input.userId),
        isNotNull(oauthResourceGrant.legacyBefore),
      ),
    )
    .limit(2);
}

async function legacyPairHasAuthorityRows(
  transaction: OAuthTransaction,
  input: TrustedLegacyGrantInput,
): Promise<boolean> {
  const [users, consents, refreshes] = await Promise.all([
    transaction.select({ id: user.id }).from(user).where(eq(user.id, input.userId)).limit(1),
    transaction
      .select({ id: oauthConsent.id })
      .from(oauthConsent)
      .where(and(eq(oauthConsent.clientId, input.clientId), eq(oauthConsent.userId, input.userId)))
      .limit(1),
    transaction
      .select({ id: oauthRefreshToken.id })
      .from(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.clientId, input.clientId),
          eq(oauthRefreshToken.userId, input.userId),
        ),
      )
      .limit(1),
  ]);
  return users.length !== 1 || consents.length > 0 || refreshes.length > 0;
}

async function createLegacyGrant(
  transaction: OAuthTransaction,
  input: TrustedLegacyGrantInput,
  client: LegacyClientState & { readonly legacyBefore: Date },
  now: Date,
): Promise<void> {
  await transaction
    .insert(oauthResourceGrant)
    .values({
      id: randomUUID(),
      clientId: input.clientId,
      userId: input.userId,
      consentId: null,
      authorizationKind: 'trusted_mcp',
      resourceUri: input.mcpResource,
      createdAt: now,
      expiresAt: legacyGrantDeadline(client.legacyBefore),
      revokedAt: null,
      legacyBefore: client.legacyBefore,
    })
    .onConflictDoNothing();
}

/**
 * Create or read the one trusted MCP legacy grant for an eligible pre-cutover token.
 *
 * The client row lock serializes first use with connected-app revocation. A concurrent revocation
 * creates a revoked tombstone, and this function only reads that row; it never clears revocation.
 */
export async function ensureTrustedLegacyMcpGrant(
  input: TrustedLegacyGrantInput,
): Promise<string | null> {
  const now = input.now ?? new Date();
  return db.transaction(async (transaction) => {
    const client = await lockedLegacyClient(transaction, input.clientId);
    if (!client || !acceptsLegacyToken(client, input, now)) return null;
    const existing = await legacyGrantRows(transaction, input);
    if (existing.length === 1) return existing[0]?.id ?? null;
    /* v8 ignore next -- the grant identity has a database uniqueness constraint */
    if (existing.length > 1) return null;
    if (await legacyPairHasAuthorityRows(transaction, input)) return null;
    await createLegacyGrant(transaction, input, client, now);
    const rows = await legacyGrantRows(transaction, input);
    return rows.length === 1 ? (rows[0]?.id ?? null) : null;
  });
}

/**
 * Revoke one user's complete relationship with an OAuth client in one transaction.
 *
 * Missing relationships remain a successful no-op. A migrated trusted client receives a bounded
 * revoked tombstone when its claimless-token compatibility window is still open.
 */
export async function revokeConnectedOAuthClient(
  userId: string,
  clientId: string,
  now?: Date,
): Promise<void> {
  await db.transaction(async (transaction) => {
    const clients = await transaction
      .select({
        skipConsent: oauthClient.skipConsent,
        legacyBefore: oauthClient.docketLegacyBefore,
        legacyTrusted: oauthClient.docketLegacyTrusted,
      })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .for('update');
    const client = clients[0];
    if (clients.length !== 1 || !client) return;
    const revokedAt = now ?? new Date();

    await transaction
      .update(oauthResourceGrant)
      .set({ revokedAt })
      .where(and(eq(oauthResourceGrant.clientId, clientId), eq(oauthResourceGrant.userId, userId)));

    await transaction
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)));
    await transaction
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)));
    await transaction
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));

    if (client.legacyTrusted && client.legacyBefore !== null) {
      const deadline = legacyGrantDeadline(client.legacyBefore);
      const legacyRows = await transaction
        .select({ id: oauthResourceGrant.id })
        .from(oauthResourceGrant)
        .where(
          and(
            eq(oauthResourceGrant.clientId, clientId),
            eq(oauthResourceGrant.userId, userId),
            isNotNull(oauthResourceGrant.legacyBefore),
          ),
        )
        .limit(1);
      if (legacyRows.length === 0 && deadline.getTime() > revokedAt.getTime()) {
        await transaction
          .insert(oauthResourceGrant)
          .values({
            id: randomUUID(),
            clientId,
            userId,
            consentId: null,
            authorizationKind: 'trusted_mcp',
            resourceUri: null,
            createdAt: revokedAt,
            expiresAt: deadline,
            revokedAt,
            legacyBefore: client.legacyBefore,
          })
          .onConflictDoNothing();
      }
    }
  });
}

/** Delete at most `limit` expired rows from each OAuth lifecycle table in one maintenance pass. */
export async function sweepOAuthLifecycle(
  now: Date = new Date(),
  limit = 100,
): Promise<OAuthLifecycleSweepResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError('OAuth lifecycle sweep limit must be between 1 and 1000.');
  }
  return db.transaction(async (transaction) => {
    const jwtRows = await transaction
      .select({ tokenDigest: oauthJwtRevocation.tokenDigest })
      .from(oauthJwtRevocation)
      .where(lte(oauthJwtRevocation.expiresAt, now))
      .orderBy(asc(oauthJwtRevocation.expiresAt), asc(oauthJwtRevocation.tokenDigest))
      .limit(limit)
      .for('update', { skipLocked: true });
    const grantRows = await transaction
      .select({ id: oauthResourceGrant.id })
      .from(oauthResourceGrant)
      .where(lte(oauthResourceGrant.expiresAt, now))
      .orderBy(asc(oauthResourceGrant.expiresAt), asc(oauthResourceGrant.id))
      .limit(limit)
      .for('update', { skipLocked: true });

    const deletedJwt =
      jwtRows.length === 0
        ? []
        : await transaction
            .delete(oauthJwtRevocation)
            .where(
              and(
                inArray(
                  oauthJwtRevocation.tokenDigest,
                  jwtRows.map((row) => row.tokenDigest),
                ),
                lte(oauthJwtRevocation.expiresAt, now),
              ),
            )
            .returning({ tokenDigest: oauthJwtRevocation.tokenDigest });
    const deletedGrants =
      grantRows.length === 0
        ? []
        : await transaction
            .delete(oauthResourceGrant)
            .where(
              and(
                inArray(
                  oauthResourceGrant.id,
                  grantRows.map((row) => row.id),
                ),
                lte(oauthResourceGrant.expiresAt, now),
              ),
            )
            .returning({ id: oauthResourceGrant.id });

    return {
      jwtRevocationsDeleted: deletedJwt.length,
      grantsDeleted: deletedGrants.length,
    };
  });
}
