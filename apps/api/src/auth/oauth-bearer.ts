/**
 * `@docket/api` — shared live OAuth bearer verification for REST and MCP resources.
 */
import {
  authorizeOAuthBearerState,
  effectiveOAuthClientScopes,
  ensureTrustedLegacyMcpGrant,
  hashOAuthToken,
  OAUTH_GRANT_CLAIM,
  verifyAccessToken,
  type OAuthBearerGrantState as SharedOAuthBearerGrantState,
  type OAuthBearerLiveState as SharedOAuthBearerLiveState,
} from '@docket/auth';
import {
  db,
  oauthClient,
  oauthConsent,
  oauthJwtRevocation,
  oauthResourceGrant,
  user as userTable,
} from '@docket/db';
import { and, eq, isNotNull } from 'drizzle-orm';

import type { AuthUser, CallerPrincipal } from '../context';
import { env } from '../env';

export { OAUTH_GRANT_CLAIM };

/** A stored resource grant required by the live bearer check. */
export type OAuthBearerGrantState = SharedOAuthBearerGrantState;

/**
 * The current database state used to decide whether a signed token still grants access.
 *
 * @remarks
 * `clientName` is the display name the client registered with. It plays no part in authorization;
 * it rides along because the client row is already loaded, and provenance names the client by it.
 */
export type OAuthBearerLiveState = SharedOAuthBearerLiveState<AuthUser> & {
  readonly clientName?: string | null;
};

/** Inputs a live-state adapter needs after cryptographic claims have been checked. */
export interface OAuthBearerStateLookup {
  readonly tokenDigest: string;
  readonly userId: string;
  readonly clientId: string;
  readonly grantId: string | null;
}

/** Replaceable cryptographic and persistence ports used by verifier behavior tests. */
export interface OAuthBearerDependencies {
  /** Verify signature and registered JWT constraints against the authorization server. */
  readonly verifyToken: (
    token: string,
    options: {
      readonly issuer: string;
      readonly audience: string;
      readonly jwksUrl: string;
    },
  ) => Promise<Record<string, unknown>>;
  /** Load current user, client, grant, consent, and denylist state. */
  readonly loadLiveState: (lookup: OAuthBearerStateLookup) => Promise<OAuthBearerLiveState | null>;
  /** Materialize an eligible pre-cutover trusted MCP grant under the client row lock. */
  readonly ensureLegacyGrant?: (input: {
    readonly lookup: OAuthBearerStateLookup;
    readonly issuedAtSeconds: number;
    readonly expiresAtSeconds: number;
    readonly expectedResource: string;
    readonly now: Date;
  }) => Promise<boolean>;
}

/** Resource-specific constraints applied after signature verification. */
export interface OAuthBearerVerification {
  readonly expectedResource: string;
  readonly issuer: string;
  readonly now?: Date;
  readonly allowLegacyMcp?: boolean;
  readonly allowTrustedMcp?: boolean;
}

interface VerifiedBearerToken {
  readonly claims: Record<string, unknown>;
  readonly userId: string;
  readonly clientId: string;
  readonly grantId: string | null;
  readonly issuedAtSeconds: number;
  readonly expiresAtSeconds: number;
  readonly now: Date;
}

/** A deliberately opaque bearer failure that never carries provider diagnostics to callers. */
export class OAuthBearerError extends Error {
  constructor() {
    super('invalid_access_token');
    this.name = 'OAuthBearerError';
  }
}

function invalidToken(): never {
  throw new OAuthBearerError();
}

function requiredString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];
  if (typeof value !== 'string' || value.length === 0) invalidToken();
  return value;
}

