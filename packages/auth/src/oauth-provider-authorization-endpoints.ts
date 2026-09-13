/** Authorization, consent, continuation, and consent-record endpoint coordination. */
import { randomUUID } from 'node:crypto';

import { getOAuthProviderState } from '@better-auth/oauth-provider';
import {
  getCurrentAdapter,
  runWithAdapter,
  runWithTransaction,
  type AuthEndpointContext,
} from '@better-auth/core/context';
import type { DBAdapter, DBTransactionAdapter } from '@better-auth/core/db/adapter';
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, createAuthMiddleware, getOAuthState } from 'better-auth/api';

import {
  assertAuthorizationState,
  authorizationStateQuery,
  currentAuthorizationRequest,
  loadOne,
  parseCurrentAuthorizationRequest,
} from './oauth-provider-authorization-state';
import { legacyGrantDeadline } from './oauth-lifecycle';
import { coordinatingAdapter, rawInput } from './oauth-provider-transaction';
import {
  type CommittedRedirect,
  type DocketOAuthResources,
  type OAuthClientRecord,
  type OAuthConsentRecord,
  type OAuthGrantRecord,
  type ProviderEndpoint,
  type ProviderInvocationOutcome,
  RollbackProviderInvocation,
  committedRedirectMarker,
  heldClientLockState,
  isNavigationRedirect,
  oauthError,
  oauthServerError,
  providerErrorHeader,
  savepointState,
} from './oauth-provider-types';

function authorizationQuery(rawQuery: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [name, value] of new URLSearchParams(rawQuery)) {
    const existing = query[name];
    if (existing === undefined) query[name] = value;
    else if (typeof existing === 'string') query[name] = [existing, value];
    else existing.push(value);
  }
  return query;
}

function replayProviderOutcome(outcome: ProviderInvocationOutcome): unknown {
  if (outcome.kind === 'threw') throw outcome.error;
  return outcome.value;
}

function redirectUrl(outcome: ProviderInvocationOutcome): string | null {
  if (outcome.kind === 'threw') {
    return isNavigationRedirect(outcome.error)
      ? providerErrorHeader(outcome.error, 'location')
      : null;
  }
  if (!outcome.value || typeof outcome.value !== 'object') return null;
  const value = outcome.value as { readonly redirect?: unknown; readonly url?: unknown };
  return value.redirect === true && typeof value.url === 'string' ? value.url : null;
}

async function probeAuthorization(
  ctx: AuthEndpointContext,
  rawAuthorize: ProviderEndpoint,
  rawQuery: string,
  adapter: DBTransactionAdapter,
): Promise<ProviderInvocationOutcome> {
  const transaction = await savepointState.get();
  if (!transaction) oauthServerError();
  const nestedCoordinator: DBAdapter = {
    ...adapter,
    transaction: transaction.run,
  };
  try {
    await runWithAdapter(nestedCoordinator, async () =>
      runWithTransaction(nestedCoordinator, async () => {
        const nested = await getCurrentAdapter(nestedCoordinator);
        const sourceHeaders: unknown = ctx.headers;
        const headers =
          sourceHeaders instanceof Headers ? new Headers(sourceHeaders) : new Headers();
        headers.set('accept', 'application/json');
        const input = {
          ...rawInput(ctx, nested, {}),
          headers,
          query: authorizationQuery(rawQuery),
        };
        try {
          const value = await rawAuthorize(input);
          throw new RollbackProviderInvocation({ kind: 'returned', value });
        } catch (error) {
          if (error instanceof RollbackProviderInvocation) throw error;
          throw new RollbackProviderInvocation({ kind: 'threw', error });
        }
      }),
    );
  } catch (error) {
    if (error instanceof RollbackProviderInvocation) return error.outcome;
    throw error;
  }
  oauthServerError();
}

function allowsConsentMutation(
  outcome: ProviderInvocationOutcome,
  consentPage: string,
  baseUrl: string,
): boolean {
  const location = redirectUrl(outcome);
  if (!location) return false;
  const target = new URL(location, baseUrl);
  if (target.searchParams.has('error')) return false;
  if (target.searchParams.has('code')) return true;
  const expected = new URL(consentPage, baseUrl);
  return target.origin === expected.origin && target.pathname === expected.pathname;
}

