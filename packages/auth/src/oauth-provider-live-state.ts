/** Live OAuth credential, grant, and revocation evaluation. */
import type { AuthEndpointContext } from '@better-auth/core/context';
import type { DBTransactionAdapter, Where } from '@better-auth/core/db/adapter';
import { verifyJwsAccessToken } from '@better-auth/core/oauth2';
import { APIError } from 'better-auth/api';
import { z } from 'zod';

import {
  authorizeOAuthBearerState,
  OAuthBearerStateError,
  type OAuthBearerLiveState,
} from './oauth-bearer-state';
import {
  effectiveOAuthClientScopes,
  hashOAuthToken,
  OAUTH_GRANT_CLAIM,
} from './oauth-resource-contract';
import { ensureIntrospectionLegacyGrant } from './oauth-provider-legacy-introspection';
import {
  type DocketOAuthResources,
  type IntrospectionBody,
  type OAuthClientRecord,
  type OAuthConsentRecord,
  type OAuthGrantRecord,
  type OAuthJwksRecord,
  type OAuthRefreshRecord,
  type RevokeBody,
  oauthError,
  oauthServerError,
} from './oauth-provider-types';

/** Decode an issued JWT payload for post-provider invariant checks without verifying it again. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const encoded = token.split('.')[1];
  if (!encoded) oauthServerError();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) oauthServerError();
    return parsed as Record<string, unknown>;
  } catch {
    oauthServerError();
  }
}

/** Read a syntactically complete client identifier without replacing provider authentication. */
export function clientIdFromRequest(ctx: AuthEndpointContext, body: RevokeBody): string | null {
  const authorization = ctx.request?.headers.get('authorization');
  if (authorization?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const clientId = separator < 0 ? '' : decoded.slice(0, separator);
      const clientSecret = separator < 0 ? '' : decoded.slice(separator + 1);
      return clientId && clientSecret ? clientId : null;
    } catch {
      return null;
    }
  }
  if (!body.client_id) return null;
  return body.client_id;
}

/** Normalize the RFC 7009 token field after client authentication has succeeded. */
export function presentedRevocationToken(body: RevokeBody): string {
  const raw = body.token ?? '';
  const token = raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
  if (!token) oauthError('invalid_request');
  return token;
}

/** Revoke a resource grant and every unrevoked refresh descendant in one transaction. */
export async function revokeGrant(
  adapter: DBTransactionAdapter,
  grantId: string,
  now: Date,
): Promise<void> {
  await adapter.updateMany({
    model: 'oauthResourceGrant',
    where: [
      { field: 'id', value: grantId },
      { field: 'revokedAt', value: null },
    ],
    update: { revokedAt: now },
  });
  await adapter.updateMany({
    model: 'oauthRefreshToken',
    where: [
      { field: 'docketGrantId', value: grantId },
      { field: 'revoked', value: null },
    ],
    update: { revoked: now },
  });
}

