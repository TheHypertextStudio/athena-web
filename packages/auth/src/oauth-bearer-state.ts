/** Shared observable bearer authorization rules for REST, MCP, and token introspection. */
import {
  OAUTH_CAPABILITY_SCOPES,
  OAUTH_ISSUABLE_SCOPES,
  type OAuthCapabilityScope,
} from '@docket/identity-access/oauth-scope-contract';

import { OAUTH_GRANT_CLAIM } from './oauth-resource-contract';

/** A stored resource grant required by every accepted Docket bearer token. */
export interface OAuthBearerGrantState {
  readonly id: string;
  readonly clientId: string;
  readonly userId: string;
  readonly consentId: string | null;
  readonly authorizationKind: string;
  readonly resourceUri: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly legacyBefore: Date | null;
}

/** Current persistence state used by all Docket bearer authorization surfaces. */
export interface OAuthBearerLiveState<User = unknown> {
  readonly user: User;
  readonly clientId: string;
  readonly clientDisabled: boolean;
  readonly clientSkipConsent: boolean;
  readonly clientScopes: readonly string[];
  readonly clientLegacyBefore: Date | null;
  readonly grant: OAuthBearerGrantState | null;
  readonly consents: readonly {
    readonly id: string;
    readonly referenceId: string | null;
    readonly scopes: readonly string[];
  }[];
  readonly tokenRevoked: boolean;
}

/** Resource-specific constraints checked after cryptographic JWT verification. */
export interface OAuthBearerStateVerification {
  readonly expectedResource: string;
  readonly issuer: string;
  readonly now: Date;
  readonly allowLegacyMcp?: boolean;
  readonly allowTrustedMcp?: boolean;
}

/** The shared live-state validator's opaque failure. */
export class OAuthBearerStateError extends Error {
  constructor() {
    super('invalid_access_token');
    this.name = 'OAuthBearerStateError';
  }
}

function invalidState(): never {
  throw new OAuthBearerStateError();
}

function requiredString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];
  if (typeof value !== 'string' || value.length === 0) invalidState();
  return value;
}

function requiredTime(claims: Record<string, unknown>, key: string): number {
  const value = claims[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalidState();
  return value;
}

interface BearerIdentity {
  readonly userId: string;
  readonly clientId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

function bearerIdentity(
  claims: Record<string, unknown>,
  state: OAuthBearerLiveState,
  verification: OAuthBearerStateVerification,
): BearerIdentity {
  const identity = {
    userId: requiredString(claims, 'sub'),
    clientId: requiredString(claims, 'azp'),
    issuedAt: requiredTime(claims, 'iat'),
    expiresAt: requiredTime(claims, 'exp'),
  };
  const nowSeconds = Math.floor(verification.now.getTime() / 1000);
  const invalid = [
    requiredString(claims, 'iss') !== verification.issuer,
    claims['aud'] !== verification.expectedResource,
    identity.issuedAt > nowSeconds + 60,
    identity.expiresAt <= nowSeconds,
    identity.expiresAt <= identity.issuedAt,
    state.tokenRevoked,
    state.clientDisabled,
    state.clientId !== identity.clientId,
  ];
  if (invalid.includes(true)) invalidState();
  return identity;
}

function currentGrant(
  state: OAuthBearerLiveState,
  identity: BearerIdentity,
  verification: OAuthBearerStateVerification,
): OAuthBearerGrantState {
  const grant = state.grant;
  const invalid = [
    !grant,
    grant?.revokedAt !== null,
    (grant?.expiresAt.getTime() ?? 0) <= verification.now.getTime(),
    grant?.clientId !== identity.clientId,
    grant?.userId !== identity.userId,
  ];
  if (!grant || invalid.includes(true)) invalidState();
  return grant;
}

function validateLegacyGrant(
  grant: OAuthBearerGrantState,
  state: OAuthBearerLiveState,
  identity: BearerIdentity,
  verification: OAuthBearerStateVerification,
): void {
  const invalid = [
    verification.allowLegacyMcp !== true,
    grant.resourceUri !== null && grant.resourceUri !== verification.expectedResource,
    grant.legacyBefore === null,
    state.clientLegacyBefore === null,
  ];
  if (invalid.includes(true) || !grant.legacyBefore || !state.clientLegacyBefore) invalidState();
  const cutoff = Math.min(
    Math.floor(grant.legacyBefore.getTime() / 1000),
    Math.floor(state.clientLegacyBefore.getTime() / 1000),
  );
  if (identity.issuedAt > cutoff || identity.expiresAt - identity.issuedAt > 15 * 60) {
    invalidState();
  }
}

function validateCurrentGrant(
  claims: Record<string, unknown>,
  grant: OAuthBearerGrantState,
  grantClaim: string,
  verification: OAuthBearerStateVerification,
): void {
  requiredString(claims, 'jti');
  const invalid = [
    grant.id !== grantClaim,
    grant.resourceUri !== verification.expectedResource,
    grant.authorizationKind === 'trusted_mcp' && verification.allowTrustedMcp !== true,
  ];
  if (invalid.includes(true)) invalidState();
}

function grantAuthority(
  state: OAuthBearerLiveState,
  grant: OAuthBearerGrantState,
  verification: OAuthBearerStateVerification,
): readonly string[] {
  if (grant.authorizationKind === 'trusted_mcp') {
    if (!state.clientSkipConsent || verification.allowTrustedMcp !== true) invalidState();
    return state.clientScopes;
  }
  const consent = state.consents[0];
  const invalid = [
    grant.authorizationKind !== 'consent',
    grant.consentId === null,
    state.consents.length !== 1,
    consent?.id !== grant.consentId,
    consent?.referenceId !== null,
  ];
  if (!consent || invalid.includes(true)) invalidState();
  return consent.scopes;
}

function grantedScopes(
  claims: Record<string, unknown>,
  clientScopes: readonly string[],
  authority: readonly string[],
): readonly string[] {
  const tokenScopes = new Set(
    (typeof claims['scope'] === 'string' ? claims['scope'] : '')
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
  const client = new Set(clientScopes);
  const authorized = new Set(authority);
  return OAUTH_ISSUABLE_SCOPES.filter(
    (scope) => tokenScopes.has(scope) && client.has(scope) && authorized.has(scope),
  );
}

/** Return the nonempty current capability intersection or reject the token state. */
export function authorizeOAuthBearerState<User>(
  claims: Record<string, unknown>,
  state: OAuthBearerLiveState<User>,
  verification: OAuthBearerStateVerification,
): {
  readonly userId: string;
  readonly clientId: string;
  readonly user: User;
  readonly scopes: readonly OAuthCapabilityScope[];
  readonly grantedScopes: readonly string[];
} {
  const identity = bearerIdentity(claims, state, verification);
  const grant = currentGrant(state, identity, verification);
  const rawGrantClaim = claims[OAUTH_GRANT_CLAIM];
  const grantClaim =
    typeof rawGrantClaim === 'string' && rawGrantClaim.length > 0 ? rawGrantClaim : null;
  if (grantClaim === null) {
    validateLegacyGrant(grant, state, identity, verification);
  } else {
    validateCurrentGrant(claims, grant, grantClaim, verification);
  }

  const authority = grantAuthority(state, grant, verification);
  const granted = grantedScopes(claims, state.clientScopes, authority);
  const grantedSet = new Set<string>(granted);
  const scopes = OAUTH_CAPABILITY_SCOPES.filter((scope) => grantedSet.has(scope));
  if (scopes.length === 0) invalidState();
  return {
    userId: identity.userId,
    clientId: identity.clientId,
    user: state.user,
    scopes,
    grantedScopes: granted,
  };
}
