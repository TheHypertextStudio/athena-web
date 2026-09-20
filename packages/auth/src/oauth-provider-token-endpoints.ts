/** Transactional token issuance, revocation, and introspection endpoints. */
import {
  getCurrentAdapter,
  runWithAdapter,
  runWithTransaction,
  type AuthEndpointContext,
} from '@better-auth/core/context';
import type { DBAdapter, DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';

import { rejectRepeatedFields } from './oauth-provider-authorization-state';
import {
  assertReturnedAccess,
  bindReturnedRefresh,
  extendGrantDeadline,
  findRefreshSnapshot,
  materializeCodeGrant,
  prepareAuthorizationCode,
  prepareRefresh,
} from './oauth-provider-issuance';
import {
  clientIdFromRequest,
  liveIntrospectionResult,
  presentedRevocationToken,
  revokeGrant,
  verifyRevocableJwt,
} from './oauth-provider-live-state';
import { coordinatingAdapter, rawInput } from './oauth-provider-transaction';
import {
  type CommittedTokenError,
  type DelegatedAuthorizationCode,
  type DocketOAuthResources,
  type IntrospectionBody,
  type OAuthGrantRecord,
  type OAuthRefreshRecord,
  type PreparedIssuance,
  type ProviderEndpoint,
  type ProviderEndpointInput,
  type RevokeBody,
  type TokenBody,
  type TokenPreparation,
  type TokenResponse,
  codeIssuanceReachedState,
  committedTokenErrorMarker,
  delegateTokenToProvider,
  isProviderMissingIntrospectionToken,
  issuanceState,
  isProviderTokenFailureAfterAuthentication,
  oauthError,
  oauthServerError,
  savepointState,
  singletonIntrospectionFields,
  singletonRevokeFields,
  singletonTokenFields,
} from './oauth-provider-types';
import { hashOAuthToken } from './oauth-resource-contract';

function parseTokenResponse(value: unknown): TokenResponse {
  const parsed = z
    .looseObject({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1).optional(),
      scope: z.string(),
    })
    .safeParse(value);
  if (!parsed.success) oauthServerError();
  return parsed.data;
}

async function invokeCodeProviderInSavepoint(
  ctx: AuthEndpointContext,
  raw: ProviderEndpoint,
  adapter: DBTransactionAdapter,
  prepared: PreparedIssuance | DelegatedAuthorizationCode,
): Promise<{ readonly response: unknown } | CommittedTokenError> {
  const invocation =
    prepared.kind === 'issue'
      ? {
          kind: prepared.kind,
          body: prepared.body,
          state: prepared.state,
          codeGrant: prepared.codeGrant ?? oauthServerError(),
          verificationIdentifier: prepared.state.verificationIdentifier,
        }
      : {
          kind: prepared.kind,
          body: prepared.body,
          verificationIdentifier: prepared.verificationIdentifier,
        };
  const verificationIdentifier = invocation.verificationIdentifier;
  if (!verificationIdentifier) oauthServerError();
  const transaction = await savepointState.get();
  if (!transaction) oauthServerError();
  const nestedCoordinator: DBAdapter = {
    ...adapter,
    transaction: transaction.run,
  };
  const consumption = { committed: false };
  try {
    const response = await runWithAdapter(nestedCoordinator, async () =>
      runWithTransaction(nestedCoordinator, async () => {
        const nested = await getCurrentAdapter(nestedCoordinator);
        await codeIssuanceReachedState.set(false);
        try {
          const response = await raw(
            rawInput(ctx, nested, invocation.body as unknown as Record<string, unknown>),
          );
          if (invocation.kind === 'delegate-authorization-code') return response;
          const parsedResponse = parseTokenResponse(response);
          const grant = await materializeCodeGrant(nested, invocation.state, invocation.codeGrant);
          await nested.create<Record<string, unknown>, OAuthGrantRecord>({
            model: 'oauthResourceGrant',
            forceAllowId: true,
            data: grant as unknown as Record<string, unknown>,
          });
          const refresh = await bindReturnedRefresh(nested, parsedResponse, invocation.state);
          const claims = assertReturnedAccess(parsedResponse, invocation.state);
          await extendGrantDeadline(nested, invocation.state, claims, refresh);
          return response;
        } catch (error) {
          if (!(await codeIssuanceReachedState.get())) {
            try {
              const remaining = await nested.findMany({
                model: 'verification',
                where: [{ field: 'identifier', value: verificationIdentifier }],
                limit: 1,
              });
              consumption.committed = remaining.length === 0;
            } catch {
              // A failed SQL statement aborts this savepoint. Preserve the original failure and
              // let the outer transaction restore the code instead of guessing its phase.
            }
          }
          throw error;
        }
      }),
    );
    return { response };
  } catch (error) {
    if (!consumption.committed) throw error;
    if (!(error instanceof Error)) oauthServerError();
    await adapter.deleteMany({
      model: 'verification',
      where: [{ field: 'identifier', value: verificationIdentifier }],
    });
    return { [committedTokenErrorMarker]: true, error };
  }
}

