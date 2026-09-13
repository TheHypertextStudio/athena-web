/** Transactional authorization-code and refresh-grant preparation. */
import { randomUUID } from 'node:crypto';

import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';

import {
  currentConsent,
  intersectScopes,
  loadOne,
  lockClient,
  parseVerification,
  requestedRefreshScopes,
} from './oauth-provider-authorization-state';
import {
  effectiveOAuthClientScopes,
  hashOAuthToken,
  OAUTH_GRANT_CLAIM,
} from './oauth-resource-contract';
import { decodeJwtPayload } from './oauth-provider-live-state';
import {
  type AuthorizationCodeGrantContext,
  type DelegatedAuthorizationCode,
  type DocketOAuthResources,
  type IssuanceState,
  type OAuthClientRecord,
  type OAuthGrantRecord,
  type OAuthRefreshRecord,
  type PreparedIssuance,
  type RefreshPreparation,
  type RefreshSnapshot,
  type TokenBody,
  type TokenResponse,
  type VerificationRecord,
  delegateTokenToProvider,
  exactResource,
  hasCapability,
  oauthError,
  oauthServerError,
  scopesFrom,
} from './oauth-provider-types';

/** Bind the provider's exact returned refresh digest to the reserved Docket grant. */
export async function bindReturnedRefresh(
  adapter: DBTransactionAdapter,
  response: TokenResponse,
  state: IssuanceState,
): Promise<OAuthRefreshRecord | null> {
  if (!response.refresh_token) return null;
  const digest = await hashOAuthToken(response.refresh_token);
  const refresh = await loadOne<OAuthRefreshRecord>(adapter, 'oauthRefreshToken', [
    { field: 'token', value: digest },
  ]);
  if (
    refresh.clientId !== state.clientId ||
    refresh.userId !== state.userId ||
    refresh.docketGrantId !== null ||
    refresh.expiresAt === null ||
    refresh.referenceId !== null ||
    refresh.scopes.join(' ') !== response.scope
  ) {
    oauthServerError();
  }
  const updated = await adapter.update<OAuthRefreshRecord>({
    model: 'oauthRefreshToken',
    where: [
      { field: 'id', value: refresh.id },
      { field: 'docketGrantId', value: null },
    ],
    update: { docketGrantId: state.grantId },
  });
  if (!updated) oauthServerError();
  return { ...refresh, docketGrantId: state.grantId };
}

/** Verify that a returned access JWT carries the resource and grant reserved for this request. */
export function assertReturnedAccess(
  response: TokenResponse,
  state: IssuanceState,
): Record<string, unknown> {
  const claims = decodeJwtPayload(response.access_token);
  if (
    claims['aud'] !== state.resource ||
    claims['azp'] !== state.clientId ||
    claims['sub'] !== state.userId ||
    claims[OAUTH_GRANT_CLAIM] !== state.grantId ||
    typeof claims['jti'] !== 'string' ||
    claims['jti'].length === 0
  ) {
    oauthServerError();
  }
  return claims;
}

/** Retain a grant through the latest issued access or refresh credential plus clock tolerance. */
export async function extendGrantDeadline(
  adapter: DBTransactionAdapter,
  state: IssuanceState,
  claims: Record<string, unknown>,
  refresh: OAuthRefreshRecord | null,
): Promise<void> {
  const exp = claims['exp'];
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) oauthServerError();
  const grant = await loadOne<OAuthGrantRecord>(adapter, 'oauthResourceGrant', [
    { field: 'id', value: state.grantId },
    { field: 'clientId', value: state.clientId },
    { field: 'userId', value: state.userId },
  ]);
  const accessDeadline = (exp + 60) * 1000;
  if (refresh?.expiresAt === null) oauthServerError();
  const refreshDeadline = refresh ? refresh.expiresAt.getTime() + 60_000 : 0;
  const deadline = new Date(Math.max(grant.expiresAt.getTime(), accessDeadline, refreshDeadline));
  if (deadline.getTime() === grant.expiresAt.getTime()) return;
  const updated = await adapter.update<OAuthGrantRecord>({
    model: 'oauthResourceGrant',
    where: [{ field: 'id', value: grant.id }],
    update: { expiresAt: deadline },
  });
  if (!updated) oauthError('invalid_grant');
}

