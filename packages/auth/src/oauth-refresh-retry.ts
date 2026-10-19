/** Durable, encrypted responses for bounded OAuth refresh retries across API instances. */
import { timingSafeEqual } from 'node:crypto';

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

const receiptSchema = z.object({
  response: responseSchema,
  keyDigest: z.string().nullable(),
  accessExpiresAt: z.number(),
});

/** Private per-device proof forwarded by configured clients only to the same-origin issuer. */
export const REFRESH_RECOVERY_HEADER = 'Docket-Refresh-Recovery';

function recoveryKey(ctx: AuthEndpointContext): string | null {
  const key = ctx.request?.headers.get(REFRESH_RECOVERY_HEADER);
  return key && /^[A-Za-z0-9_-]{43,128}$/.test(key) ? key : null;
}

function decodeReceipt(value: unknown): z.infer<typeof receiptSchema> {
  const parsed = receiptSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { response: responseSchema.parse(value), keyDigest: null, accessExpiresAt: Infinity };
}

async function readReceipt(ctx: AuthEndpointContext, record: VerificationRecord) {
  return decodeReceipt(
    JSON.parse(await symmetricDecrypt({ key: ctx.context.secret, data: record.value })),
  );
}

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

async function receiptBinding(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  existing: VerificationRecord | undefined,
): Promise<{ keyDigest: string | null; expiresAt: Date }> {
  if (existing)
    return {
      keyDigest: (await readReceipt(ctx, existing)).keyDigest,
      expiresAt: existing.expiresAt,
    };
  const key = recoveryKey(ctx);
  if (!key) return { keyDigest: null, expiresAt: new Date(Date.now() + REFRESH_RETRY_GRACE_MS) };
  const parent = await loadOne<OAuthRefreshRecord>(adapter, 'oauthRefreshToken', [
    { field: 'token', value: await hashOAuthToken(body.refresh_token ?? '') },
  ]);
  if (!parent.expiresAt) oauthError('invalid_grant');
  return { keyDigest: await hashOAuthToken(key), expiresAt: parent.expiresAt };
}

async function matchingDeviceKey(
  ctx: AuthEndpointContext,
  digest: string | null,
): Promise<boolean> {
  const key = recoveryKey(ctx);
  if (!key || !digest) return false;
  const presented = Buffer.from(await hashOAuthToken(key));
  const expected = Buffer.from(digest);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
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
  const identifier = await retryIdentifier(body.refresh_token);
  const rows = await adapter.findMany<VerificationRecord>({
    model: 'verification',
    where: [{ field: 'identifier', value: identifier }],
    limit: 2,
  });
  if (rows.length > 1) oauthError('invalid_grant');
  const existing = rows[0];
  const { keyDigest, expiresAt } = await receiptBinding(ctx, adapter, body, existing);
  const claims = JSON.parse(
    Buffer.from(parsed.data.access_token.split('.')[1] ?? '', 'base64url').toString(),
  ) as unknown;
  const accessExpiresAt = z.object({ exp: z.number().int().positive() }).parse(claims).exp * 1000;
  const value = await symmetricEncrypt({
    key: ctx.context.secret,
    data: JSON.stringify({ response: parsed.data, keyDigest, accessExpiresAt }),
  });
  if (existing) {
    await adapter.update({
      model: 'verification',
      where: [{ field: 'identifier', value: identifier }],
      update: { value },
    });
  } else {
    await adapter.create({ model: 'verification', data: { identifier, value, expiresAt } });
  }
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

function isLivePredecessor(refresh: OAuthRefreshRecord): boolean {
  return (
    refresh.revoked !== null &&
    refresh.expiresAt !== null &&
    refresh.expiresAt.getTime() > Date.now()
  );
}

function withinReplayGrace(refresh: OAuthRefreshRecord): boolean {
  return (
    refresh.revoked !== null && Date.now() - refresh.revoked.getTime() <= REFRESH_RETRY_GRACE_MS
  );
}

/** A recovered credential pair and its original access deadline, never extended by replay. */
export interface RefreshReplay {
  readonly response: z.infer<typeof responseSchema>;
  readonly accessExpiresAt: number;
  readonly adjustExpiresIn: boolean;
}

/** Recover a rotation under bounded grace or its independently persisted device proof. */
export async function replayRefreshResponse(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  refresh: OAuthRefreshRecord,
  resources: DocketOAuthResources,
): Promise<RefreshReplay | null> {
  if (!body.refresh_token || !isLivePredecessor(refresh)) return null;
  const rows = await adapter.findMany<VerificationRecord>({
    model: 'verification',
    where: [{ field: 'identifier', value: await retryIdentifier(body.refresh_token) }],
    limit: 2,
  });
  const record = rows.length === 1 ? rows[0] : undefined;
  if (!record || record.expiresAt.getTime() <= Date.now()) return null;
  const { grant, scopes } = await retryAuthority(adapter, body, refresh, resources);
  const receipt = await readReceipt(ctx, record);
  const recent = withinReplayGrace(refresh);
  if (!recent && !(await matchingDeviceKey(ctx, receipt.keyDigest))) return null;
  const response = receipt.response;
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
  return { response, accessExpiresAt: receipt.accessExpiresAt, adjustExpiresIn: !recent };
}