interface TokenEndpointDependencies {
  readonly raw: ProviderEndpoint;
  readonly rawRevoke: ProviderEndpoint;
  readonly resources: DocketOAuthResources;
  readonly accessLifetimeSeconds: number;
  readonly refreshLifetimeSeconds: number;
}

type TokenTransactionResult =
  | CommittedTokenError
  | { readonly kind: 'issued' | 'provider'; readonly response: unknown }
  | { readonly kind: 'stale' };

async function prepareRefreshRequest(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  dependencies: TokenEndpointDependencies,
): Promise<TokenPreparation> {
  const snapshot = await findRefreshSnapshot(adapter, body);
  const clientId = clientIdFromRequest(ctx, body);
  const refreshToken = body.refresh_token;
  if (!refreshToken || !snapshot) {
    throw delegateTokenToProvider;
  }
  if (clientId !== snapshot.record.clientId) {
    throw delegateTokenToProvider;
  }
  await authenticateRevokeInSavepoint(ctx, dependencies.rawRevoke, adapter, {
    ...(body.client_id ? { client_id: body.client_id } : {}),
    ...(body.client_secret ? { client_secret: body.client_secret } : {}),
    token: refreshToken,
  });
  return prepareRefresh(adapter, body, dependencies.resources, snapshot);
}

function prepareTokenRequest(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  dependencies: TokenEndpointDependencies,
): Promise<TokenPreparation> {
  if (body.grant_type === 'refresh_token') {
    return prepareRefreshRequest(ctx, adapter, body, dependencies);
  }
  return prepareAuthorizationCode(
    adapter,
    body,
    dependencies.resources,
    dependencies.refreshLifetimeSeconds,
    dependencies.accessLifetimeSeconds,
  );
}

async function delegateTokenRequest(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  raw: ProviderEndpoint,
): Promise<TokenTransactionResult> {
  const response = await raw(rawInput(ctx, adapter, body as unknown as Record<string, unknown>));
  return { kind: 'provider', response };
}

async function invokePreparedProvider(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  prepared: PreparedIssuance,
  raw: ProviderEndpoint,
): Promise<{ readonly response: unknown } | CommittedTokenError> {
  if (prepared.state.kind === 'authorization_code' && prepared.state.verificationIdentifier) {
    return invokeCodeProviderInSavepoint(ctx, raw, adapter, prepared);
  }
  return {
    response: await raw(
      rawInput(ctx, adapter, prepared.body as unknown as Record<string, unknown>),
    ),
  };
}

