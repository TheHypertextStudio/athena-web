/**
 * `@docket/integrations` — GitHub App authentication machinery.
 *
 * @remarks
 * A GitHub App authenticates to GitHub in two ways, and Docket needs both:
 *
 * 1. **App JWT** — a short-lived RS256 token signed with the app's private key, identifying
 *    the *app itself*. It is only used to mint installation tokens and read installation
 *    metadata. {@link buildAppJwt}.
 * 2. **Installation access token** — a 1-hour token scoped to one *installation* (one account
 *    or org that installed the app), carrying the app's repository permissions. This is the
 *    server-to-server credential the firehose/mirror data plane uses. {@link mintInstallationToken}.
 *
 * The signing is done with `node:crypto` (RS256) rather than a JWT dependency — a GitHub App
 * JWT is three base64url segments and one `RSA-SHA256` signature, so the std lib is enough.
 * The private key is stored in env as a single-line **base64 PEM** (so it survives line-based
 * `.env` files); {@link decodeAppPrivateKey} turns it back into a PEM before signing.
 *
 * Pure except for the network call, which goes through the injected {@link HttpClient} —
 * `buildAppJwt` and the cache logic are directly unit-testable with a generated keypair.
 */
import { createSign } from 'node:crypto';

import { ConnectorError } from './connector-error';
import { ProviderHttp } from './provider-http';
import { defaultHttpClient, type HttpClient } from './http';

/** The public GitHub REST API base (app/installation endpoints live here too). */
const APP_API_BASE = 'https://api.github.com';

/** Safety margin (ms) before an installation token's expiry at which we proactively refresh. */
const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;

/** base64url-encode a UTF-8 string (one JWT segment). */
function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/**
 * Decode the env-stored single-line base64 PEM back into a multi-line PEM string.
 *
 * @param base64Pem - The value of `GITHUB_APP_PRIVATE_KEY` (`base64 -i key.pem | tr -d '\n'`).
 * @returns the PEM text `createSign().sign()` accepts.
 */
export function decodeAppPrivateKey(base64Pem: string): string {
  return Buffer.from(base64Pem, 'base64').toString('utf8');
}

/** Input to {@link buildAppJwt}. */
export interface AppJwtInput {
  /** The GitHub App id (the JWT `iss`). */
  readonly appId: string;
  /** The app private key as decoded PEM (see {@link decodeAppPrivateKey}). */
  readonly privateKeyPem: string;
  /** Current time in **seconds** since the epoch (injected for determinism/testability). */
  readonly nowSeconds: number;
}

/**
 * Build a short-lived RS256 app JWT — the credential GitHub exchanges for installation tokens.
 *
 * @remarks
 * `iat` is backdated 60s to tolerate clock skew and `exp` is set 9 minutes out (GitHub rejects
 * app JWTs with a lifetime over 10 minutes). The JWT identifies the app, never a user or
 * installation.
 *
 * @param input - The app id, decoded private key, and current time in seconds.
 * @returns the signed `header.payload.signature` JWT string.
 */
export function buildAppJwt(input: AppJwtInput): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: input.nowSeconds - 60, exp: input.nowSeconds + 540, iss: input.appId }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(input.privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}

/** A minted installation access token and its absolute expiry. */
export interface InstallationToken {
  /** The 1-hour installation access token (server-to-server bearer). */
  readonly token: string;
  /** GitHub's RFC3339 expiry timestamp for the token. */
  readonly expiresAt: string;
}

/** The `POST /app/installations/{id}/access_tokens` response shape Docket reads. */
interface InstallationTokenResponse {
  readonly token?: string;
  readonly expires_at?: string;
}

/** The `GET /app/installations/{id}` response shape Docket reads. */
interface InstallationResponse {
  readonly account?: { readonly login?: string } | null;
}

/** Common config for the app-authenticated calls (id + key + optional transport). */
export interface GitHubAppConfig {
  /** The GitHub App id. */
  readonly appId: string;
  /** The app private key as decoded PEM. */
  readonly privateKeyPem: string;
  /** HTTP transport (defaults to the platform `fetch`). */
  readonly http?: HttpClient;
}

/** Build a {@link ProviderHttp} authenticated as the *app* (Bearer app-JWT). */
function appHttp(config: GitHubAppConfig, nowSeconds: number): ProviderHttp {
  const jwt = buildAppJwt({ appId: config.appId, privateKeyPem: config.privateKeyPem, nowSeconds });
  return new ProviderHttp('github', APP_API_BASE, jwt, config.http ?? defaultHttpClient);
}

/**
 * Exchange an app JWT for a 1-hour installation access token.
 *
 * @param config - The app id, private key, and optional transport.
 * @param installationId - The installation to mint a token for.
 * @param nowSeconds - Current time in seconds (drives the app JWT's `iat`/`exp`).
 * @returns the installation token and its expiry.
 * @throws {ConnectorError} when GitHub answers without a token (`provider`) or the call fails.
 */
export async function mintInstallationToken(
  config: GitHubAppConfig,
  installationId: string,
  nowSeconds: number,
): Promise<InstallationToken> {
  const http = appHttp(config, nowSeconds);
  const res = await http.postJson<InstallationTokenResponse>(
    `/app/installations/${installationId}/access_tokens`,
    {},
  );
  if (!res.token || !res.expires_at) {
    throw new ConnectorError('github did not return an installation token', {
      provider: 'github',
      kind: 'provider',
    });
  }
  return { token: res.token, expiresAt: res.expires_at };
}

/**
 * Resolve the account (login) an installation belongs to — validates the installation exists
 * and yields the display label stamped onto the integration's connection.
 *
 * @param config - The app id, private key, and optional transport.
 * @param installationId - The installation to resolve.
 * @param nowSeconds - Current time in seconds (drives the app JWT).
 * @returns the account login, or `undefined` when GitHub exposes none.
 * @throws {ConnectorError} when the call fails (e.g. the installation was uninstalled).
 */
export async function resolveInstallationAccount(
  config: GitHubAppConfig,
  installationId: string,
  nowSeconds: number,
): Promise<string | undefined> {
  const http = appHttp(config, nowSeconds);
  const res = await http.getJson<InstallationResponse>(`/app/installations/${installationId}`);
  return res.account?.login;
}

/**
 * Caches installation access tokens, minting/refreshing them on demand.
 *
 * @remarks
 * Installation tokens last an hour; this keeps one per installation id and re-mints when it is
 * absent or within {@link TOKEN_REFRESH_SKEW_MS} of expiry, so callers (the firehose drain, the
 * org mirror) never juggle expiry themselves. In-process only — a cold start re-mints, which is
 * cheap and always correct.
 */
export class InstallationTokenStore {
  private readonly cache = new Map<string, InstallationToken>();

  /** @param config - The app id, private key, and optional transport shared by every mint. */
  constructor(private readonly config: GitHubAppConfig) {}

  /**
   * Return a valid installation access token, minting or refreshing as needed.
   *
   * @param installationId - The installation whose token is requested.
   * @param nowMs - Current time in ms (injected for testability; defaults to `Date.now()`).
   * @returns a bearer token valid for at least {@link TOKEN_REFRESH_SKEW_MS} longer.
   */
  async getToken(installationId: string, nowMs: number = Date.now()): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && Date.parse(cached.expiresAt) - nowMs > TOKEN_REFRESH_SKEW_MS) {
      return cached.token;
    }
    const minted = await mintInstallationToken(
      this.config,
      installationId,
      Math.floor(nowMs / 1000),
    );
    this.cache.set(installationId, minted);
    return minted.token;
  }
}
