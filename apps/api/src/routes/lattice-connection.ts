/**
 * `@docket/api` — loading, sealing and refreshing one person's Lovelace Lattice grant.
 *
 * @remarks
 * Everything that touches the `lattice_connection` / `lattice_credential` pair lives here so the
 * REST surface, the OAuth callback and the agent loop all read the grant through one code path.
 * That matters because the interesting logic — refresh a nearly-expired token, and *persist* the
 * refreshed one — is easy to get subtly wrong twice if it is written twice.
 *
 * Two rules hold everywhere below:
 *
 * 1. **Owner-matched or nothing.** Every query is keyed by `ownerUserId`. There is no code path
 *    that loads a connection by id alone.
 * 2. **Codes, never provider prose.** Failures resolve to a `LatticeUnavailableReason`, which the
 *    web layer owns copy for. An issuer's `error_description` is recorded for operators only.
 */
import { db, latticeConnection, latticeCredential } from '@docket/db';
import {
  LatticeUnavailableError,
  LOVELACE_ACCOUNTS_ISSUER,
  latticeCredentialNeedsRefresh,
  parseLatticeCredential,
  refreshLatticeCredential,
  type LatticeCredentialRecord,
  type LatticeGatewayContext,
  type LatticeOAuthClientConfig,
  type LatticeUnavailableReason,
  type StoredLatticeCredential,
} from '@docket/integrations';
import { and, eq } from 'drizzle-orm';

import { credentialSealingConfigured } from '../lib/credentials';

import { env } from '../env';
import { sealCredential, unsealCredential } from '../lib/credentials';

/** A stored Lattice connection row. */
export type LatticeConnectionRow = typeof latticeConnection.$inferSelect;

/**
 * Whether this deployment can offer Lattice at all.
 *
 * @remarks
 * Without a registered OAuth client there is no consent screen to send anyone to, so the settings
 * surface must render "unavailable" rather than a Connect button that dead-ends.
 *
 * @returns True when a Lovelace OAuth client id is configured.
 */
export function latticeConfigured(): boolean {
  const hasClientId =
    typeof env.LATTICE_CLIENT_ID === 'string' && env.LATTICE_CLIENT_ID.trim().length > 0;
  // Starting a flow stores a sealed PKCE verifier, so a deployment without a
  // sealing key cannot offer Lattice however complete its OAuth client is.
  return hasClientId && credentialSealingConfigured();
}

/** The callback Lovelace returns the browser to; must match the registered redirect URI. */
export function latticeRedirectUri(): string {
  return `${env.API_URL}/internal/integrations/lattice/callback`;
}

/**
 * Build the OAuth client config for this deployment.
 *
 * @returns The issuer, client identity and redirect URI to run a flow with.
 * @throws {LatticeUnavailableError} With reason `not_connected` when no client id is configured.
 */
export function latticeOAuthConfig(): LatticeOAuthClientConfig {
  const clientId = env.LATTICE_CLIENT_ID;
  if (!clientId) {
    throw new LatticeUnavailableError('not_connected', 'LATTICE_CLIENT_ID is not configured');
  }
  return {
    issuer: env.LATTICE_ACCOUNTS_ISSUER ?? LOVELACE_ACCOUNTS_ISSUER,
    clientId,
    ...(env.LATTICE_CLIENT_SECRET ? { clientSecret: env.LATTICE_CLIENT_SECRET } : {}),
    redirectUri: latticeRedirectUri(),
  };
}

/**
 * Load one person's connection row.
 *
 * @param ownerUserId - The authenticated Better Auth user.
 * @returns Their connection, or `null` when they have never connected.
 */
export async function loadLatticeConnection(
  ownerUserId: string,
): Promise<LatticeConnectionRow | null> {
  const [row] = await db
    .select()
    .from(latticeConnection)
    .where(eq(latticeConnection.ownerUserId, ownerUserId))
    .limit(1);
  return row ?? null;
}

/**
 * Record a failure against a connection using a stable code.
 *
 * @remarks
 * `authorization_expired` and `insufficient_scopes` also flip `status` to `error` and switch the
 * connection off, because both mean every subsequent turn would fail the same way. A merely
 * sleeping laptop (`device_offline`) is recorded but left enabled — the person will wake it, and
 * silently disconnecting them for closing a lid would be worse than useless.
 *
 * @param ownerUserId - The connection's owner.
 * @param reason - The stable reason code.
 */
