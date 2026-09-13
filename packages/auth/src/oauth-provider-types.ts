/** Shared types and invariants for Docket's OAuth provider composition. */
import { defineRequestState } from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import {
  account,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthJwtRevocation,
  oauthRefreshToken,
  oauthResourceGrant,
  passkey,
  rateLimit,
  session,
  twoFactor,
  user,
  verification,
} from '@docket/db';
import { OAUTH_CAPABILITY_SCOPES } from '@docket/identity-access/oauth-scope-contract';
import type { createAuthEndpoint } from 'better-auth/api';
import { APIError, type AuthEndpoint } from 'better-auth/api';

import { resolveTokenResource } from './oauth-resource-contract';

/** The two exact protected resources served by one Docket authorization server. */
export interface DocketOAuthResources {
  readonly issuer: string;
  readonly mcpResource: string;
  readonly restResource: string;
}

/** The one Drizzle schema used by Better Auth and Docket's endpoint coordinator. */
export const DOCKET_AUTH_DATABASE_SCHEMA = {
  user,
  session,
  account,
  verification,
  passkey,
  twoFactor,
  rateLimit,
  oauthClient,
  oauthAccessToken,
  oauthRefreshToken,
  oauthConsent,
  oauthResourceGrant,
  oauthJwtRevocation,
  jwks,
};

type ProviderEndpointOptions = Parameters<typeof createAuthEndpoint>[0];
type BaseProviderEndpoint = AuthEndpoint<string, ProviderEndpointOptions, unknown>;

/** The normalized context accepted by an installed Better Auth provider endpoint. */
export type ProviderEndpointInput = NonNullable<Parameters<BaseProviderEndpoint>[0]>;
/** A provider endpoint whose public metadata must survive Docket's wrapper. */
export type ProviderEndpoint = ((context: ProviderEndpointInput) => Promise<unknown>) &
  Pick<BaseProviderEndpoint, 'options' | 'path'>;

/** Fields accepted by the provider token endpoint before Docket applies grant semantics. */
export interface TokenBody {
  readonly grant_type: 'authorization_code' | 'client_credentials' | 'refresh_token';
  readonly client_id?: string;
  readonly client_secret?: string;
  readonly code?: string;
  readonly code_verifier?: string;
  readonly redirect_uri?: string;
  readonly refresh_token?: string;
  readonly resource?: string;
  readonly scope?: string;
}

/** Fields accepted by provider revocation and introspection endpoints. */
export interface RevokeBody {
  readonly client_id?: string;
  readonly client_secret?: string;
  readonly token?: string;
  readonly token_type_hint?: string;
}

/** The shared form body used by OAuth token introspection. */
export type IntrospectionBody = RevokeBody;

/** The stored Better Auth verification row that carries an authorization code. */
export interface VerificationRecord {
  readonly identifier: string;
  readonly value: string;
  readonly expiresAt: Date;
}

/** Immutable authorization facts recovered from a stored code before exchange. */
export interface VerificationSnapshot {
  readonly query: {
    readonly client_id: string;
    readonly resource: string;
    readonly scope?: string;
    readonly redirect_uri?: string;
    readonly code_challenge?: string;
    readonly code_challenge_method?: 'S256';
  };
  readonly userId: string;
  readonly sessionId: string;
  readonly referenceId?: string | null;
  readonly authTime?: number;
}

/** The client and protected resource selected by one authorization request. */
export interface AuthorizationRequest {
  readonly clientId: string;
  readonly resource: string;
}

/** A signed authorization request plus its original serialized query. */
export interface CurrentAuthorizationRequest {
  readonly request: AuthorizationRequest;
  readonly rawQuery: string;
}

/** Provider client fields needed for authorization and live grant decisions. */
export interface OAuthClientRecord {
  readonly clientId: string;
  readonly disabled?: boolean | null;
  readonly skipConsent?: boolean | null;
  readonly scopes?: readonly string[] | null;
  readonly docketLegacyBefore?: Date | null;
  readonly docketLegacyTrusted?: boolean | null;
}

/** Provider consent fields needed to establish current human authority. */
export interface OAuthConsentRecord {
  readonly id: string;
  readonly clientId: string;
  readonly userId: string | null;
  readonly referenceId: string | null;
  readonly scopes: readonly string[];
}

