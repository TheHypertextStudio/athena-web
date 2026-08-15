/**
 * `@docket/integrations` — Sign in with Lovelace: the OAuth 2.1 authorization-code + PKCE flow
 * that lets one person authorize Athena to run model work on their own Lattice devices.
 *
 * @remarks
 * ## Why OAuth and not a key
 *
 * The thing being authorized is *a person's own hardware*. A developer API key proves which
 * developer is calling; it cannot say whose laptop to wake up. Lattice enforces this at the SDK
 * boundary — personal-runtime dispatch with an API key throws
 * `PersonalRuntimeRequiresUserTokenError` before a request is even sent — so per-user OAuth is not
 * a stylistic preference here, it is the only credential shape that can express the feature.
 *
 * ## What Docket ends up holding
 *
 * An access token, a refresh token, and the granted scope string. No Lovelace password ever
 * reaches Docket; the person types it into Lovelace's own consent screen. Everything persisted is
 * sealed with AES-256-GCM by the API layer before it touches the database.
 *
 * ## PKCE is mandatory, even though Docket is a confidential client
 *
 * Docket's API holds a client secret and could use a plain code exchange. It uses PKCE anyway
 * because the authorization code travels through the user's browser, and PKCE is what makes an
 * intercepted code useless to anyone who does not hold the verifier.
 *
 * @see {@link ./lattice-gateway.ts} for what the resulting token is used for.
 */
import { createHash, randomBytes } from 'node:crypto';

/**
 * The Lovelace accounts issuer Docket authorizes against.
 *
 * @remarks
 * Documented by the `lattice-start` skill (step 4.1) and by
 * `lovelace:docs/platform/lattice-cloud/guides/personal-runtime-relay.md` §1. Overridable per
 * deployment so a staging Lovelace can be pointed at without a code change.
 */
export const LOVELACE_ACCOUNTS_ISSUER = 'https://accounts.uselovelace.com';

/** Authorization endpoint path on the accounts issuer. */
export const LOVELACE_AUTHORIZE_PATH = '/oauth/authorize';

/** Token endpoint path on the accounts issuer. */
export const LOVELACE_TOKEN_PATH = '/oauth/token';

/**
 * The exact scopes Athena requests, and nothing more.
 *
 * @remarks
 * This list is the whole of the permission ask, and each entry is here because a specific Athena
 * behaviour cannot work without it:
 *
 * - `lattice:compute:inference` — submit the model turn, and read the person's device records.
 *   Reading runtime records is deliberately covered by this scope upstream rather than by the
 *   management scope, so device discovery costs no extra authority.
 * - `lattice:compute:catalog:read` — populate the model picker in Settings from the gateway's own
 *   catalog rather than from a list Docket hard-codes and lets rot.
 *
 * Deliberately NOT requested, and why:
 *
 * - `lattice:compute:personal_runtime:manage` — creates, revokes and mints daemon credentials for
 *   devices. Athena sends work to devices the person already paired; it has no business minting
 *   new machine credentials on their account.
 * - `lattice:compute:marketplace` — permits routing onto shared third-party capacity. The entire
 *   point of this feature is that the work runs on the person's own machine, so Athena must not
 *   hold the authority to send it somewhere else.
 * - `lattice:compute:usage:read` — billing/usage history. Athena never shows it.
 * - `lattice:compute:streaming` — the session/WebSocket family. Athena's Lattice turns use the
 *   request/response chat surface.
 *
 * @see `lovelace:docs/platform/lattice-cloud/reference/auth-scopes.md` for the scope vocabulary.
 */
export const LATTICE_SCOPES: readonly string[] = [
  'lattice:compute:inference',
  'lattice:compute:catalog:read',
];

/** The scope string sent on the authorization request. */
export const LATTICE_SCOPE_PARAM = LATTICE_SCOPES.join(' ');

/** How close to expiry a token may get before Docket refreshes it ahead of a turn. */
const REFRESH_SKEW_MS = 60_000;

