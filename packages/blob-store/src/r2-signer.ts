/** Minimal AWS Signature V4 signer for Cloudflare R2's S3-compatible REST API. */
import { createHash, createHmac } from 'node:crypto';

/** Credentials and bucket coordinates for signing Cloudflare R2 S3 requests. */
export interface R2Credentials {
  /** Cloudflare account identifier (used to derive the default R2 S3 endpoint). */
  readonly accountId: string;
  /** R2 API token S3 access key id. */
  readonly accessKeyId: string;
  /** R2 API token S3 secret access key. */
  readonly secretAccessKey: string;
  /** Target R2 bucket name. */
  readonly bucket: string;
  /** Optional S3 API endpoint override (defaults to `https://<accountId>.r2.cloudflarestorage.com`). */
  readonly endpoint?: string;
}

/** Unsigned request description accepted by {@link signR2Request}. */
export interface R2SignInput {
  /** HTTP method. */
  readonly method: 'GET' | 'HEAD' | 'PUT' | 'DELETE';
  /** Object storage key within the bucket. */
  readonly key: string;
  /** Additional request headers to include in the canonical signature. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Optional request body bytes used to compute `x-amz-content-sha256`. */
  readonly body?: Uint8Array;
  /** Optional query string parameters. */
  readonly query?: Readonly<Record<string, string>>;
  /** Override signing timestamp (defaults to current time). */
  readonly now?: Date;
}

/** Signed HTTP request ready for `fetch` / {@link HttpClient}. */
export interface SignedR2Request {
  /** Fully resolved request URL including path and query string. */
  readonly url: string;
  /** HTTP method. */
  readonly method: string;
  /** Canonical headers including `Authorization`, `x-amz-date`, and `x-amz-content-sha256`. */
  readonly headers: Record<string, string>;
  /** Body bytes when present. */
  readonly body?: Uint8Array;
}

const EMPTY_PAYLOAD_HASH = sha256Hex('');
const R2_REGION = 'auto';
const R2_SERVICE = 's3';

/** Strip leading slashes so keys map consistently across storage adapters. */
export function normalizeR2Key(key: string): string {
  return key.replace(/^\/+/, '');
}

/** Encode a bucket and object key into a canonical S3 path-style URI path. */
export function encodeR2Path(bucket: string, key: string): string {
  const normalized = normalizeR2Key(key);
  const encodedKey = normalized
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return encodedKey
    ? `/${encodeURIComponent(bucket)}/${encodedKey}`
    : `/${encodeURIComponent(bucket)}`;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzTimestamps(date: Date): { readonly amzDate: string; readonly dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function canonicalQuery(query: Readonly<Record<string, string>> | undefined): string {
  if (!query) return '';
  return Object.entries(query)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function canonicalHeaders(headers: Readonly<Record<string, string>>): {
  readonly canonical: string;
  readonly signedNames: string;
  readonly normalized: Record<string, string>;
} {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = entries.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedNames = entries.map(([k]) => k).join(';');
  return { canonical, signedNames, normalized: Object.fromEntries(entries) };
}

function signingKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, R2_REGION);
  const kService = hmacSha256(kRegion, R2_SERVICE);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * Sign an S3-compatible Cloudflare R2 request using AWS Signature V4.
 *
 * @param credentials - Bucket coordinates and R2 S3 API keys.
 * @param input - Unsigned method, key, headers, optional body, and query parameters.
 * @returns The full URL, HTTP method, signed headers, and optional body ready for fetch.
 */
export function signR2Request(credentials: R2Credentials, input: R2SignInput): SignedR2Request {
  const base = (
    credentials.endpoint ?? `https://${credentials.accountId}.r2.cloudflarestorage.com`
  ).replace(/\/+$/, '');
  const endpointUrl = new URL(base);
  const path = encodeR2Path(credentials.bucket, input.key);
  const query = canonicalQuery(input.query);
  const url = `${base}${path}${query ? `?${query}` : ''}`;

  const { amzDate, dateStamp } = amzTimestamps(input.now ?? new Date());
  const payloadHash = input.body ? sha256Hex(input.body) : EMPTY_PAYLOAD_HASH;

  const { canonical, signedNames, normalized } = canonicalHeaders({
    ...input.headers,
    host: endpointUrl.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  });

  const canonicalRequest = [input.method, path, query, canonical, signedNames, payloadHash].join(
    '\n',
  );

  const scope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, dateStamp))
    .update(stringToSign)
    .digest('hex');

  return {
    url,
    method: input.method,
    headers: {
      ...normalized,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedNames}, Signature=${signature}`,
    },
    ...(input.body ? { body: input.body } : {}),
  };
}
