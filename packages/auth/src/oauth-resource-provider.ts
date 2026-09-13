/**
 * Docket's resource-bound composition around Better Auth's OAuth provider.
 */
import { randomUUID } from 'node:crypto';

import { type OAuthOptions, type StoreTokenType, oauthProvider } from '@better-auth/oauth-provider';
import type { BetterAuthPlugin } from 'better-auth';
import { z } from 'zod';

import {
  wrapAuthorizeEndpoint,
  wrapConsentEndpoint,
  wrapConsentRecordEndpoint,
  wrapContinueEndpoint,
  wrapPostLoginAuthorizeHook,
} from './oauth-provider-authorization-endpoints';
import {
  wrapIntrospectionEndpoint,
  wrapRevokeEndpoint,
  wrapTokenEndpoint,
} from './oauth-provider-token-endpoints';
import {
  type DocketOAuthResources,
  type IssuanceState,
  type ProviderEndpoint,
  type VerificationSnapshot,
  codeIssuanceReachedState,
  issuanceState,
  oauthError,
  oauthServerError,
} from './oauth-provider-types';
import {
  hashOAuthToken,
  OAUTH_GRANT_CLAIM,
  parseAuthorizationResource,
} from './oauth-resource-contract';

/** Create the transaction-capable Better Auth database adapter used by Docket. */
export { createDocketAuthDatabase } from './oauth-provider-transaction';
/** The complete schema shared by Better Auth and Docket's OAuth coordinator. */
export { DOCKET_AUTH_DATABASE_SCHEMA } from './oauth-provider-types';
/** Canonical issuer and protected-resource identities supplied to the provider wrapper. */
export type { DocketOAuthResources } from './oauth-provider-types';
function extendAuthorizeResource(
  endpoint: ProviderEndpoint,
  resources: DocketOAuthResources,
): void {
  const query = endpoint.options.query;
  if (!(query instanceof z.ZodObject)) {
    throw new Error('The installed OAuth provider authorize schema is not a Zod object.');
  }
  endpoint.options.query = query.extend({
    resource: z
      .enum([resources.mcpResource, resources.restResource])
      .default(resources.mcpResource),
  });
}

function extendProviderSchema(plugin: BetterAuthPlugin): void {
  const schema = plugin.schema;
  if (!schema?.['oauthClient'] || !schema['oauthRefreshToken']) {
    throw new Error('The installed OAuth provider schema is missing required models.');
  }
  schema['oauthClient'].fields['docketLegacyBefore'] = { type: 'date', required: false };
  schema['oauthClient'].fields['docketLegacyTrusted'] = {
    type: 'boolean',
    required: true,
    defaultValue: false,
  };
  schema['oauthRefreshToken'].fields['docketGrantId'] = { type: 'string', required: false };
  schema['oauthResourceGrant'] = {
    modelName: 'oauthResourceGrant',
    disableMigration: true,
    fields: {
      clientId: { type: 'string', required: true },
      userId: { type: 'string', required: true },
      consentId: { type: 'string', required: false },
      authorizationKind: { type: 'string', required: true },
      resourceUri: { type: 'string', required: false },
      createdAt: { type: 'date', required: true },
      expiresAt: { type: 'date', required: true },
      revokedAt: { type: 'date', required: false },
      legacyBefore: { type: 'date', required: false },
    },
  };
  schema['oauthJwtRevocation'] = {
    modelName: 'oauthJwtRevocation',
    disableMigration: true,
    fields: {
      tokenDigest: { type: 'string', required: true },
      expiresAt: { type: 'date', required: true },
      revokedAt: { type: 'date', required: true },
    },
  };
}

const verifiedIssuanceSchema = z.looseObject({
  query: z.looseObject({
    client_id: z.string(),
    resource: z.unknown().optional(),
    scope: z.string().optional(),
    redirect_uri: z.string().optional(),
    code_challenge: z.string().optional(),
    code_challenge_method: z.literal('S256').optional(),
  }),
  userId: z.string(),
  sessionId: z.string(),
  referenceId: z.string().nullable().optional(),
  authTime: z.number().optional(),
});

function verifiedResource(value: unknown, resources: DocketOAuthResources): string {
  if (typeof value !== 'string') oauthError('invalid_grant');
  try {
    return parseAuthorizationResource([value], resources.mcpResource, resources.restResource);
  } catch {
    oauthError('invalid_grant');
  }
}