/** Provider refresh-token fields used to bind and rotate one grant family. */
export interface OAuthRefreshRecord {
  readonly id: string;
  readonly token: string;
  readonly clientId: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly createdAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revoked: Date | null;
  readonly referenceId: string | null;
  readonly docketGrantId: string | null;
}

/** Docket's durable protected-resource grant for one authorization ceremony. */
export interface OAuthGrantRecord {
  readonly id: string;
  readonly clientId: string;
  readonly userId: string;
  readonly consentId: string | null;
  readonly authorizationKind: 'consent' | 'trusted_mcp';
  readonly resourceUri: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly legacyBefore: Date | null;
}

/** Stored signing-key fields needed for local JWT verification. */
export interface OAuthJwksRecord {
  readonly id: string;
  readonly publicKey: string;
  readonly alg?: string | null;
  readonly crv?: string | null;
  readonly expiresAt?: Date | null;
}

/** The successful credential body returned by the provider token endpoint. */
export interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string | undefined;
  readonly scope: string;
}

/** Request-local authority that every credential minted in one transaction must match. */
export interface IssuanceState {
  readonly kind: 'authorization_code' | 'refresh_token';
  readonly clientId: string;
  readonly userId: string;
  readonly resource: string;
  readonly grantId: string;
  readonly verificationIdentifier?: string;
  readonly verificationSnapshot?: VerificationSnapshot;
}

/** A token request that Docket validated and can pass to the provider for issuance. */
export interface PreparedIssuance {
  readonly kind: 'issue';
  readonly body: TokenBody;
  readonly state: IssuanceState;
  readonly codeGrant?: AuthorizationCodeGrantContext;
}

/** Stored code and lifetime inputs needed to materialize a grant after provider validation. */
export interface AuthorizationCodeGrantContext {
  readonly snapshot: VerificationSnapshot;
  readonly client: OAuthClientRecord;
  readonly requestedResource?: string;
  readonly resources: DocketOAuthResources;
  readonly refreshLifetimeSeconds: number;
  readonly accessLifetimeSeconds: number;
}

/** A spent refresh credential whose family must be revoked after client authentication. */
export interface RejectedStaleRefresh {
  readonly kind: 'stale-refresh';
  readonly refresh: OAuthRefreshRecord;
}

/** A code exchange delegated to the provider so its original validation error is preserved. */
export interface DelegatedAuthorizationCode {
  readonly kind: 'delegate-authorization-code';
  readonly body: TokenBody;
  readonly verificationIdentifier: string;
}

/** Every refresh request outcome decided before the provider runs. */
export type RefreshPreparation = PreparedIssuance | RejectedStaleRefresh;
/** Every supported token request outcome decided before the provider runs. */
export type TokenPreparation = RefreshPreparation | DelegatedAuthorizationCode;

/** The exact stored refresh credential observed before client authentication and rotation. */
export interface RefreshSnapshot {
  readonly digest: string;
  readonly record: OAuthRefreshRecord;
}

/** Transaction operations that must use the active Drizzle savepoint or row lock. */
export interface SavepointHandle {
  readonly run: <T>(callback: (adapter: DBTransactionAdapter) => Promise<T>) => Promise<T>;
  readonly lockClient: (clientId: string) => Promise<boolean>;
  readonly recordJwtRevocation: (record: {
    readonly tokenDigest: string;
    readonly expiresAt: Date;
    readonly revokedAt: Date;
  }) => Promise<void>;
}

/** The request-local client lock shared by nested authorization callbacks. */
export interface HeldClientLock {
  readonly clientId: string;
  readonly adapter: DBTransactionAdapter;
}

/** Authority reserved for the credentials being minted by the current provider request. */
export const issuanceState = defineRequestState<IssuanceState | null>(() => null);
/** Whether provider validation reached credential creation after consuming a code. */
export const codeIssuanceReachedState = defineRequestState<boolean>(() => false);
/** The active transaction's savepoint, lock, and denylist operations. */
export const savepointState = defineRequestState<SavepointHandle | null>(() => null);
/** The client lock retained while a nested authorization callback runs. */
export const heldClientLockState = defineRequestState<HeldClientLock | null>(() => null);
/** Internal sentinel that preserves the installed provider's code-validation behavior. */
export const delegateTokenToProvider = new Error('Delegate this token request to Better Auth.');
/** Marker for a navigation redirect that the coordinator committed before rethrowing. */
export const committedRedirectMarker = Symbol('docket-committed-oauth-redirect');
/** Marker for a provider token error whose required code consumption already committed. */
export const committedTokenErrorMarker = Symbol('docket-committed-oauth-token-error');