async function finishTokenRequest(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  prepared: TokenPreparation,
  raw: ProviderEndpoint,
): Promise<TokenTransactionResult> {
  if (prepared.kind === 'delegate-authorization-code') {
    const invocation = await invokeCodeProviderInSavepoint(ctx, raw, adapter, prepared);
    return committedTokenErrorMarker in invocation
      ? invocation
      : { kind: 'provider', response: invocation.response };
  }
  if (prepared.kind === 'stale-refresh') {
    const clientOwnsRefresh = clientIdFromRequest(ctx, body) === prepared.refresh.clientId;
    if (clientOwnsRefresh && prepared.refresh.docketGrantId) {
      await revokeGrant(adapter, prepared.refresh.docketGrantId, new Date());
    }
    return { kind: 'stale' };
  }
  await issuanceState.set(prepared.state);
  const invocation = await invokePreparedProvider(ctx, adapter, prepared, raw);
  if (committedTokenErrorMarker in invocation) return invocation;
  if (prepared.state.kind === 'authorization_code') {
    return { kind: 'issued', response: invocation.response };
  }
  const parsedResponse = parseTokenResponse(invocation.response);
  const refresh = await bindReturnedRefresh(adapter, parsedResponse, prepared.state);
  const claims = assertReturnedAccess(parsedResponse, prepared.state);
  await extendGrantDeadline(adapter, prepared.state, claims, refresh);
  return { kind: 'issued', response: invocation.response };
}

async function runTokenTransaction(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: TokenBody,
  dependencies: TokenEndpointDependencies,
): Promise<TokenTransactionResult> {
  let prepared: TokenPreparation;
  try {
    prepared = await prepareTokenRequest(ctx, adapter, body, dependencies);
  } catch (error) {
    if (error !== delegateTokenToProvider) throw error;
    return delegateTokenRequest(ctx, adapter, body, dependencies.raw);
  }
  return finishTokenRequest(ctx, adapter, body, prepared, dependencies.raw);
}

/** Wrap token issuance with Docket's resource grant and refresh-family transaction. */
export function wrapTokenEndpoint(
  raw: ProviderEndpoint,
  rawRevoke: ProviderEndpoint,
  resources: DocketOAuthResources,
  accessLifetimeSeconds: number,
  refreshLifetimeSeconds: number,
): ProviderEndpoint {
  const dependencies = {
    raw,
    rawRevoke,
    resources,
    accessLifetimeSeconds,
    refreshLifetimeSeconds,
  } satisfies TokenEndpointDependencies;
  return createAuthEndpoint(raw.path, { ...raw.options, cloneRequest: true }, async (ctx) => {
    ctx.setHeader('Cache-Control', 'no-store');
    ctx.setHeader('Pragma', 'no-cache');
    await rejectRepeatedFields(ctx.request, singletonTokenFields);
    const body = ctx.body as TokenBody;
    if (body.grant_type !== 'authorization_code' && body.grant_type !== 'refresh_token') {
      return raw(ctx as unknown as Parameters<ProviderEndpoint>[0]);
    }
    const endpointContext = ctx as unknown as AuthEndpointContext;
    const coordinator = coordinatingAdapter(ctx.context['options']);
    const result = await runWithTransaction(coordinator, async () => {
      const adapter = await getCurrentAdapter(coordinator);
      return runTokenTransaction(endpointContext, adapter, body, dependencies);
    });
    if (committedTokenErrorMarker in result) throw result.error;
    if (result.kind === 'stale') oauthError('invalid_grant');
    return result.response;
  });
}

const revokeRollback = new Error('Roll back the OAuth revocation authentication probe.');

async function authenticateRevokeInSavepoint(
  ctx: AuthEndpointContext,
  raw: ProviderEndpoint,
  adapter: DBTransactionAdapter,
  body: RevokeBody,
): Promise<void> {
  const savepoint = await savepointState.get();
  if (!savepoint) oauthServerError();
  const nestedCoordinator: DBAdapter = {
    ...adapter,
    transaction: savepoint.run,
  };
  const probeBody: RevokeBody = {
    ...(body.client_id !== undefined ? { client_id: body.client_id } : {}),
    ...(body.client_secret !== undefined ? { client_secret: body.client_secret } : {}),
    token: 'docket-rfc7009-client-authentication-probe',
  };
  try {
    await runWithAdapter(nestedCoordinator, async () =>
      runWithTransaction(nestedCoordinator, async () => {
        const nested = await getCurrentAdapter(nestedCoordinator);
        await raw(rawInput(ctx, nested, probeBody as unknown as Record<string, unknown>));
        throw revokeRollback;
      }),
    );
  } catch (error) {
    if (error !== revokeRollback && !isProviderTokenFailureAfterAuthentication(error)) throw error;
  }
}