function providerBaseUrl(ctx: Parameters<ProviderEndpoint>[0]): string {
  const baseUrl: unknown = ctx.context?.['baseURL'];
  if (typeof baseUrl !== 'string') oauthServerError();
  return baseUrl;
}

function requireAuthorizationCodeOutcome(raw: ProviderEndpoint): ProviderEndpoint {
  return (async (ctx: Parameters<ProviderEndpoint>[0]) => {
    try {
      const value = await raw(ctx);
      const outcome: ProviderInvocationOutcome = { kind: 'returned', value };
      const location = redirectUrl(outcome);
      if (location && new URL(location, providerBaseUrl(ctx)).searchParams.has('code'))
        return value;
      throw new RollbackProviderInvocation(outcome);
    } catch (error) {
      if (error instanceof RollbackProviderInvocation) throw error;
      const outcome: ProviderInvocationOutcome = { kind: 'threw', error };
      const location = redirectUrl(outcome);
      if (location && new URL(location, providerBaseUrl(ctx)).searchParams.has('code')) throw error;
      throw new RollbackProviderInvocation(outcome);
    }
  }) as ProviderEndpoint;
}

async function invokeWithClientLock(
  ctx: AuthEndpointContext,
  raw: ProviderEndpoint,
  clientId: string,
  beforeInvoke?: (
    adapter: DBTransactionAdapter,
    client: OAuthClientRecord | null,
  ) => Promise<void> | void,
): Promise<unknown> {
  const held = await heldClientLockState.get();
  if (held?.clientId === clientId) {
    const clients = await held.adapter.findMany<OAuthClientRecord>({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: clientId }],
      limit: 2,
    });
    const client = clients.length === 1 ? clients[0] : null;
    await beforeInvoke?.(held.adapter, client ?? null);
    return raw(rawInput(ctx, held.adapter, (ctx.body ?? {}) as Record<string, unknown>));
  }
  const coordinator = coordinatingAdapter(ctx.context.options);
  let outcome: { readonly value: unknown } | CommittedRedirect;
  try {
    outcome = await runWithTransaction(coordinator, async () => {
      const adapter = await getCurrentAdapter(coordinator);
      const transaction = await savepointState.get();
      if (!transaction) oauthServerError();
      const exists = await transaction.lockClient(clientId);
      const client = exists
        ? await loadOne<OAuthClientRecord>(adapter, 'oauthClient', [
            { field: 'clientId', value: clientId },
          ])
        : null;
      await beforeInvoke?.(adapter, client);
      const previous = await heldClientLockState.get();
      await heldClientLockState.set({ clientId, adapter });
      try {
        try {
          return {
            value: await raw(rawInput(ctx, adapter, (ctx.body ?? {}) as Record<string, unknown>)),
          };
        } catch (error) {
          if (!isNavigationRedirect(error)) throw error;
          return { [committedRedirectMarker]: true, error } satisfies CommittedRedirect;
        }
      } finally {
        await heldClientLockState.set(previous);
      }
    });
  } catch (error) {
    if (error instanceof RollbackProviderInvocation) {
      return replayProviderOutcome(error.outcome);
    }
    throw error;
  }
  if (committedRedirectMarker in outcome) throw outcome.error;
  return outcome.value;
}

/** Wrap initial authorization with resource policy and a transaction-held client lock. */
export function wrapAuthorizeEndpoint(
  raw: ProviderEndpoint,
  resources: DocketOAuthResources,
): ProviderEndpoint {
  return createAuthEndpoint(raw.path, raw.options, async (ctx) => {
    const query = ctx.query as Record<string, unknown>;
    const clientId = typeof query['client_id'] === 'string' ? query['client_id'] : '';
    const resource = typeof query['resource'] === 'string' ? query['resource'] : '';
    if (resource !== resources.mcpResource && resource !== resources.restResource) {
      oauthError('invalid_request');
    }
    return invokeWithClientLock(
      ctx as unknown as AuthEndpointContext,
      raw,
      clientId,
      (adapter, client) => {
        if (!client || client.disabled === true) return;
        return assertAuthorizationState(
          adapter,
          ctx as unknown as AuthEndpointContext,
          client,
          { clientId, resource },
          resources,
        );
      },
    );
  });
}

