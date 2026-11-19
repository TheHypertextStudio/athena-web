import {
  actor,
  db,
  integration,
  integrationCredential,
  notification,
  personalMcpConnection,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { CredentialReauthRequiredError } from '../error';
import { credentialSealingConfigured, unsealCredential } from './credentials';

const RECONNECT_LAST_ERROR = 'Reconnect this integration to restore access.';

/**
 * Mark an integration as requiring reconnection after its sealed credential fails decryption.
 *
 * @param integrationId - The integration whose stored credential could not be unsealed.
 * @param now - Timestamp recorded on `lastErrorAt`.
 * @returns `true` when the row transitioned out of `connected`.
 */
export async function markIntegrationCredentialNeedsReauth(
  integrationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(integration)
    .set({
      status: 'error',
      lastErrorKind: 'auth',
      lastError: RECONNECT_LAST_ERROR,
      lastErrorAt: now,
    })
    .where(and(eq(integration.id, integrationId), eq(integration.status, 'connected')))
    .returning({
      id: integration.id,
      organizationId: integration.organizationId,
      provider: integration.provider,
      createdBy: integration.createdBy,
    });

  const row = updated[0];
  if (!row) return false;
  await notifyReauthOwner(row);
  return true;
}

async function notifyReauthOwner(row: {
  readonly organizationId: string;
  readonly provider: string;
  readonly createdBy: string | null;
}): Promise<void> {
  if (!row.createdBy) return;
  const [owner] = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(eq(actor.id, row.createdBy))
    .limit(1);
  if (!owner?.userId) return;

  await db.insert(notification).values({
    userId: owner.userId,
    organizationId: row.organizationId,
    type: 'connector_needs_reauth',
    body: {
      title: `Reconnect ${row.provider}`,
      summary: 'Your stored credential expired — reconnect to restore this integration.',
      url: `/orgs/${row.organizationId}/settings/connections`,
    },
  });
}

/**
 * Unseal an integration credential and mark the parent integration as requiring reconnection if
 * AES-GCM decryption fails under the active `CREDENTIALS_ENCRYPTION_KEY`.
 *
 * @param integrationId - The owning integration id.
 * @param ciphertext - The stored `v1:gcm:...` envelope.
 * @returns The decrypted plaintext secret.
 * @throws {CredentialReauthRequiredError} When the envelope fails authentication.
 */
export async function unsealIntegrationCredential(
  integrationId: string,
  ciphertext: string,
): Promise<string> {
  try {
    return unsealCredential(ciphertext);
  } catch (error) {
    if (error instanceof CredentialReauthRequiredError) {
      await markIntegrationCredentialNeedsReauth(integrationId).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Unseal a personal MCP credential and demote its connection row to `error` when AES-GCM
 * decryption fails under the active `CREDENTIALS_ENCRYPTION_KEY`.
 *
 * @param connectionId - The owning `personal_mcp_connection` id.
 * @param ciphertext - The stored `v1:gcm:...` envelope.
 * @returns The decrypted plaintext secret.
 * @throws {CredentialReauthRequiredError} When the envelope fails authentication.
 */
export async function unsealPersonalMcpCredential(
  connectionId: string,
  ciphertext: string | undefined,
): Promise<string | undefined> {
  if (!ciphertext) return undefined;
  try {
    return unsealCredential(ciphertext);
  } catch (error) {
    if (error instanceof CredentialReauthRequiredError) {
      await db
        .update(personalMcpConnection)
        .set({
          status: 'error',
          lastError: RECONNECT_LAST_ERROR,
          lastErrorAt: new Date(),
        })
        .where(eq(personalMcpConnection.id, connectionId))
        .catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Scan connected integrations that hold a sealed credential and flag any whose ciphertext fails
 * decryption under the active `CREDENTIALS_ENCRYPTION_KEY` as requiring reconnection.
 *
 * @returns The number of integrations transitioned to `error` (`lastErrorKind = 'auth'`).
 */
export async function auditSealedCredentials(): Promise<number> {
  if (!credentialSealingConfigured()) return 0;
  const rows = await db
    .select({
      integrationId: integrationCredential.integrationId,
      ciphertext: integrationCredential.ciphertext,
    })
    .from(integrationCredential)
    .innerJoin(integration, eq(integration.id, integrationCredential.integrationId))
    .where(eq(integration.status, 'connected'));

  let flagged = 0;
  const now = new Date();
  for (const row of rows) {
    try {
      unsealCredential(row.ciphertext);
    } catch (error) {
      if (error instanceof CredentialReauthRequiredError) {
        const transitioned = await markIntegrationCredentialNeedsReauth(row.integrationId, now);
        if (transitioned) flagged += 1;
      }
    }
  }
  return flagged;
}