/** Where a flow talks to, and as whom. */
export interface LatticeOAuthClientConfig {
  /** The accounts issuer origin; defaults to {@link LOVELACE_ACCOUNTS_ISSUER}. */
  readonly issuer?: string | undefined;
  /** The registered OAuth client id. */
  readonly clientId: string;
  /** The registered client secret, when Docket is deployed as a confidential client. */
  readonly clientSecret?: string | undefined;
  /** The callback Lovelace redirects the browser back to. */
  readonly redirectUri: string;
  /** Injected fetch, for tests. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/** Encrypted-at-rest state held while the person is on Lovelace's consent screen. */
export interface PendingLatticeCredential {
  /** Discriminant. */
  readonly kind: 'lattice_oauth_pending';
  /** The PKCE verifier whose challenge went out on the authorization request. */
  readonly codeVerifier: string;
}

/** Encrypted-at-rest credential for an approved Lattice grant. */
export interface LatticeCredentialRecord {
  /** Discriminant. */
  readonly kind: 'lattice_oauth';
  /** The bearer token gateway calls are made with. */
  readonly accessToken: string;
  /** The refresh token, when the issuer returned one. */
  readonly refreshToken: string | null;
  /** Lifetime the issuer reported, in seconds. */
  readonly expiresInSeconds: number | null;
  /** The scope string the issuer actually granted — which may be narrower than asked. */
  readonly scope: string | null;
  /** When Docket received this token (ISO-8601), the basis for refresh timing. */
  readonly obtainedAt: string;
}

/** Either persisted shape, for a decoder that must not trust arbitrary JSON. */
export type StoredLatticeCredential = PendingLatticeCredential | LatticeCredentialRecord;

/** The authorization URL to send the browser to, plus the state to seal until it returns. */
export interface BegunLatticeAuthorization {
  /** Where to redirect the person's browser. */
  readonly authorizationUrl: string;
  /** The pending credential to seal and store until the callback. */
  readonly credential: PendingLatticeCredential;
}

/**
 * A failure Docket can act on, carrying a stable code rather than issuer prose.
 *
 * @remarks
 * The issuer's `error_description` is provider text; rendering it would violate the
 * application-owned-copy rule, so it is deliberately dropped at this boundary. `code` is an
 * RFC 6749 error code (`invalid_grant`, `invalid_client`, …) or `transport_error`.
 */
export class LatticeOAuthError extends Error {
  /** RFC 6749 error code, or `transport_error`. */
  readonly code: string;

  /**
   * @param code - The stable error code.
   * @param message - Operator-facing detail; never rendered to a person.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LatticeOAuthError';
    this.code = code;
  }
}

/** base64url without padding, the encoding PKCE and OAuth state both want. */
function b64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/**
 * Mint a PKCE verifier.
 *
 * @remarks
 * 32 random bytes → 43 base64url characters, comfortably inside RFC 7636's 43–128 range.
 *
 * @param random - Byte source, injected so a test can make the flow deterministic.
 * @returns The verifier to keep secret until the token exchange.
 */
export function createCodeVerifier(random: (size: number) => Buffer = randomBytes): string {
  return b64url(random(32));
}

/**
 * Derive the S256 challenge for a verifier.
 *
 * @param codeVerifier - The verifier from {@link createCodeVerifier}.
 * @returns The `code_challenge` value to put on the authorization URL.
 */
export function codeChallengeFor(codeVerifier: string): string {
  return b64url(createHash('sha256').update(codeVerifier).digest());
}

/** The issuer origin a config resolves to, with no trailing slash. */
function issuerOrigin(config: LatticeOAuthClientConfig): string {
  return (config.issuer ?? LOVELACE_ACCOUNTS_ISSUER).replace(/\/+$/, '');
}

/**
 * Begin an authorization: build the consent URL and the PKCE state that completes it.
 *
 * @remarks
 * `state` is minted by the caller (Docket signs an HMAC envelope binding the flow to one user)
 * and is passed through untouched, so this module owns PKCE and the issuer contract while the API
 * layer owns CSRF and tenancy binding.
 *
 * @param config - Which issuer, as which client, returning where.
 * @param state - The caller's signed, opaque state value.
 * @param random - Byte source for the verifier, injected for tests.
 * @returns The consent URL and the pending credential to seal.
 */
export function beginLatticeAuthorization(
  config: LatticeOAuthClientConfig,
  state: string,
  random: (size: number) => Buffer = randomBytes,
): BegunLatticeAuthorization {
  const codeVerifier = createCodeVerifier(random);
  const url = new URL(`${issuerOrigin(config)}${LOVELACE_AUTHORIZE_PATH}`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', LATTICE_SCOPE_PARAM);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallengeFor(codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return {
    authorizationUrl: url.toString(),
    credential: { kind: 'lattice_oauth_pending', codeVerifier },
  };
}

/** The token-endpoint response fields Docket reads. */
interface TokenResponseBody {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
  readonly scope?: unknown;
  readonly error?: unknown;
  readonly error_description?: unknown;
}

/** Parse a token-endpoint body without throwing; a malformed body reads as an empty one. */
function parseTokenBody(text: string): TokenResponseBody {
  if (text === '') return {};
  try {
    return JSON.parse(text) as TokenResponseBody;
  } catch {
    return {};
  }
}

/** POST the token endpoint and normalize both success and failure shapes. */
async function postToken(
  config: LatticeOAuthClientConfig,
  form: Record<string, string>,
): Promise<LatticeCredentialRecord> {
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const body = new URLSearchParams({ ...form, client_id: config.clientId });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);