/** Keep accepted consent and downstream code issuance atomic under the client lock. */
export function wrapConsentEndpoint(
  raw: ProviderEndpoint,
  rawAuthorize: ProviderEndpoint,
  resources: DocketOAuthResources,
  consentPage: string,
): ProviderEndpoint {
  return createAuthEndpoint(raw.path, raw.options, async (ctx) => {
    const body = ctx.body as { readonly accept?: boolean };
    if (body.accept !== true) {
      return raw(
        rawInput(ctx as unknown as AuthEndpointContext, ctx.context['adapter'] as DBAdapter, body),
      );
    }
    const current = await currentAuthorizationRequest(resources);
    return invokeWithClientLock(
      ctx as unknown as AuthEndpointContext,
      requireAuthorizationCodeOutcome(raw),
      current.request.clientId,
      async (adapter, client) => {
        const providerOutcome = await probeAuthorization(
          ctx as unknown as AuthEndpointContext,
          rawAuthorize,
          current.rawQuery,
          adapter,
        );
        if (
          !allowsConsentMutation(
            providerOutcome,
            consentPage,
            providerBaseUrl(ctx as unknown as AuthEndpointContext),
          )
        ) {
          throw new RollbackProviderInvocation(providerOutcome);
        }
        if (!client || client.disabled === true) {
          oauthError('invalid_grant');
        }
        await assertAuthorizationState(
          adapter,
          ctx as unknown as AuthEndpointContext,
          client,
          current.request,
          resources,
        );
      },
    );
  });
}

/** Recheck client and consent policy after account-selection or post-login continuation. */
export function wrapContinueEndpoint(
  raw: ProviderEndpoint,
  resources: DocketOAuthResources,
): ProviderEndpoint {
  return createAuthEndpoint(raw.path, raw.options, async (ctx) => {
    const body = ctx.body as {
      readonly created?: boolean;
      readonly postLogin?: boolean;
      readonly selected?: boolean;
    };
    if (body.created !== true && body.postLogin !== true && body.selected !== true) {
      return raw(
        rawInput(ctx as unknown as AuthEndpointContext, ctx.context['adapter'] as DBAdapter, body),
      );
    }
    const current = await currentAuthorizationRequest(resources);
    return invokeWithClientLock(
      ctx as unknown as AuthEndpointContext,
      raw,
      current.request.clientId,
      (adapter, client) => {
        if (!client || client.disabled === true) return;
        return assertAuthorizationState(
          adapter,
          ctx as unknown as AuthEndpointContext,
          client,
          current.request,
          resources,
        );
      },
    );
  });
}

/** Replace the provider's one post-login hook while retaining its matcher and invocation count. */
export function wrapPostLoginAuthorizeHook(
  plugin: BetterAuthPlugin,
  resources: DocketOAuthResources,
): void {
  const hooks = plugin.hooks?.after;
  const original = hooks?.[0];
  if (hooks?.length !== 1 || !original) {
    throw new Error('The installed OAuth provider post-login hook shape changed.');
  }
  const raw = original.handler as unknown as ProviderEndpoint;
  hooks[0] = {
    ...original,
    handler: createAuthMiddleware(async (ctx) => {
      const providerQuery = authorizationStateQuery(await getOAuthProviderState());
      const genericQuery = providerQuery
        ? undefined
        : authorizationStateQuery(await getOAuthState());
      const rawQuery = providerQuery ?? genericQuery;
      if (!rawQuery) return raw(ctx as Parameters<ProviderEndpoint>[0]);
      const request = parseCurrentAuthorizationRequest(rawQuery, resources);
      return invokeWithClientLock(
        ctx as unknown as AuthEndpointContext,
        raw,
        request.clientId,
        (adapter, client) => {
          if (!client || client.disabled === true) return;
          return assertAuthorizationState(
            adapter,
            ctx as unknown as AuthEndpointContext,
            client,
            request,
            resources,
          );
        },
      );
    }),
  };
}

