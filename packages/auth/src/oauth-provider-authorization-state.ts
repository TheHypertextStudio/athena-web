/** Authorization request parsing and standing-consent checks for Docket OAuth. */
import { getOAuthProviderState } from '@better-auth/oauth-provider';
import type { AuthEndpointContext } from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { getOAuthState, getSessionFromCtx } from 'better-auth/api';
import { z } from 'zod';

import { parseAuthorizationResource } from './oauth-resource-contract';
import {
  type AuthorizationRequest,
  type CurrentAuthorizationRequest,
  type DocketOAuthResources,
  type OAuthClientRecord,
  type OAuthConsentRecord,
  type VerificationRecord,
  type VerificationSnapshot,
  delegateTokenToProvider,
  hasCapability,
  oauthError,
  oauthServerError,
  savepointState,
  scopesFrom,
} from './oauth-provider-types';

/** Parse a provider verification row without defaulting a missing stored resource. */
export function parseVerification(
  record: VerificationRecord,
  resources: DocketOAuthResources,
): VerificationSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(record.value);
  } catch {
    return null;
  }
  const schema = z.object({
    type: z.literal('authorization_code'),
    query: z.looseObject({
      client_id: z.string().min(1),
      resource: z.unknown().optional(),
      scope: z.string().optional(),
      redirect_uri: z.string().optional(),
      code_challenge: z.string().optional(),
      code_challenge_method: z.literal('S256').optional(),
    }),
    userId: z.string().min(1),
    sessionId: z.string().min(1),
    referenceId: z.string().nullable().optional(),
    authTime: z.number().optional(),
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const storedResource = parsed.data.query.resource;
  if (typeof storedResource !== 'string') oauthError('invalid_grant');
  let resource: string;
  try {
    resource = parseAuthorizationResource(
      [storedResource],
      resources.mcpResource,
      resources.restResource,
    );
  } catch {
    oauthError('invalid_grant');
  }
  return {
    query: {
      client_id: parsed.data.query.client_id,
      resource,
      ...(parsed.data.query.scope === undefined ? {} : { scope: parsed.data.query.scope }),
      ...(parsed.data.query.redirect_uri === undefined
        ? {}
        : { redirect_uri: parsed.data.query.redirect_uri }),
      ...(parsed.data.query.code_challenge === undefined
        ? {}
        : { code_challenge: parsed.data.query.code_challenge }),
      ...(parsed.data.query.code_challenge_method === undefined
        ? {}
        : { code_challenge_method: parsed.data.query.code_challenge_method }),
    },
    userId: parsed.data.userId,
    sessionId: parsed.data.sessionId,
    ...(parsed.data.referenceId === undefined ? {} : { referenceId: parsed.data.referenceId }),
    ...(parsed.data.authTime === undefined ? {} : { authTime: parsed.data.authTime }),
  };
}

/** Parse the exact client and resource from an authorization query before provider dispatch. */
export function parseCurrentAuthorizationRequest(
  rawQuery: string,
  resources: DocketOAuthResources,
): AuthorizationRequest {
  const query = new URLSearchParams(rawQuery);
  const clientIds = query.getAll('client_id');
  const resourceValues = query.getAll('resource');
  if (clientIds.length > 1) oauthError('invalid_request');
  let resource: string;
  try {
    resource = parseAuthorizationResource(
      resourceValues,
      resources.mcpResource,
      resources.restResource,
    );
  } catch {
    oauthError('invalid_target');
  }
  return { clientId: clientIds[0] ?? '', resource };
}

/** Recover the signed provider or external-login authorization request for a resume endpoint. */
export async function currentAuthorizationRequest(
  resources: DocketOAuthResources,
): Promise<CurrentAuthorizationRequest> {
  const providerQuery = authorizationStateQuery(await getOAuthProviderState());
  const genericQuery = providerQuery ? undefined : authorizationStateQuery(await getOAuthState());
  const rawQuery = providerQuery ?? genericQuery ?? '';
  return {
    request: parseCurrentAuthorizationRequest(rawQuery, resources),
    rawQuery,
  };
}

/** Read the serialized OAuth query from an untrusted Better Auth state value. */
export function authorizationStateQuery(state: unknown): string | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const query = (state as Record<string, unknown>)['query'];
  return typeof query === 'string' ? query : undefined;
}

function assertAuthorizationClient(
  client: OAuthClientRecord,
  request: AuthorizationRequest,
  resources: DocketOAuthResources,
): void {
  if (client.skipConsent === true && request.resource === resources.restResource) {
    oauthError('unauthorized_client');
  }
}