interface RevocationTarget {
  readonly clientId: string;
  readonly digest: string;
  readonly now: Date;
  readonly token: string;
}

async function revokePresentedRefresh(
  adapter: DBTransactionAdapter,
  target: RevocationTarget,
): Promise<void> {
  const refreshRows = await adapter.findMany<OAuthRefreshRecord>({
    model: 'oauthRefreshToken',
    where: [{ field: 'token', value: target.digest }],
    limit: 2,
  });
  const refresh = refreshRows.length === 1 ? refreshRows[0] : null;
  if (
    refresh?.clientId !== target.clientId ||
    !refresh.docketGrantId ||
    refresh.expiresAt === null ||
    refresh.expiresAt.getTime() <= target.now.getTime()
  )
    return;
  const descendants =
    refresh.revoked === null
      ? [refresh]
      : await adapter.findMany<OAuthRefreshRecord>({
          model: 'oauthRefreshToken',
          where: [
            { field: 'docketGrantId', value: refresh.docketGrantId },
            { field: 'revoked', value: null },
            { field: 'expiresAt', operator: 'gt', value: target.now },
          ],
          limit: 1,
        });
  return descendants.length ? revokeGrant(adapter, refresh.docketGrantId, target.now) : undefined;
}

async function revokePresentedJwt(
  adapter: DBTransactionAdapter,
  resources: DocketOAuthResources,
  target: RevocationTarget,
): Promise<void> {
  const claims = await verifyRevocableJwt(adapter, target.token, resources);
  if (claims?.['azp'] !== target.clientId) return;
  const exp = claims['exp'];
  if (typeof exp !== 'number' || exp * 1000 <= target.now.getTime()) return;
  const existing = await adapter.findMany<{ readonly tokenDigest: string }>({
    model: 'oauthJwtRevocation',
    where: [{ field: 'tokenDigest', value: target.digest }],
    limit: 1,
  });
  if (existing.length > 0) return;
  const transaction = await savepointState.get();
  if (!transaction) oauthServerError();
  await transaction.recordJwtRevocation({
    tokenDigest: target.digest,
    expiresAt: new Date((exp + 60) * 1000),
    revokedAt: target.now,
  });
}

async function applyExactRevocation(
  adapter: DBTransactionAdapter,
  clientId: string,
  token: string,
  resources: DocketOAuthResources,
): Promise<void> {
  const now = new Date();
  const digest = await hashOAuthToken(token);
  const target = { clientId, digest, now, token } satisfies RevocationTarget;
  await revokePresentedRefresh(adapter, target);
  await revokePresentedJwt(adapter, resources, target);
}

function introspectionProviderInput(
  ctx: AuthEndpointContext,
  adapter: DBTransactionAdapter,
  body: IntrospectionBody,
): Parameters<ProviderEndpoint>[0] {
  const input = rawInput(ctx, adapter, body as unknown as Record<string, unknown>);
  const context = input.context as unknown as Record<string, unknown>;
  const rawGetPlugin = context['getPlugin'];
  if (typeof rawGetPlugin !== 'function') return input;
  const getPlugin = rawGetPlugin as (pluginId: string) => unknown;
  const jwtPlugin = getPlugin('jwt');
  if (!jwtPlugin || typeof jwtPlugin !== 'object') return input;
  const endpoints = Reflect.get(jwtPlugin, 'endpoints') as unknown;
  if (!endpoints || typeof endpoints !== 'object') return input;
  const rawGetJwks = Reflect.get(endpoints, 'getJwks') as unknown;
  if (typeof rawGetJwks !== 'function') return input;
  const getJwks = rawGetJwks as (input: ProviderEndpointInput) => Promise<unknown>;
  const compatibleJwtPlugin = {
    ...jwtPlugin,
    endpoints: {
      ...endpoints,
      getJwks: (nestedInput: ProviderEndpointInput) =>
        getJwks({ ...nestedInput, asResponse: false, returnHeaders: true }),
    },
  };
  return {
    ...input,
    context: {
      ...context,
      getPlugin: (pluginId: string) =>
        pluginId === 'jwt' ? compatibleJwtPlugin : getPlugin(pluginId),
    },
  };
}