async function invalidateDeletedConsent(
  adapter: DBTransactionAdapter,
  client: OAuthClientRecord,
  consent: OAuthConsentRecord,
): Promise<void> {
  if (!consent.userId) return;
  const now = new Date();
  await adapter.updateMany({
    model: 'oauthResourceGrant',
    where: [
      { field: 'clientId', value: consent.clientId },
      { field: 'userId', value: consent.userId },
      { field: 'revokedAt', value: null },
    ],
    update: { revokedAt: now },
  });
  await adapter.updateMany({
    model: 'oauthRefreshToken',
    where: [
      { field: 'clientId', value: consent.clientId },
      { field: 'userId', value: consent.userId },
      { field: 'revoked', value: null },
    ],
    update: { revoked: now },
  });
  await adapter.deleteMany({
    model: 'oauthAccessToken',
    where: [
      { field: 'clientId', value: consent.clientId },
      { field: 'userId', value: consent.userId },
    ],
  });

  if (client.docketLegacyTrusted !== true || client.docketLegacyBefore == null) return;
  const legacyRows = await adapter.findMany<OAuthGrantRecord>({
    model: 'oauthResourceGrant',
    where: [
      { field: 'clientId', value: consent.clientId },
      { field: 'userId', value: consent.userId },
      { field: 'legacyBefore', operator: 'ne', value: null },
    ],
    limit: 2,
  });
  if (legacyRows.length !== 0) return;
  const deadline = legacyGrantDeadline(client.docketLegacyBefore);
  if (deadline.getTime() <= now.getTime()) return;
  await adapter.create({
    model: 'oauthResourceGrant',
    forceAllowId: true,
    data: {
      id: randomUUID(),
      clientId: consent.clientId,
      userId: consent.userId,
      consentId: null,
      authorizationKind: 'trusted_mcp',
      resourceUri: null,
      createdAt: now,
      expiresAt: deadline,
      revokedAt: now,
      legacyBefore: client.docketLegacyBefore,
    },
  });
}

/** Serialize consent record mutation and optionally revoke its complete credential family. */
export function wrapConsentRecordEndpoint(
  raw: ProviderEndpoint,
  revokeRelationship: boolean,
): ProviderEndpoint {
  return createAuthEndpoint(raw.path, raw.options, async (ctx) => {
    const body = ctx.body as { readonly id?: string };
    if (!body.id) return raw(ctx as unknown as Parameters<ProviderEndpoint>[0]);
    const consentId = body.id;
    const coordinator = coordinatingAdapter(ctx.context['options']);
    return runWithTransaction(coordinator, async () => {
      const adapter = await getCurrentAdapter(coordinator);
      const snapshots = await adapter.findMany<OAuthConsentRecord>({
        model: 'oauthConsent',
        where: [{ field: 'id', value: consentId }],
        limit: 2,
      });
      const snapshot = snapshots.length === 1 ? snapshots[0] : null;
      if (!snapshot) {
        return raw(rawInput(ctx as unknown as AuthEndpointContext, adapter, body));
      }
      const transaction = await savepointState.get();
      if (!transaction) oauthServerError();
      await transaction.lockClient(snapshot.clientId);
      const lockedConsents = await adapter.findMany<OAuthConsentRecord>({
        model: 'oauthConsent',
        where: [
          { field: 'id', value: consentId },
          { field: 'clientId', value: snapshot.clientId },
        ],
        limit: 2,
      });
      if (lockedConsents.length === 0) {
        return raw(rawInput(ctx as unknown as AuthEndpointContext, adapter, body));
      }
      if (lockedConsents.length !== 1) oauthError('invalid_grant');
      const consent = lockedConsents[0];
      if (!consent) oauthError('invalid_grant');
      const client = await loadOne<OAuthClientRecord>(adapter, 'oauthClient', [
        { field: 'clientId', value: consent.clientId },
      ]);
      const response = await raw(rawInput(ctx as unknown as AuthEndpointContext, adapter, body));
      if (revokeRelationship) await invalidateDeletedConsent(adapter, client, consent);
      return response;
    });
  });
}