/** A provider result captured inside a rollback-only probe. */
export type ProviderInvocationOutcome =
  | { readonly kind: 'returned'; readonly value: unknown }
  | { readonly kind: 'threw'; readonly error: unknown };

/** Sentinel that carries a provider result out of a transaction that must roll back. */
export class RollbackProviderInvocation extends Error {
  readonly outcome: ProviderInvocationOutcome;

  constructor(outcome: ProviderInvocationOutcome) {
    super('Roll back the provider invocation before preserving its result.');
    this.outcome = outcome;
  }
}

/** A redirect result committed inside the transaction and rethrown after commit. */
export interface CommittedRedirect {
  readonly [committedRedirectMarker]: true;
  readonly error: APIError;
}

/** A token error committed only to preserve one-time authorization-code consumption. */
export interface CommittedTokenError {
  readonly [committedTokenErrorMarker]: true;
  readonly error: Error;
}

/** Test whether a provider exception represents a browser navigation redirect. */
export function isNavigationRedirect(error: unknown): error is APIError {
  const candidate = error as Partial<APIError> | null;
  return (
    error instanceof Error &&
    candidate?.status === 'FOUND' &&
    candidate.statusCode === 302 &&
    providerErrorHeader(candidate, 'location') !== null
  );
}

/** Read one string header from an upstream API error without trusting its untyped header field. */
export function providerErrorHeader(error: Partial<APIError>, name: string): string | null {
  const rawHeaders: unknown = error.headers;
  if (rawHeaders instanceof Headers) return rawHeaders.get(name);
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) return null;
  const value = (rawHeaders as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

/** Test whether a revoke probe reached token lookup after successful client authentication. */
export function isProviderTokenFailureAfterAuthentication(error: unknown): boolean {
  const candidate = error as Partial<APIError> | null;
  const body = candidate?.body as Record<string, unknown> | undefined;
  return candidate?.statusCode === 400 && body?.['error'] === 'invalid_request';
}

/** Test whether introspection authenticated the client but could not resolve a token. */
export function isProviderMissingIntrospectionToken(error: unknown): boolean {
  const candidate = error as Partial<APIError> | null;
  const body = candidate?.body as Record<string, unknown> | undefined;
  return candidate?.statusCode === 400 && body?.['error'] === 'invalid_token';
}

/** Form fields that must occur at most once on token requests. */
export const singletonTokenFields = [
  'grant_type',
  'client_id',
  'client_secret',
  'code',
  'code_verifier',
  'redirect_uri',
  'refresh_token',
  'resource',
  'scope',
] as const;

/** Form fields that must occur at most once on revocation requests. */
export const singletonRevokeFields = [
  'client_id',
  'client_secret',
  'token',
  'token_type_hint',
] as const;

/** Form fields that must occur at most once on introspection requests. */
export const singletonIntrospectionFields = singletonRevokeFields;

/** Throw a stable client-facing OAuth protocol failure without provider diagnostics. */
export function oauthError(
  error:
    | 'invalid_grant'
    | 'invalid_request'
    | 'invalid_scope'
    | 'invalid_target'
    | 'unauthorized_client',
): never {
  throw new APIError('BAD_REQUEST', {
    error,
    error_description: 'The OAuth request is not valid.',
  });
}

/** Throw the stable OAuth error for an authorization-server invariant failure. */
export function oauthServerError(): never {
  throw new APIError('INTERNAL_SERVER_ERROR', {
    error: 'server_error',
    error_description: 'The authorization server could not complete the request.',
  });
}

/** Split a space-delimited OAuth scope value into its nonempty wire tokens. */
export function scopesFrom(value: string | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

/** Test whether a scope set grants at least one Docket resource capability. */
export function hasCapability(scopes: readonly string[]): boolean {
  const known = new Set<string>(OAUTH_CAPABILITY_SCOPES);
  return scopes.some((scope) => known.has(scope));
}

/** Resolve a token request against the exact resource stored by its grant family. */
export function exactResource(
  requested: string | undefined,
  bound: string | null | undefined,
  resources: DocketOAuthResources,
): string {
  try {
    return resolveTokenResource(requested, bound, resources.mcpResource, resources.restResource);
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_target') oauthError('invalid_target');
    oauthError('invalid_grant');
  }
}