/** Materialize the resource-bound grant only after provider code and PKCE validation succeeds. */
export async function materializeCodeGrant(
  adapter: DBTransactionAdapter,
  state: IssuanceState,
  context: AuthorizationCodeGrantContext,
): Promise<OAuthGrantRecord> {
  const { snapshot, client, resources, accessLifetimeSeconds } = context;
  if (snapshot.referenceId != null) oauthError('invalid_grant');
  const resource = exactResource(context.requestedResource, snapshot.query.resource, resources);
  if (resource !== state.resource) oauthServerError();
  const requestedScopes = scopesFrom(snapshot.query.scope);
  if (!hasCapability(requestedScopes)) oauthError('invalid_scope');
  let consentId: string | null = null;
  let authorizationKind: OAuthGrantRecord['authorizationKind'] = 'consent';
  if (client.skipConsent === true && resource === resources.mcpResource) {
    authorizationKind = 'trusted_mcp';
  } else {
    const consent = await currentConsent(adapter, client.clientId, snapshot.userId);
    if (requestedScopes.some((scope) => !consent.scopes.includes(scope))) {
      oauthError('invalid_scope');
    }
    consentId = consent.id;
  }
  const now = new Date();
  return {
    id: state.grantId,
    clientId: client.clientId,
    userId: snapshot.userId,
    consentId,
    authorizationKind,
    resourceUri: resource,
    createdAt: now,
    expiresAt: new Date(now.getTime() + (accessLifetimeSeconds + 60) * 1000),
    revokedAt: null,
    legacyBefore: null,
  };
}

/** Snapshot a stored code and lock its client before delegating credential validation. */
export async function prepareAuthorizationCode(
  adapter: DBTransactionAdapter,
  body: TokenBody,
  resources: DocketOAuthResources,
  refreshLifetimeSeconds: number,
  accessLifetimeSeconds: number,
): Promise<PreparedIssuance | DelegatedAuthorizationCode> {
  if (!body.code) oauthError('invalid_request');
  const identifier = await hashOAuthToken(body.code);
  const verificationRecords = await adapter.findMany<VerificationRecord>({
    model: 'verification',
    where: [{ field: 'identifier', value: identifier }],
    limit: 2,
  });
  const verificationRecord = verificationRecords[0];
  if (verificationRecords.length === 0 || !verificationRecord) {
    return { kind: 'delegate-authorization-code', body, verificationIdentifier: identifier };
  }
  if (verificationRecords.length !== 1) oauthError('invalid_grant');
  if (verificationRecord.expiresAt.getTime() <= Date.now()) {
    return { kind: 'delegate-authorization-code', body, verificationIdentifier: identifier };
  }
  const snapshot = parseVerification(verificationRecord, resources);
  if (!snapshot) {
    return { kind: 'delegate-authorization-code', body, verificationIdentifier: identifier };
  }
  let client: OAuthClientRecord;
  try {
    client = await lockClient(adapter, snapshot.query.client_id);
  } catch (error) {
    if (error !== delegateTokenToProvider) throw error;
    return { kind: 'delegate-authorization-code', body, verificationIdentifier: identifier };
  }
  const grantId = randomUUID();
  return {
    kind: 'issue',
    body: { ...body, resource: snapshot.query.resource },
    state: {
      kind: 'authorization_code',
      clientId: client.clientId,
      userId: snapshot.userId,
      resource: snapshot.query.resource,
      grantId,
      verificationIdentifier: identifier,
      verificationSnapshot: snapshot,
    },
    codeGrant: {
      snapshot,
      client,
      ...(body.resource === undefined ? {} : { requestedResource: body.resource }),
      resources,
      refreshLifetimeSeconds,
      accessLifetimeSeconds,
    },
  };
}

