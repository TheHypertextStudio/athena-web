/** Durable, encrypted responses for bounded OAuth refresh retries across API instances. */
import type { AuthEndpointContext } from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { z } from 'zod';

import {
  intersectScopes,
  loadOne,
  requestedRefreshScopes,
} from './oauth-provider-authorization-state';
import { grantAuthority } from './oauth-provider-issuance';
import { effectiveOAuthClientScopes, hashOAuthToken } from './oauth-resource-contract';
import {
  type DocketOAuthResources,
  type OAuthClientRecord,
  type OAuthGrantRecord,
  type OAuthRefreshRecord,
  type TokenBody,
  type VerificationRecord,
  exactResource,
  oauthError,
} from './oauth-provider-types';

/** Maximum interval for recovering an already committed rotation without rotating again. */
export const REFRESH_RETRY_GRACE_MS = 30_000;

const responseSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  scope: z.string(),
});

const RETRY_PREFIX = 'docket:oauth-refresh-retry:';

async function retryIdentifier(token: string): Promise<string> {
  return `${RETRY_PREFIX}${await hashOAuthToken(token)}`;
}

async function pruneExpiredRetries(adapter: DBTransactionAdapter): Promise<void> {
  const expired = await adapter.findMany<{ id: string }>({
    model: 'verification',
    where: [
      { field: 'identifier', operator: 'starts_with', value: RETRY_PREFIX },
      { field: 'expiresAt', operator: 'lte', value: new Date() },
    ],
    sortBy: { field: 'id', direction: 'asc' },
    limit: 100,
  });
  if (expired.length === 0) return;
  await adapter.deleteMany({
    model: 'verification',
    where: [{ field: 'id', operator: 'in', value: expired.map((row) => row.id) }],
  });
}

/** Persist the exact token response in the issuance transaction, encrypted with the auth key. */
export async function rememberRefreshResponse(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  response: unknown,
): Promise<void> {
  if (!body.refresh_token) return;
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) return;
  await pruneExpiredRetries(adapter);
  const value = await symmetricEncrypt({
    key: ctx.context.secret,
    data: JSON.stringify(parsed.data),
  });
  await adapter.create({
    model: 'verification',
    data: {
      identifier: await retryIdentifier(body.refresh_token),
      value,
      expiresAt: new Date(Date.now() + REFRESH_RETRY_GRACE_MS),
    },
  });
}

async function retryAuthority(
  adapter: DBTransactionAdapter,
  body: TokenBody,
  refresh: OAuthRefreshRecord,
  resources: DocketOAuthResources,
): Promise<{ grant: OAuthGrantRecord; scopes: string }> {
  const grant = await loadOne<OAuthGrantRecord>(adapter, 'oauthResourceGrant', [
    { field: 'id', value: refresh.docketGrantId },
    { field: 'clientId', value: refresh.clientId },
    { field: 'userId', value: refresh.userId },
  ]);
  if (grant.revokedAt !== null || grant.expiresAt.getTime() <= Date.now())
    oauthError('invalid_grant');
  exactResource(body.resource, grant.resourceUri, resources);
  const client = await loadOne<OAuthClientRecord>(adapter, 'oauthClient', [
    { field: 'clientId', value: refresh.clientId },
  ]);
  const available = intersectScopes(
    refresh.scopes,
    effectiveOAuthClientScopes(client.scopes),
    await grantAuthority(adapter, grant, client),
  );
  if (!available.includes('offline_access')) oauthError('invalid_grant');
  return { grant, scopes: requestedRefreshScopes(available, body.scope).join(' ') };
}

function isRecentRotation(refresh: OAuthRefreshRecord): boolean {
  return (
    refresh.revoked !== null &&
    refresh.expiresAt !== null &&
    refresh.expiresAt.getTime() > Date.now() &&
    Date.now() - refresh.revoked.getTime() <= REFRESH_RETRY_GRACE_MS
  );
}

/** Recover a recent rotation only while the authenticated client's exact grant is still live. */
export async function replayRefreshResponse(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  refresh: OAuthRefreshRecord,
  resources: DocketOAuthResources,
): Promise<z.infer<typeof responseSchema> | null> {
  if (!body.refresh_token || !isRecentRotation(refresh)) return null;
  const rows = await adapter.findMany<VerificationRecord>({
    model: 'verification',
    where: [{ field: 'identifier', value: await retryIdentifier(body.refresh_token) }],
    limit: 2,
  });
  const record = rows.length === 1 ? rows[0] : undefined;
  if (!record || record.expiresAt.getTime() <= Date.now()) return null;
  const { grant, scopes } = await retryAuthority(adapter, body, refresh, resources);
  const response = responseSchema.parse(
    JSON.parse(
      await symmetricDecrypt({
        key: ctx.context.secret,
        data: record.value,
      }),
    ),
  );
  if (response.scope !== scopes) oauthError('invalid_grant');
  const successor = await loadOne<OAuthRefreshRecord>(adapter, 'oauthRefreshToken', [
    { field: 'token', value: await hashOAuthToken(response.refresh_token) },
    { field: 'docketGrantId', value: grant.id },
  ]);
  if (
    successor.revoked !== null ||
    !successor.expiresAt ||
    successor.expiresAt.getTime() <= Date.now()
  ) {
    oauthError('invalid_grant');
  }
  return response;
}