function requiredTime(claims: Record<string, unknown>, key: string): number {
  const value = claims[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalidToken();
  return value;
}

async function verifiedClaims(
  token: string,
  verification: OAuthBearerVerification,
  dependencies: OAuthBearerDependencies,
): Promise<Record<string, unknown>> {
  try {
    return await dependencies.verifyToken(token, {
      issuer: verification.issuer,
      audience: verification.expectedResource,
      jwksUrl: `${verification.issuer}/jwks`,
    });
  } catch {
    invalidToken();
  }
}

function validateClaims(
  claims: Record<string, unknown>,
  verification: OAuthBearerVerification,
): VerifiedBearerToken {
  const userId = requiredString(claims, 'sub');
  const clientId = requiredString(claims, 'azp');
  const issuer = requiredString(claims, 'iss');
  const issuedAtSeconds = requiredTime(claims, 'iat');
  const expiresAtSeconds = requiredTime(claims, 'exp');
  const now = verification.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (issuer !== verification.issuer || claims['aud'] !== verification.expectedResource) {
    invalidToken();
  }
  if (
    issuedAtSeconds > nowSeconds + 60 ||
    expiresAtSeconds <= nowSeconds ||
    expiresAtSeconds <= issuedAtSeconds
  ) {
    invalidToken();
  }
  const rawGrantClaim = claims[OAUTH_GRANT_CLAIM];
  const grantId =
    typeof rawGrantClaim === 'string' && rawGrantClaim.length > 0 ? rawGrantClaim : null;
  if (grantId !== null) requiredString(claims, 'jti');
  return {
    claims,
    userId,
    clientId,
    grantId,
    issuedAtSeconds,
    expiresAtSeconds,
    now,
  };
}

function canMaterializeLegacyGrant(
  token: VerifiedBearerToken,
  verification: OAuthBearerVerification,
  dependencies: OAuthBearerDependencies,
): dependencies is OAuthBearerDependencies &
  Required<Pick<OAuthBearerDependencies, 'ensureLegacyGrant'>> {
  return (
    token.grantId === null &&
    verification.allowLegacyMcp === true &&
    dependencies.ensureLegacyGrant !== undefined
  );
}

async function resolveLiveState(
  token: VerifiedBearerToken,
  verification: OAuthBearerVerification,
  dependencies: OAuthBearerDependencies,
  lookup: OAuthBearerStateLookup,
): Promise<OAuthBearerLiveState | null> {
  let state = await dependencies.loadLiveState(lookup);
  if (state || !canMaterializeLegacyGrant(token, verification, dependencies)) return state;
  try {
    const materialized = await dependencies.ensureLegacyGrant({
      lookup,
      issuedAtSeconds: token.issuedAtSeconds,
      expiresAtSeconds: token.expiresAtSeconds,
      expectedResource: verification.expectedResource,
      now: token.now,
    });
    if (materialized) state = await dependencies.loadLiveState(lookup);
    return state;
  } catch {
    invalidToken();
  }
}

function authorizeLiveState(
  token: VerifiedBearerToken,
  state: OAuthBearerLiveState,
  verification: OAuthBearerVerification,
): Extract<CallerPrincipal, { kind: 'oauth' }> {
  try {
    const authorized = authorizeOAuthBearerState(token.claims, state, {
      expectedResource: verification.expectedResource,
      issuer: verification.issuer,
      now: token.now,
      ...(verification.allowLegacyMcp ? { allowLegacyMcp: true } : {}),
      ...(verification.allowTrustedMcp ? { allowTrustedMcp: true } : {}),
    });
    return {
      kind: 'oauth',
      userId: authorized.userId,
      user: authorized.user,
      clientId: authorized.clientId,
      clientName: state.clientName ?? null,
      scopes: authorized.scopes,
    };
  } catch {
    invalidToken();
  }
}

/**
 * Verify a bearer token and re-authorize it against current database state.
 *
 * @throws {OAuthBearerError} When any cryptographic, audience, ownership, grant, consent,
 * scope, expiry, or revocation check fails.
 */
export async function verifyOAuthBearerWith(
  token: string,
  verification: OAuthBearerVerification,
  dependencies: OAuthBearerDependencies,
): Promise<Extract<CallerPrincipal, { kind: 'oauth' }>> {
  const verified = validateClaims(
    await verifiedClaims(token, verification, dependencies),
    verification,
  );
  const lookup: OAuthBearerStateLookup = {
    tokenDigest: await hashOAuthToken(token),
    userId: verified.userId,
    clientId: verified.clientId,
    grantId: verified.grantId,
  };
  const state = await resolveLiveState(verified, verification, dependencies, lookup);
  if (!state) invalidToken();
  return authorizeLiveState(verified, state, verification);
}

async function loadLiveState(lookup: OAuthBearerStateLookup): Promise<OAuthBearerLiveState | null> {
  const grantWhere =
    lookup.grantId === null
      ? and(
          eq(oauthResourceGrant.clientId, lookup.clientId),
          eq(oauthResourceGrant.userId, lookup.userId),
          isNotNull(oauthResourceGrant.legacyBefore),
        )
      : and(
          eq(oauthResourceGrant.id, lookup.grantId),
          eq(oauthResourceGrant.clientId, lookup.clientId),
          eq(oauthResourceGrant.userId, lookup.userId),
        );

  const [users, clients, grants, consents, revocations] = await Promise.all([
    db.select().from(userTable).where(eq(userTable.id, lookup.userId)).limit(1),
    db.select().from(oauthClient).where(eq(oauthClient.clientId, lookup.clientId)).limit(1),
    db.select().from(oauthResourceGrant).where(grantWhere).limit(2),
    db
      .select({
        id: oauthConsent.id,
        referenceId: oauthConsent.referenceId,
        scopes: oauthConsent.scopes,
      })
      .from(oauthConsent)
      .where(
        and(eq(oauthConsent.clientId, lookup.clientId), eq(oauthConsent.userId, lookup.userId)),
      )
      .limit(2),
    db
      .select({ tokenDigest: oauthJwtRevocation.tokenDigest })
      .from(oauthJwtRevocation)
      .where(eq(oauthJwtRevocation.tokenDigest, lookup.tokenDigest))
      .limit(1),
  ]);
  const currentUser = users[0];
  const client = clients[0];
  if (!currentUser || !client || grants.length !== 1) return null;
  return {
    user: currentUser,
    clientId: client.clientId,
    clientName: client.name,
    clientDisabled: client.disabled === true,
    clientSkipConsent: client.skipConsent === true,
    clientScopes: effectiveOAuthClientScopes(client.scopes),
    clientLegacyBefore: client.docketLegacyBefore,
    grant: grants[0] ?? null,
    consents,
    tokenRevoked: revocations.length > 0,
  };
}

const productionDependencies: OAuthBearerDependencies = {
  verifyToken: async (token, options) => {
    const claims = await verifyAccessToken(token, {
      verifyOptions: { audience: options.audience, issuer: options.issuer },
      jwksUrl: options.jwksUrl,
    });
    return claims;
  },
  loadLiveState,
  ensureLegacyGrant: async (input) => {
    if (!env.MCP_RESOURCE_URL || input.expectedResource !== env.MCP_RESOURCE_URL) return false;
    return (
      (await ensureTrustedLegacyMcpGrant({
        clientId: input.lookup.clientId,
        userId: input.lookup.userId,
        issuedAtSeconds: input.issuedAtSeconds,
        expiresAtSeconds: input.expiresAtSeconds,
        mcpResource: env.MCP_RESOURCE_URL,
        now: input.now,
      })) !== null
    );
  },
};

/** Return the authorization-server issuer URI derived from its configured public origin. */
export function oauthIssuer(): string | null {
  const origin = env.MCP_ISSUER_URL?.replace(/\/+$/, '');
  return origin ? `${origin}/api/auth` : null;
}

/** Verify a REST access token against the exact Docket REST protected resource. */
export async function verifyRestBearer(
  token: string,
): Promise<Extract<CallerPrincipal, { kind: 'oauth' }>> {
  const issuer = oauthIssuer();
  const apiOrigin = env.API_URL.replace(/\/+$/, '');
  if (!issuer || !apiOrigin) invalidToken();
  return verifyOAuthBearerWith(
    token,
    { expectedResource: `${apiOrigin}/v1`, issuer },
    productionDependencies,
  );
}

/** Verify an MCP access token through the same checks under the MCP resource binding. */
export async function verifyMcpBearer(
  token: string,
): Promise<Extract<CallerPrincipal, { kind: 'oauth' }>> {
  const issuer = oauthIssuer();
  if (!issuer || !env.MCP_RESOURCE_URL) invalidToken();
  return verifyOAuthBearerWith(
    token,
    {
      expectedResource: env.MCP_RESOURCE_URL,
      issuer,
      allowLegacyMcp: true,
      allowTrustedMcp: true,
    },
    productionDependencies,
  );
}