/** Resolve current grant authority from trusted-client policy or exact standing consent. */
export async function grantAuthority(
  adapter: DBTransactionAdapter,
  grant: OAuthGrantRecord,
  client: OAuthClientRecord,
): Promise<readonly string[]> {
  if (grant.authorizationKind === 'trusted_mcp') {
    if (client.skipConsent !== true) oauthError('invalid_grant');
    return effectiveOAuthClientScopes(client.scopes);
  }
  const consent = await currentConsent(adapter, grant.clientId, grant.userId);
  if (consent.id !== grant.consentId) oauthError('invalid_grant');
  return consent.scopes;
}

/** Resolve an opaque refresh credential by the provider's configured digest. */
export async function findRefreshSnapshot(
  adapter: DBTransactionAdapter,
  body: TokenBody,
): Promise<RefreshSnapshot | null> {
  if (!body.refresh_token) return null;
  const digest = await hashOAuthToken(body.refresh_token);
  const rows = await adapter.findMany<OAuthRefreshRecord>({
    model: 'oauthRefreshToken',
    where: [{ field: 'token', value: digest }],
    limit: 2,
  });
  return rows.length === 1 && rows[0] ? { digest, record: rows[0] } : null;
}

async function boundRefreshResource(
  adapter: DBTransactionAdapter,
  grant: OAuthGrantRecord,
  body: TokenBody,
  resources: DocketOAuthResources,
): Promise<string> {
  const legacyResource = grant.resourceUri === null && grant.legacyBefore !== null;
  const resource = exactResource(
    body.resource,
    legacyResource ? resources.mcpResource : grant.resourceUri,
    resources,
  );
  if (!legacyResource) return resource;
  const updated = await adapter.update<OAuthGrantRecord>({
    model: 'oauthResourceGrant',
    where: [
      { field: 'id', value: grant.id },
      { field: 'resourceUri', value: null },
    ],
    update: { resourceUri: resources.mcpResource },
  });
  if (!updated) oauthError('invalid_grant');
  return resource;
}

/** Reauthorize and narrow one refresh rotation against current client, consent, and grant state. */
export async function prepareRefresh(
  adapter: DBTransactionAdapter,
  body: TokenBody,
  resources: DocketOAuthResources,
  snapshot: RefreshSnapshot,
): Promise<RefreshPreparation> {
  const client = await lockClient(adapter, snapshot.record.clientId);
  const refresh = await loadOne<OAuthRefreshRecord>(adapter, 'oauthRefreshToken', [
    { field: 'id', value: snapshot.record.id },
    { field: 'token', value: snapshot.digest },
  ]);
  if (refresh.expiresAt === null) oauthError('invalid_grant');
  if (refresh.referenceId !== null || !refresh.docketGrantId) {
    oauthError('invalid_grant');
  }
  if (refresh.revoked !== null) return { kind: 'stale-refresh', refresh };
  const grant = await loadOne<OAuthGrantRecord>(adapter, 'oauthResourceGrant', [
    { field: 'id', value: refresh.docketGrantId },
    { field: 'clientId', value: refresh.clientId },
    { field: 'userId', value: refresh.userId },
  ]);
  if (grant.revokedAt !== null || grant.expiresAt.getTime() <= Date.now()) {
    oauthError('invalid_grant');
  }
  const resource = await boundRefreshResource(adapter, grant, body, resources);
  const authority = await grantAuthority(adapter, grant, client);
  if (!authority.includes('offline_access')) oauthError('invalid_grant');
  const available = intersectScopes(
    refresh.scopes,
    effectiveOAuthClientScopes(client.scopes),
    authority,
  );
  if (!available.includes('offline_access')) oauthError('invalid_grant');
  const scopes = requestedRefreshScopes(available, body.scope);
  return {
    kind: 'issue',
    body: { ...body, resource, scope: scopes.join(' ') },
    state: {
      kind: 'refresh_token',
      clientId: refresh.clientId,
      userId: refresh.userId,
      resource,
      grantId: grant.id,
    },
  };
}