export async function recordLatticeFailure(
  ownerUserId: string,
  reason: LatticeUnavailableReason,
): Promise<void> {
  const terminal = reason === 'authorization_expired' || reason === 'insufficient_scopes';
  await db
    .update(latticeConnection)
    .set({
      lastFailureReason: reason,
      lastFailureAt: new Date(),
      ...(terminal ? { status: 'error' as const, enabled: false } : {}),
    })
    .where(eq(latticeConnection.ownerUserId, ownerUserId));
}

/** Persist a credential record against an owner-matched connection. */
export async function storeLatticeCredential(
  connectionId: string,
  ownerUserId: string,
  credential: unknown,
): Promise<void> {
  const ciphertext = sealCredential(JSON.stringify(credential));
  const [existing] = await db
    .select({ id: latticeCredential.id })
    .from(latticeCredential)
    .where(
      and(
        eq(latticeCredential.connectionId, connectionId),
        eq(latticeCredential.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(latticeCredential)
      .set({ ciphertext })
      .where(eq(latticeCredential.id, existing.id));
    return;
  }
  await db.insert(latticeCredential).values({ connectionId, ownerUserId, ciphertext });
}

/**
 * Load whatever credential is sealed against an owner-matched connection.
 *
 * @remarks
 * Returns the pending PKCE state as readily as an approved grant, because the OAuth callback has
 * to be able to tell the two apart: a pending kind means "complete this exchange", an approved
 * kind means "this is a replay, do nothing".
 *
 * @param connectionId - The connection the credential belongs to.
 * @param ownerUserId - The connection's owner.
 * @returns The stored credential, or `null` when there is none.
 */
export async function loadStoredLatticeCredential(
  connectionId: string,
  ownerUserId: string,
): Promise<StoredLatticeCredential | null> {
  const [row] = await db
    .select({ ciphertext: latticeCredential.ciphertext })
    .from(latticeCredential)
    .where(
      and(
        eq(latticeCredential.connectionId, connectionId),
        eq(latticeCredential.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  return row?.ciphertext ? parseLatticeCredential(unsealCredential(row.ciphertext)) : null;
}

/**
 * Load the person's approved credential, refreshing it first when it is near expiry.
 *
 * @remarks
 * The refreshed credential is written back before it is returned. Skipping that write is the
 * classic version of this bug: every turn would refresh, the issuer would rotate the refresh token
 * each time, and the stored one would go stale within a request or two.
 *
 * @param connection - The owner-matched connection row.
 * @returns The usable credential.
 * @throws {LatticeUnavailableError} `not_connected` when there is no approved grant, or
 * `authorization_expired` when the refresh is refused.
 */
export async function loadUsableLatticeCredential(
  connection: LatticeConnectionRow,
): Promise<LatticeCredentialRecord> {
  const parsed = await loadStoredLatticeCredential(connection.id, connection.ownerUserId);
  if (parsed?.kind !== 'lattice_oauth') {
    throw new LatticeUnavailableError('not_connected', 'no approved Lattice grant is stored');
  }
  if (!latticeCredentialNeedsRefresh(parsed)) return parsed;

  try {
    const refreshed = await refreshLatticeCredential(latticeOAuthConfig(), parsed);
    await storeLatticeCredential(connection.id, connection.ownerUserId, refreshed);
    return refreshed;
  } catch (cause) {
    if (cause instanceof LatticeUnavailableError) throw cause;
    // Any refusal at the token endpoint means this grant will not work again; only re-consent
    // can fix it, so that is what the person is told.
    throw new LatticeUnavailableError(
      'authorization_expired',
      cause instanceof Error ? cause.message : 'Lattice token refresh failed',
    );
  }
}

/**
 * Build the gateway context for one person.
 *
 * @param connection - The owner-matched connection row.
 * @returns The access token and gateway target to call with.
 * @throws {LatticeUnavailableError} When no usable grant exists.
 */
export async function latticeGatewayContext(
  connection: LatticeConnectionRow,
): Promise<LatticeGatewayContext> {
  const credential = await loadUsableLatticeCredential(connection);
  return {
    accessToken: credential.accessToken,
    ...(env.LATTICE_GATEWAY_URL ? { baseUrl: env.LATTICE_GATEWAY_URL } : {}),
  };
}