/** Verify a candidate access JWT against stored keys and either Docket protected resource. */
export async function verifyRevocableJwt(
  adapter: DBTransactionAdapter,
  token: string,
  resources: DocketOAuthResources,
): Promise<Record<string, unknown> | null> {
  const storedKeys = await adapter.findMany<OAuthJwksRecord>({ model: 'jwks' });
  let keys: Record<string, unknown>[];
  try {
    keys = storedKeys.map((stored) => {
      const publicKey: unknown = JSON.parse(stored.publicKey);
      if (!publicKey || typeof publicKey !== 'object' || Array.isArray(publicKey)) {
        oauthServerError();
      }
      return {
        ...(publicKey as Record<string, unknown>),
        kid: stored.id,
        alg: stored.alg ?? 'EdDSA',
        ...(stored.crv ? { crv: stored.crv } : {}),
      };
    });
  } catch (error) {
    if (error instanceof APIError) throw error;
    oauthServerError();
  }
  try {
    const claims = await verifyJwsAccessToken(token, {
      jwksFetch: async () => ({ keys }),
      verifyOptions: {
        audience: [resources.mcpResource, resources.restResource],
        issuer: resources.issuer,
      },
    });
    if (
      (claims.aud !== resources.mcpResource && claims.aud !== resources.restResource) ||
      typeof claims['azp'] !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

async function loadProviderBearerState(
  adapter: DBTransactionAdapter,
  input: {
    readonly clientId: string;
    readonly userId: string;
    readonly grantId: string | null;
    readonly tokenDigest: string;
  },
): Promise<OAuthBearerLiveState<Record<string, unknown>> | null> {
  const grantWhere: Where[] =
    input.grantId === null
      ? [
          { field: 'clientId', value: input.clientId },
          { field: 'userId', value: input.userId },
          { field: 'legacyBefore', operator: 'ne', value: null },
        ]
      : [
          { field: 'id', value: input.grantId },
          { field: 'clientId', value: input.clientId },
          { field: 'userId', value: input.userId },
        ];
  const [users, clients, grants, consents, revocations] = await Promise.all([
    adapter.findMany<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'id', value: input.userId }],
      limit: 2,
    }),
    adapter.findMany<OAuthClientRecord>({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: input.clientId }],
      limit: 2,
    }),
    adapter.findMany<OAuthGrantRecord>({
      model: 'oauthResourceGrant',
      where: grantWhere,
      limit: 2,
    }),
    adapter.findMany<OAuthConsentRecord>({
      model: 'oauthConsent',
      where: [
        { field: 'clientId', value: input.clientId },
        { field: 'userId', value: input.userId },
      ],
      limit: 2,
    }),
    adapter.findMany<{ readonly tokenDigest: string }>({
      model: 'oauthJwtRevocation',
      where: [{ field: 'tokenDigest', value: input.tokenDigest }],
      limit: 1,
    }),
  ]);
  const currentUser = users[0];
  const client = clients[0];
  if (
    users.length !== 1 ||
    !currentUser ||
    clients.length !== 1 ||
    !client ||
    grants.length !== 1
  ) {
    return null;
  }
  return {
    user: currentUser,
    clientId: client.clientId,
    clientDisabled: client.disabled === true,
    clientSkipConsent: client.skipConsent === true,
    clientScopes: effectiveOAuthClientScopes(client.scopes),
    clientLegacyBefore: client.docketLegacyBefore ?? null,
    grant: grants[0] ?? null,
    consents,
    tokenRevoked: revocations.length > 0,
  };
}

interface IntrospectionCredential {
  readonly claims: Record<string, unknown>;
  readonly grantId: string | null;
  readonly refreshCredential: boolean;
}

interface IntrospectionSubject {
  readonly userId: string;
  readonly clientId: string;
  readonly audience: string;
}

type ActiveIntrospectionRefresh = OAuthRefreshRecord & {
  readonly docketGrantId: string;
  readonly expiresAt: Date;
};

function activeIntrospectionRefresh(
  rows: readonly OAuthRefreshRecord[],
): ActiveIntrospectionRefresh | null {
  const refresh = rows.length === 1 ? rows[0] : null;
  if (
    !refresh?.docketGrantId ||
    refresh.expiresAt === null ||
    refresh.referenceId !== null ||
    refresh.revoked !== null
  ) {
    return null;
  }
  return { ...refresh, docketGrantId: refresh.docketGrantId, expiresAt: refresh.expiresAt };
}

async function refreshIntrospectionCredential(
  adapter: DBTransactionAdapter,
  tokenDigest: string,
  resources: DocketOAuthResources,
): Promise<IntrospectionCredential | null> {
  const refreshRows = await adapter.findMany<OAuthRefreshRecord>({
    model: 'oauthRefreshToken',
    where: [{ field: 'token', value: tokenDigest }],
    limit: 2,
  });
  const refresh = activeIntrospectionRefresh(refreshRows);
  if (!refresh) return null;
  const grantRows = await adapter.findMany<OAuthGrantRecord>({
    model: 'oauthResourceGrant',
    where: [
      { field: 'id', value: refresh.docketGrantId },
      { field: 'clientId', value: refresh.clientId },
      { field: 'userId', value: refresh.userId },
    ],
    limit: 2,
  });
  const grant = grantRows.length === 1 ? grantRows[0] : null;
  const resource = grant?.resourceUri ?? (grant?.legacyBefore ? resources.mcpResource : null);
  if (!grant || !resource) return null;
  return {
    grantId: refresh.docketGrantId,
    refreshCredential: true,
    claims: {
      sub: refresh.userId,
      azp: refresh.clientId,
      iss: resources.issuer,
      aud: resource,
      iat: Math.floor((refresh.createdAt ?? new Date(0)).getTime() / 1000),
      exp: Math.floor(refresh.expiresAt.getTime() / 1000),
      scope: refresh.scopes.join(' '),
      jti: `refresh:${refresh.id}`,
      [OAUTH_GRANT_CLAIM]: refresh.docketGrantId,
    },
  };
}

