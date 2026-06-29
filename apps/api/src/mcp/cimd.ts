/**
 * `@docket/api` — Client ID Metadata Document (CIMD) registration for MCP OAuth.
 *
 * @remarks
 * Better Auth's MCP authorize endpoint resolves clients by exact `client_id` before
 * consent. MCP clients that use a URL-form `client_id` therefore need a small,
 * server-side preflight: fetch and validate the client metadata document, then upsert
 * a public PKCE OAuth application row before Better Auth continues the authorize flow.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import { db, oauthApplication } from '@docket/db';
import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';

import { env } from '../env';

const MAX_METADATA_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

/** A DNS address selected for the metadata-document fetch. */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Dependency seams for deterministic CIMD validation tests. */
export interface CimdDeps {
  readonly resolveHost: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  readonly fetchJson: (url: URL, resolved: ResolvedAddress) => Promise<unknown>;
}

/** The validated subset of an MCP client metadata document that Docket persists. */
export interface CimdClient {
  readonly clientId: string;
  readonly name: string;
  readonly logoUri: string | null;
  readonly redirectUris: readonly string[];
  readonly metadata: Record<string, unknown>;
}

/** OAuth-style CIMD validation error returned before Better Auth authorization. */
export class CimdError extends Error {
  readonly status = 400;

  constructor(
    readonly code: 'invalid_client' | 'invalid_client_metadata' | 'invalid_redirect_uri',
    message: string,
  ) {
    super(message);
    this.name = 'CimdError';
  }
}

function configuredIssuer(c: Context): string {
  if (env.MCP_ISSUER_URL) return env.MCP_ISSUER_URL.replace(/\/$/, '');
  return new URL(c.req.url).origin;
}