function sameOptional(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

function verificationMatches(
  actual: z.infer<typeof verifiedIssuanceSchema>,
  resource: string,
  state: IssuanceState,
  expected: VerificationSnapshot,
): boolean {
  return ![
    actual.referenceId != null,
    actual.query.client_id !== state.clientId,
    actual.userId !== state.userId,
    resource !== state.resource,
    actual.query.client_id !== expected.query.client_id,
    resource !== expected.query.resource,
    !sameOptional(actual.query.scope, expected.query.scope),
    !sameOptional(actual.query.redirect_uri, expected.query.redirect_uri),
    !sameOptional(actual.query.code_challenge, expected.query.code_challenge),
    !sameOptional(actual.query.code_challenge_method, expected.query.code_challenge_method),
    actual.sessionId !== expected.sessionId,
    !sameOptional(actual.referenceId, expected.referenceId),
    !sameOptional(actual.authTime, expected.authTime),
  ].includes(true);
}

function verifiedIssuanceState(
  verificationValue: unknown,
  state: IssuanceState,
  resources: DocketOAuthResources,
): void {
  if (state.kind !== 'authorization_code') return;
  const parsed = verifiedIssuanceSchema.safeParse(verificationValue);
  if (!parsed.success) oauthError('invalid_grant');
  const snapshot = state.verificationSnapshot;
  const resource = verifiedResource(parsed.data.query.resource, resources);
  if (!snapshot || !verificationMatches(parsed.data, resource, state, snapshot)) {
    oauthError('invalid_grant');
  }
}

function requiredProviderEndpoint(plugin: BetterAuthPlugin, key: string): ProviderEndpoint {
  const endpoint = plugin.endpoints?.[key];
  if (!endpoint) throw new Error(`The installed OAuth provider is missing ${key}.`);
  return endpoint;
}

/**
 * Compose Better Auth's provider with exact resource persistence and transactional issuance.
 */
export function createDocketOAuthProvider(
  options: OAuthOptions<string[]>,
  resources: DocketOAuthResources,
): BetterAuthPlugin {
  const accessLifetimeSeconds = options.accessTokenExpiresIn ?? 60 * 15;
  const refreshLifetimeSeconds = options.refreshTokenExpiresIn ?? 60 * 60 * 24 * 30;
  const suppliedClaims = options.customAccessTokenClaims;
  const suppliedFields = options.customTokenResponseFields;
  const plugin: BetterAuthPlugin = oauthProvider({
    ...options,
    validAudiences: [resources.mcpResource, resources.restResource],
    storeTokens: {
      hash: (token: string, _type: StoreTokenType) => hashOAuthToken(token),
    },
    customTokenResponseFields: async (info) => {
      if (info.grantType === 'authorization_code') await codeIssuanceReachedState.set(true);
      const state = await issuanceState.get();
      if (!state) oauthServerError();
      verifiedIssuanceState(info.verificationValue, state, resources);
      return suppliedFields ? suppliedFields(info) : {};
    },
    customAccessTokenClaims: async (info) => {
      const state = await issuanceState.get();
      if (!state || info.resource !== state.resource || info.user?.id !== state.userId) {
        oauthServerError();
      }
      const extra = suppliedClaims ? await suppliedClaims(info) : {};
      return { ...extra, [OAUTH_GRANT_CLAIM]: state.grantId, jti: randomUUID() };
    },
  });
  const endpoints = plugin.endpoints;
  if (!endpoints) throw new Error('The installed OAuth provider is missing endpoints.');
  const authorize = requiredProviderEndpoint(plugin, 'oauth2Authorize');
  const consent = requiredProviderEndpoint(plugin, 'oauth2Consent');
  const continueAuthorization = requiredProviderEndpoint(plugin, 'oauth2Continue');
  const token = requiredProviderEndpoint(plugin, 'oauth2Token');
  const introspect = requiredProviderEndpoint(plugin, 'oauth2Introspect');
  const revoke = requiredProviderEndpoint(plugin, 'oauth2Revoke');
  const updateConsent = requiredProviderEndpoint(plugin, 'updateOAuthConsent');
  const deleteConsent = requiredProviderEndpoint(plugin, 'deleteOAuthConsent');
  extendAuthorizeResource(authorize, resources);
  wrapPostLoginAuthorizeHook(plugin, resources);
  endpoints['oauth2Authorize'] = wrapAuthorizeEndpoint(authorize, resources);
  endpoints['oauth2Consent'] = wrapConsentEndpoint(
    consent,
    authorize,
    resources,
    options.consentPage,
  );
  endpoints['oauth2Continue'] = wrapContinueEndpoint(continueAuthorization, resources);
  endpoints['oauth2Token'] = wrapTokenEndpoint(
    token,
    revoke,
    resources,
    accessLifetimeSeconds,
    refreshLifetimeSeconds,
  );
  endpoints['oauth2Introspect'] = wrapIntrospectionEndpoint(introspect, resources);
  endpoints['oauth2Revoke'] = wrapRevokeEndpoint(revoke, resources);
  endpoints['updateOAuthConsent'] = wrapConsentRecordEndpoint(updateConsent, false);
  endpoints['deleteOAuthConsent'] = wrapConsentRecordEndpoint(deleteConsent, true);
  extendProviderSchema(plugin);
  return plugin;
}