/** Wrap RFC 7009 revocation with provider-exact client authentication and exact-token mutation. */
export function wrapRevokeEndpoint(
  raw: ProviderEndpoint,
  resources: DocketOAuthResources,
): ProviderEndpoint {
  return createAuthEndpoint(raw.path, { ...raw.options, cloneRequest: true }, async (ctx) => {
    ctx.setHeader('Cache-Control', 'no-store');
    ctx.setHeader('Pragma', 'no-cache');
    await rejectRepeatedFields(ctx.request, singletonRevokeFields);
    const body = ctx.body as RevokeBody;
    const clientId = clientIdFromRequest(ctx as unknown as AuthEndpointContext, body);
    if (!clientId) return raw(ctx as unknown as Parameters<ProviderEndpoint>[0]);
    const coordinator = coordinatingAdapter(ctx.context['options']);
    await runWithTransaction(coordinator, async () => {
      const adapter = await getCurrentAdapter(coordinator);
      const transaction = await savepointState.get();
      if (!transaction) oauthServerError();
      await transaction.lockClient(clientId);
      // Probe with an owned opaque token so Better Auth performs its exact client authentication
      // without interpreting or mutating the caller's credential before Docket's exact revoker.
      await authenticateRevokeInSavepoint(
        ctx as unknown as AuthEndpointContext,
        raw,
        adapter,
        body,
      );
      const token = presentedRevocationToken(body);
      await applyExactRevocation(adapter, clientId, token, resources);
    });
    return null;
  });
}

/** Wrap token introspection with the same live checks used by Docket's resource servers. */
export function wrapIntrospectionEndpoint(
  raw: ProviderEndpoint,
  resources: DocketOAuthResources,
): ProviderEndpoint {
  return createAuthEndpoint(raw.path, { ...raw.options, cloneRequest: true }, async (ctx) => {
    ctx.setHeader('Cache-Control', 'no-store');
    ctx.setHeader('Pragma', 'no-cache');
    await rejectRepeatedFields(ctx.request, singletonIntrospectionFields);
    const body = ctx.body as IntrospectionBody;
    const clientId = clientIdFromRequest(ctx as unknown as AuthEndpointContext, body);
    if (!clientId) return raw(ctx as unknown as Parameters<ProviderEndpoint>[0]);
    const coordinator = coordinatingAdapter(ctx.context['options']);
    const response = await runWithTransaction(coordinator, async () => {
      const adapter = await getCurrentAdapter(coordinator);
      const transaction = await savepointState.get();
      if (!transaction) oauthServerError();
      await transaction.lockClient(clientId);
      const providerBody: IntrospectionBody = {
        ...(body.client_id !== undefined ? { client_id: body.client_id } : {}),
        ...(body.client_secret !== undefined ? { client_secret: body.client_secret } : {}),
        ...(body.token !== undefined ? { token: body.token } : {}),
        ...(body.token_type_hint !== undefined ? { token_type_hint: body.token_type_hint } : {}),
      };
      let rawResponse: unknown;
      try {
        rawResponse = await raw(
          introspectionProviderInput(ctx as unknown as AuthEndpointContext, adapter, providerBody),
        );
      } catch (error) {
        if (!isProviderMissingIntrospectionToken(error)) throw error;
        rawResponse = { active: false };
      }
      return liveIntrospectionResult(adapter, body, rawResponse, resources);
    });
    return response;
  });
}