function parseHttpsUrl(value: string, field: string, code: CimdError['code']): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CimdError(code, `${field} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new CimdError(code, `${field} must use HTTPS`);
  if (url.username || url.password || url.hash) {
    throw new CimdError(code, `${field} must not include credentials or fragments`);
  }
  if (isIP(url.hostname) !== 0) throw new CimdError(code, `${field} must use a DNS host`);
  return url;
}

function isLocalhostRedirectHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function parseRedirectUri(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CimdError('invalid_redirect_uri', 'redirect_uri must be an absolute URL');
  }
  if (url.username || url.password || url.hash) {
    throw new CimdError(
      'invalid_redirect_uri',
      'redirect_uri must not include credentials or fragments',
    );
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLocalhostRedirectHost(url.hostname)) return url;
  throw new CimdError('invalid_redirect_uri', 'redirect_uri must use HTTPS or localhost');
}

function allowlistHosts(): readonly string[] {
  return (
    env.MCP_CIMD_TRUST_ALLOWLIST?.split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

function isAllowlisted(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return allowlistHosts().some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function assertTrustAllowed(url: URL): void {
  if (!env.MCP_CIMD_STRICT) return;
  if (!isAllowlisted(url.hostname)) {
    throw new CimdError('invalid_client', 'client_id metadata host is not trusted for CIMD');
  }
}

function ipv4Parts(address: string): readonly number[] | null {
  const parts = address.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts;
}

function isPublicIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && parts[2] === 100))) return false;
  if (a === 203 && b === 0 && parts[2] === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) return false;
  if (normalized.startsWith('fea') || normalized.startsWith('feb')) return false;
  if (normalized.startsWith('ff')) return false;
  if (normalized.startsWith('2001:db8')) return false;
  if (normalized.startsWith('::ffff:')) return isPublicIpv4(normalized.slice('::ffff:'.length));
  return true;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function defaultResolveHost(hostname: string): Promise<readonly ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
}

async function defaultFetchJson(url: URL, resolved: ResolvedAddress): Promise<unknown> {
  const lookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, resolved.address, resolved.family);
  };

  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          accept: 'application/json',
          'user-agent': 'Docket-CIMD/1.0',
        },
        lookup,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new CimdError('invalid_client', 'client_id metadata document was not fetchable'));
          return;
        }

        let size = 0;
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_METADATA_BYTES) {
            req.destroy(
              new CimdError('invalid_client_metadata', 'client metadata document is too large'),
            );
            return;
          }
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as unknown);
          } catch {
            reject(
              new CimdError('invalid_client_metadata', 'client metadata document must be JSON'),
            );
          }
        });
      },
    );
    req.on('timeout', () =>
      req.destroy(new CimdError('invalid_client', 'client metadata fetch timed out')),
    );
    req.on('error', reject);
    req.end();
  });
}

const defaultDeps: CimdDeps = {
  resolveHost: defaultResolveHost,
  fetchJson: defaultFetchJson,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CimdError('invalid_client_metadata', 'client metadata document must be an object');
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, field: string, code: CimdError['code']): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CimdError(code, `${field} must be a non-empty string array`);
  }
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new CimdError(code, `${field} must be a non-empty string array`);
    }
    strings.push(entry);
  }
  return strings;
}

function optionalStringArray(value: unknown, field: string): readonly string[] | null {
  if (value === undefined) return null;
  return stringArray(value, field, 'invalid_client_metadata');
}

function assertPublicDnsResolution(
  url: URL,
  addresses: readonly ResolvedAddress[],
  field: string,
): void {
  if (addresses.length === 0)
    throw new CimdError('invalid_client', `${field} host did not resolve`);
  if (addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new CimdError('invalid_client', `${field} host resolved to a non-public address`);
  }
}

function validateMetadata(clientId: string, metadata: Record<string, unknown>): CimdClient {
  if (metadata['client_id'] !== clientId) {
    throw new CimdError(
      'invalid_client',
      'client metadata client_id must exactly match the URL client_id',
    );
  }

  const redirectUris = stringArray(
    metadata['redirect_uris'],
    'redirect_uris',
    'invalid_redirect_uri',
  );
  for (const redirectUri of redirectUris) {
    parseRedirectUri(redirectUri);
  }

  const tokenEndpointAuthMethod = metadata['token_endpoint_auth_method'];
  if (tokenEndpointAuthMethod !== undefined && tokenEndpointAuthMethod !== 'none') {
    throw new CimdError('invalid_client_metadata', 'CIMD clients must be public PKCE clients');
  }

  const grantTypes = optionalStringArray(metadata['grant_types'], 'grant_types');
  if (grantTypes && !grantTypes.includes('authorization_code')) {
    throw new CimdError('invalid_client_metadata', 'grant_types must include authorization_code');
  }

  const responseTypes = optionalStringArray(metadata['response_types'], 'response_types');
  if (responseTypes && !responseTypes.includes('code')) {
    throw new CimdError('invalid_client_metadata', 'response_types must include code');
  }

  const name =
    typeof metadata['client_name'] === 'string'
      ? metadata['client_name']
      : new URL(clientId).hostname;
  const logoUri = typeof metadata['logo_uri'] === 'string' ? metadata['logo_uri'] : null;
  if (logoUri) parseHttpsUrl(logoUri, 'logo_uri', 'invalid_client_metadata');

  return { clientId, name, logoUri, redirectUris, metadata };
}

/**
 * Fetch and validate a URL-form MCP `client_id` metadata document.
 *
 * @param clientId - The authorize request's URL-form `client_id`.
 * @param deps - Optional DNS/fetch dependencies for tests.
 * @returns a validated public CIMD OAuth client.
 */
export async function resolveCimdClient(
  clientId: string,
  deps: CimdDeps = defaultDeps,
): Promise<CimdClient> {
  const url = parseHttpsUrl(clientId, 'client_id', 'invalid_client');
  assertTrustAllowed(url);

  const addresses = await deps.resolveHost(url.hostname);
  assertPublicDnsResolution(url, addresses, 'client_id');
  const [resolved] = addresses;
  if (!resolved) throw new CimdError('invalid_client', 'client_id host did not resolve');

  const metadata = asRecord(await deps.fetchJson(url, resolved));
  return validateMetadata(url.href, metadata);
}

function isOwnedCimdMetadata(value: string | null, clientId: string): boolean {
  if (!value) return false;
  try {
    const parsed = asRecord(JSON.parse(value) as unknown);
    return parsed['cimd'] === true && parsed['cimdDocumentUrl'] === clientId;
  } catch {
    return false;
  }
}

/**
 * Upsert a validated CIMD client into Better Auth's OAuth application table.
 *
 * @param client - The validated CIMD client metadata.
 */
export async function upsertCimdClient(client: CimdClient): Promise<void> {
  const existing = await db
    .select({ metadata: oauthApplication.metadata })
    .from(oauthApplication)
    .where(eq(oauthApplication.clientId, client.clientId))
    .limit(1);
  const first = existing[0];
  if (first && !isOwnedCimdMetadata(first.metadata, client.clientId)) {
    throw new CimdError('invalid_client', 'client_id is already registered');
  }

  await db
    .insert(oauthApplication)
    .values({
      name: client.name,
      icon: client.logoUri,
      metadata: JSON.stringify({
        cimd: true,
        cimdDocumentUrl: client.clientId,
        raw: client.metadata,
      }),
      clientId: client.clientId,
      clientSecret: '',
      redirectUrls: client.redirectUris.join(','),
      type: 'public',
      disabled: false,
      userId: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: oauthApplication.clientId,
      set: {
        name: client.name,
        icon: client.logoUri,
        metadata: JSON.stringify({
          cimd: true,
          cimdDocumentUrl: client.clientId,
          raw: client.metadata,
        }),
        clientSecret: '',
        redirectUrls: client.redirectUris.join(','),
        type: 'public',
        disabled: false,
        userId: null,
        updatedAt: new Date(),
      },
    });
}

function isUrlFormClientId(clientId: string | null): clientId is string {
  if (!clientId) return false;
  return clientId.startsWith('https://') || clientId.startsWith('http://');
}

/**
 * Hono middleware that resolves URL-form MCP `client_id` values before Better Auth.
 *
 * @param c - The authorize request context.
 * @param next - The next Hono handler, normally `auth.handler`.
 */
export async function cimdAuthorizeMiddleware(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  const clientId = c.req.query('client_id') ?? null;
  if (!isUrlFormClientId(clientId)) {
    await next();
    return undefined;
  }

  try {
    const client = await resolveCimdClient(clientId);
    await upsertCimdClient(client);
    await next();
    return undefined;
  } catch (err) {
    const cimdErr =
      err instanceof CimdError
        ? err
        : new CimdError('invalid_client', 'client_id metadata document could not be resolved');
    return c.json(
      {
        error: cimdErr.code,
        error_description: cimdErr.message,
        issuer: configuredIssuer(c),
      },
      cimdErr.status,
    );
  }
}