async function assertUnambiguousAuthorizationConsent(
  adapter: DBTransactionAdapter,
  ctx: AuthEndpointContext,
  client: OAuthClientRecord,
): Promise<void> {
  if (client.skipConsent === true) return;
  const session =
    ctx.context.newSession ??
    (await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0]));
  if (!session) return;
  const rows = await adapter.findMany<OAuthConsentRecord>({
    model: 'oauthConsent',
    where: [
      { field: 'clientId', value: client.clientId },
      { field: 'userId', value: session.user.id },
    ],
    limit: 2,
  });
  if (rows.length === 0) return;
  const consent = rows[0];
  if (rows.length !== 1 || consent?.referenceId !== null) {
    oauthError('invalid_grant');
  }
}

/** Reject authorization when client policy or standing human consent is ambiguous. */
export async function assertAuthorizationState(
  adapter: DBTransactionAdapter,
  ctx: AuthEndpointContext,
  client: OAuthClientRecord,
  request: AuthorizationRequest,
  resources: DocketOAuthResources,
): Promise<void> {
  assertAuthorizationClient(client, request, resources);
  await assertUnambiguousAuthorizationConsent(adapter, ctx, client);
}

/** Reject repeated URL-encoded singleton fields before provider parsing loses their multiplicity. */
export async function rejectRepeatedFields(
  request: Request | undefined,
  names: readonly string[],
): Promise<void> {
  if (!request) oauthError('invalid_request');
  let form: FormData;
  try {
    form = new FormData();
    for (const [name, value] of new URLSearchParams(await request.clone().text())) {
      form.append(name, value);
    }
  } catch {
    oauthError('invalid_request');
  }
  for (const name of names) {
    const values = form.getAll(name);
    if (values.length > 1 || values.some((value) => typeof value !== 'string')) {
      oauthError('invalid_request');
    }
  }
}

/** Load exactly one provider row and fail closed when storage is missing or ambiguous. */
export async function loadOne<T>(
  adapter: DBTransactionAdapter,
  model: string,
  where: Parameters<DBTransactionAdapter['findMany']>[0]['where'],
): Promise<T> {
  const rows = await adapter.findMany<T>({ model, where, limit: 2 });
  if (rows.length !== 1 || !rows[0]) oauthError('invalid_grant');
  return rows[0];
}

/** Lock and reload one enabled client inside the active OAuth transaction. */
export async function lockClient(
  adapter: DBTransactionAdapter,
  clientId: string,
): Promise<OAuthClientRecord> {
  const transaction = await savepointState.get();
  if (!transaction) oauthServerError();
  if (!(await transaction.lockClient(clientId))) throw delegateTokenToProvider;
  const client = await loadOne<OAuthClientRecord>(adapter, 'oauthClient', [
    { field: 'clientId', value: clientId },
  ]);
  if (client.disabled === true) throw delegateTokenToProvider;
  return client;
}

/** Load the sole standing non-reference consent for one client and user. */
export async function currentConsent(
  adapter: DBTransactionAdapter,
  clientId: string,
  userId: string,
): Promise<OAuthConsentRecord> {
  const rows = await adapter.findMany<OAuthConsentRecord>({
    model: 'oauthConsent',
    where: [
      { field: 'clientId', value: clientId },
      { field: 'userId', value: userId },
    ],
    limit: 2,
  });
  const consent = rows[0];
  if (rows.length !== 1 || consent?.referenceId !== null) {
    oauthError('invalid_grant');
  }
  return consent;
}

/** Preserve source ordering while intersecting token, client, and live-authority scope sets. */
export function intersectScopes(
  source: readonly string[],
  client: readonly string[],
  authority: readonly string[],
): string[] {
  const clientSet = new Set(client);
  const authoritySet = new Set(authority);
  return source.filter((scope) => clientSet.has(scope) && authoritySet.has(scope));
}

/** Apply an optional refresh narrowing request without permitting scope elevation. */
export function requestedRefreshScopes(
  available: readonly string[],
  requested: string | undefined,
): string[] {
  const requestedValues = scopesFrom(requested);
  if (requestedValues.some((scope) => !available.includes(scope))) oauthError('invalid_scope');
  const result = requested === undefined ? [...available] : requestedValues;
  if (!hasCapability(result)) oauthError('invalid_scope');
  return result;
}