  let response: Response;
  try {
    response = await fetchImpl(`${issuerOrigin(config)}${LOVELACE_TOKEN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new LatticeOAuthError(
      'transport_error',
      cause instanceof Error ? cause.message : 'token request failed',
    );
  }

  const text = await response.text();
  const parsed: TokenResponseBody = parseTokenBody(text);

  if (!response.ok) {
    const code = typeof parsed.error === 'string' ? parsed.error : `http_${response.status}`;
    const detail =
      typeof parsed.error_description === 'string'
        ? parsed.error_description
        : `token endpoint returned HTTP ${response.status}`;
    throw new LatticeOAuthError(code, detail);
  }

  if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
    throw new LatticeOAuthError('invalid_grant', 'token response carried no access token');
  }

  return {
    kind: 'lattice_oauth',
    accessToken: parsed.access_token,
    refreshToken: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : null,
    expiresInSeconds: typeof parsed.expires_in === 'number' ? parsed.expires_in : null,
    scope: typeof parsed.scope === 'string' ? parsed.scope : null,
    obtainedAt: new Date().toISOString(),
  };
}

/**
 * Exchange the authorization code the browser came back with for tokens.
 *
 * @param config - Which issuer, as which client, returning where.
 * @param input - The code from the callback and the sealed pending credential.
 * @param input.authorizationCode - The `code` query parameter Lovelace echoed back.
 * @param input.credential - The pending credential holding the PKCE verifier.
 * @returns The approved credential to seal and store.
 * @throws {LatticeOAuthError} When the issuer rejects the exchange or returns no token.
 */
export async function completeLatticeAuthorization(
  config: LatticeOAuthClientConfig,
  input: { readonly authorizationCode: string; readonly credential: PendingLatticeCredential },
): Promise<LatticeCredentialRecord> {
  return await postToken(config, {
    grant_type: 'authorization_code',
    code: input.authorizationCode,
    redirect_uri: config.redirectUri,
    code_verifier: input.credential.codeVerifier,
  });
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * @remarks
 * Issuers that rotate refresh tokens return a new one; issuers that do not return none. The
 * previous refresh token is carried forward in the second case so a non-rotating issuer does not
 * silently strip Docket's ability to refresh again.
 *
 * @param config - Which issuer, as which client.
 * @param credential - The stored credential holding the refresh token.
 * @returns A refreshed credential.
 * @throws {LatticeOAuthError} With code `invalid_grant` when there is nothing to refresh with,
 * or with the issuer's own code when it refuses.
 */
export async function refreshLatticeCredential(
  config: LatticeOAuthClientConfig,
  credential: LatticeCredentialRecord,
): Promise<LatticeCredentialRecord> {
  if (!credential.refreshToken) {
    throw new LatticeOAuthError('invalid_grant', 'stored Lattice credential has no refresh token');
  }
  const refreshed = await postToken(config, {
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken,
  });
  return {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? credential.refreshToken,
    scope: refreshed.scope ?? credential.scope,
  };
}

/**
 * Whether a stored token should be refreshed before the next gateway call.
 *
 * @remarks
 * A credential whose issuer reported no lifetime is treated as long-lived: refreshing on every
 * turn would burn the grant for no reason. An unparseable `obtainedAt` refreshes, because the
 * safe reading of "I do not know when I got this" is "it may already be dead".
 *
 * @param credential - The stored credential.
 * @param nowMs - Current time, injected for tests.
 * @returns True when a refresh should be attempted first.
 */
export function latticeCredentialNeedsRefresh(
  credential: LatticeCredentialRecord,
  nowMs: number = Date.now(),
): boolean {
  if (credential.expiresInSeconds === null) return false;
  const obtainedAt = Date.parse(credential.obtainedAt);
  if (!Number.isFinite(obtainedAt)) return true;
  return obtainedAt + credential.expiresInSeconds * 1_000 - REFRESH_SKEW_MS <= nowMs;
}

/**
 * Whether a granted scope string covers everything Athena needs.
 *
 * @remarks
 * An issuer may narrow a grant. Discovering that at the moment of a turn produces a confusing
 * failure, so Docket checks the granted scope when the grant lands and marks the connection as
 * needing re-authorization instead.
 *
 * @param scope - The space-delimited scope string the issuer granted, if any.
 * @returns The required scopes that are missing; empty when the grant is sufficient.
 */
export function missingLatticeScopes(scope: string | null): readonly string[] {
  // A silent issuer is taken at its word that it granted what was asked: OAuth 2.1 allows
  // omitting `scope` when the grant matches the request exactly.
  if (scope === null) return [];
  const granted = new Set(scope.split(/\s+/).filter((part) => part.length > 0));
  return LATTICE_SCOPES.filter((required) => !granted.has(required));
}

/**
 * Decode a sealed credential without accepting arbitrary JSON as one.
 *
 * @param value - The unsealed plaintext.
 * @returns The typed credential, or `null` when the value is not one Docket wrote.
 */
export function parseLatticeCredential(value: string): StoredLatticeCredential | null {
  try {
    const parsed = JSON.parse(value) as { readonly kind?: unknown };
    if (parsed.kind === 'lattice_oauth' || parsed.kind === 'lattice_oauth_pending') {
      return parsed as StoredLatticeCredential;
    }
  } catch {
    // Not JSON at all: not a credential this module wrote.
  }
  return null;
}
