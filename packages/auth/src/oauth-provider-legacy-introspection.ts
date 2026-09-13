/** Bounded compatibility materialization for pre-cutover trusted MCP credentials. */
import { randomUUID } from 'node:crypto';

import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';

import { legacyGrantDeadline } from './oauth-lifecycle';
import type {
  DocketOAuthResources,
  OAuthClientRecord,
  OAuthConsentRecord,
  OAuthGrantRecord,
  OAuthRefreshRecord,
} from './oauth-provider-types';

interface LegacyIntrospectionClaims {
  readonly clientId: string;
  readonly userId: string;
  readonly issuedAtSeconds: number;
  readonly expiresAtSeconds: number;
}

interface LegacyIntrospectionEvidence {
  readonly clients: readonly OAuthClientRecord[];
  readonly existing: readonly OAuthGrantRecord[];
  readonly users: readonly Record<string, unknown>[];
  readonly consents: readonly OAuthConsentRecord[];
  readonly refreshes: readonly OAuthRefreshRecord[];
}

function legacyIntrospectionClaims(
  claims: Record<string, unknown>,
  resources: DocketOAuthResources,
): LegacyIntrospectionClaims | null {
  const clientId = claims['azp'];
  const userId = claims['sub'];
  const issuedAtSeconds = claims['iat'];
  const expiresAtSeconds = claims['exp'];
  if (
    typeof clientId !== 'string' ||
    typeof userId !== 'string' ||
    claims['aud'] !== resources.mcpResource ||
    typeof issuedAtSeconds !== 'number' ||
    !Number.isSafeInteger(issuedAtSeconds) ||
    typeof expiresAtSeconds !== 'number' ||
    !Number.isSafeInteger(expiresAtSeconds)
  ) {
    return null;
  }
  return { clientId, userId, issuedAtSeconds, expiresAtSeconds };
}

async function loadLegacyIntrospectionEvidence(
  adapter: DBTransactionAdapter,
  claims: LegacyIntrospectionClaims,
): Promise<LegacyIntrospectionEvidence> {
  const { clientId, userId } = claims;
  const [clients, existing, users, consents, refreshes] = await Promise.all([
    adapter.findMany<OAuthClientRecord>({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: clientId }],
      limit: 2,
    }),
    adapter.findMany<OAuthGrantRecord>({
      model: 'oauthResourceGrant',
      where: [
        { field: 'clientId', value: clientId },
        { field: 'userId', value: userId },
        { field: 'legacyBefore', operator: 'ne', value: null },
      ],
      limit: 2,
    }),
    adapter.findMany<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'id', value: userId }],
      limit: 2,
    }),
    adapter.findMany<OAuthConsentRecord>({
      model: 'oauthConsent',
      where: [
        { field: 'clientId', value: clientId },
        { field: 'userId', value: userId },
      ],
      limit: 1,
    }),
    adapter.findMany<OAuthRefreshRecord>({
      model: 'oauthRefreshToken',
      where: [
        { field: 'clientId', value: clientId },
        { field: 'userId', value: userId },
      ],
      limit: 1,
    }),
  ]);
  return { clients, existing, users, consents, refreshes };
}

function legacyGrantCandidate(evidence: LegacyIntrospectionEvidence): OAuthClientRecord | null {
  const client = evidence.clients[0];
  const invalid = [
    evidence.existing.length > 1,
    evidence.clients.length !== 1 || !client,
    client?.disabled === true,
    client?.skipConsent !== true,
    client?.docketLegacyTrusted !== true,
    client?.docketLegacyBefore == null,
    evidence.users.length !== 1,
    evidence.consents.length > 0,
    evidence.refreshes.length > 0,
  ];
  return invalid.some(Boolean) ? null : (client ?? null);
}

function legacyWindowIsCurrent(
  claims: LegacyIntrospectionClaims,
  cutoff: Date,
  deadline: Date,
  now: Date,
): boolean {
  const cutoffSeconds = Math.floor(cutoff.getTime() / 1000);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const invalid = [
    claims.issuedAtSeconds > cutoffSeconds,
    claims.expiresAtSeconds <= claims.issuedAtSeconds,
    claims.expiresAtSeconds - claims.issuedAtSeconds > 15 * 60,
    claims.expiresAtSeconds <= nowSeconds,
    deadline.getTime() <= now.getTime(),
  ];
  return !invalid.some(Boolean);
}

/** Materialize one eligible claimless MCP grant while introspection holds the client lock. */
export async function ensureIntrospectionLegacyGrant(
  adapter: DBTransactionAdapter,
  rawClaims: Record<string, unknown>,
  resources: DocketOAuthResources,
): Promise<boolean> {
  const claims = legacyIntrospectionClaims(rawClaims, resources);
  if (!claims) return false;
  const evidence = await loadLegacyIntrospectionEvidence(adapter, claims);
  if (evidence.existing.length === 1) return true;
  const client = legacyGrantCandidate(evidence);
  if (!client?.docketLegacyBefore) return false;
  const now = new Date();
  const deadline = legacyGrantDeadline(client.docketLegacyBefore);
  if (!legacyWindowIsCurrent(claims, client.docketLegacyBefore, deadline, now)) return false;
  await adapter.create({
    model: 'oauthResourceGrant',
    forceAllowId: true,
    data: {
      id: randomUUID(),
      clientId: claims.clientId,
      userId: claims.userId,
      consentId: null,
      authorizationKind: 'trusted_mcp',
      resourceUri: resources.mcpResource,
      createdAt: now,
      expiresAt: deadline,
      revokedAt: null,
      legacyBefore: client.docketLegacyBefore,
    },
  });
  return true;
}