async function introspectionCredential(
  adapter: DBTransactionAdapter,
  token: string,
  tokenDigest: string,
  resources: DocketOAuthResources,
): Promise<IntrospectionCredential | null> {
  const claims = await verifyRevocableJwt(adapter, token, resources);
  if (!claims) return refreshIntrospectionCredential(adapter, tokenDigest, resources);
  const rawGrantId = claims[OAUTH_GRANT_CLAIM];
  return {
    claims,
    grantId: typeof rawGrantId === 'string' && rawGrantId.length > 0 ? rawGrantId : null,
    refreshCredential: false,
  };
}

function introspectionSubject(
  claims: Record<string, unknown>,
  resources: DocketOAuthResources,
): IntrospectionSubject | null {
  const userId = typeof claims['sub'] === 'string' ? claims['sub'] : '';
  const clientId = typeof claims['azp'] === 'string' ? claims['azp'] : '';
  const audience = claims['aud'];
  if (
    !userId ||
    !clientId ||
    (audience !== resources.mcpResource && audience !== resources.restResource)
  ) {
    return null;
  }
  return { userId, clientId, audience };
}

async function introspectionState(
  adapter: DBTransactionAdapter,
  credential: IntrospectionCredential,
  subject: IntrospectionSubject,
  tokenDigest: string,
  resources: DocketOAuthResources,
): Promise<OAuthBearerLiveState<Record<string, unknown>> | null> {
  if (credential.grantId === null && subject.audience === resources.mcpResource) {
    try {
      await ensureIntrospectionLegacyGrant(adapter, credential.claims, resources);
    } catch {
      return null;
    }
  }
  const state = await loadProviderBearerState(adapter, {
    clientId: subject.clientId,
    userId: subject.userId,
    grantId: credential.grantId,
    tokenDigest,
  });
  if (
    !state ||
    !credential.refreshCredential ||
    state.grant?.resourceUri !== null ||
    state.grant.legacyBefore === null ||
    subject.audience !== resources.mcpResource
  ) {
    return state;
  }
  return { ...state, grant: { ...state.grant, resourceUri: resources.mcpResource } };
}

function authorizedIntrospectionScopes(
  credential: IntrospectionCredential,
  subject: IntrospectionSubject,
  state: OAuthBearerLiveState<Record<string, unknown>>,
  resources: DocketOAuthResources,
): readonly string[] | null {
  try {
    const authorized = authorizeOAuthBearerState(credential.claims, state, {
      expectedResource: subject.audience,
      issuer: resources.issuer,
      now: new Date(),
      ...(subject.audience === resources.mcpResource
        ? { allowLegacyMcp: true, allowTrustedMcp: true }
        : {}),
    });
    if (credential.refreshCredential && !authorized.grantedScopes.includes('offline_access')) {
      return null;
    }
    return authorized.grantedScopes;
  } catch (error) {
    if (error instanceof OAuthBearerStateError) return null;
    throw error;
  }
}

const activeIntrospectionSchema = z.looseObject({ active: z.boolean() });

/** Reevaluate an active provider introspection result against Docket's live authorization state. */
export async function liveIntrospectionResult(
  adapter: DBTransactionAdapter,
  body: IntrospectionBody,
  rawResponse: unknown,
  resources: DocketOAuthResources,
): Promise<unknown> {
  const parsed = activeIntrospectionSchema.safeParse(rawResponse);
  if (!parsed.success || !parsed.data.active) return rawResponse;
  const token = presentedRevocationToken(body);
  const tokenDigest = await hashOAuthToken(token);
  const credential = await introspectionCredential(adapter, token, tokenDigest, resources);
  if (!credential) return { active: false };
  const subject = introspectionSubject(credential.claims, resources);
  if (!subject) return { active: false };
  const state = await introspectionState(adapter, credential, subject, tokenDigest, resources);
  if (!state) return { active: false };
  const scopes = authorizedIntrospectionScopes(credential, subject, state, resources);
  return scopes ? { ...parsed.data, scope: scopes.join(' ') } : { active: false };
}
