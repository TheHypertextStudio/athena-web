/**
 * Directional HMAC authentication for Docket's Cloudflare execution boundary.
 *
 * @remarks
 * The signature covers the HTTP method, exact path, SHA-256 body digest, timestamp, and nonce.
 * Callers must persist the nonce atomically after authentication so replay protection survives
 * process restarts and horizontal scaling.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** Signed internal-request header names shared with the Cloudflare runner. */
export const INTERNAL_HMAC_HEADERS = {
  bodyDigest: 'x-docket-content-sha256',
  nonce: 'x-docket-nonce',
  signature: 'x-docket-signature',
  timestamp: 'x-docket-timestamp',
} as const;

/** Maximum accepted clock skew and nonce lifetime. */
export const INTERNAL_HMAC_WINDOW_MS = 300_000;

/** Values covered by one outbound request signature. */
export interface InternalRequestToSign {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly timestampMs?: number;
  readonly nonce?: string;
}

/** Authenticated or rejected internal request. */
export type InternalRequestVerification =
  | { readonly ok: true; readonly nonce: string }
  | { readonly ok: false; readonly reason: 'headers' | 'timestamp' | 'signature' | 'replay' };

/** Untrusted request values plus the durable nonce-claim boundary. */
export interface InternalRequestToVerify {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly headers: Headers;
  readonly nowMs?: number;
  readonly claimNonce: (nonce: string, expiresAt: Date) => Promise<boolean>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalRequest(
  method: string,
  path: string,
  bodyDigest: string,
  timestamp: string,
  nonce: string,
): string {
  return [method.toUpperCase(), path, bodyDigest, timestamp, nonce].join('\n');
}

function signature(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

function fixedDigest(value: string | null): { readonly bytes: Buffer; readonly valid: boolean } {
  const valid = Boolean(value && /^[0-9a-f]{64}$/i.test(value));
  return {
    bytes: valid && value ? Buffer.from(value, 'hex') : Buffer.alloc(32),
    valid,
  };
}

/** Sign one outbound request with a directional secret. */
export function signInternalRequest(input: InternalRequestToSign): Headers {
  const timestamp = String(input.timestampMs ?? Date.now());
  const nonce = input.nonce ?? randomUUID();
  const bodyDigest = sha256(input.body);
  const signed = signature(
    input.secret,
    canonicalRequest(input.method, input.path, bodyDigest, timestamp, nonce),
  );
  return new Headers({
    'content-type': 'application/json',
    [INTERNAL_HMAC_HEADERS.bodyDigest]: bodyDigest,
    [INTERNAL_HMAC_HEADERS.nonce]: nonce,
    [INTERNAL_HMAC_HEADERS.signature]: signed,
    [INTERNAL_HMAC_HEADERS.timestamp]: timestamp,
  });
}

/** Verify a signed request and claim its nonce after constant-time authentication succeeds. */
export async function verifyInternalRequest(
  input: InternalRequestToVerify,
): Promise<InternalRequestVerification> {
  const timestamp = input.headers.get(INTERNAL_HMAC_HEADERS.timestamp);
  const nonce = input.headers.get(INTERNAL_HMAC_HEADERS.nonce);
  const presentedDigest = fixedDigest(input.headers.get(INTERNAL_HMAC_HEADERS.bodyDigest));
  const presentedSignature = fixedDigest(input.headers.get(INTERNAL_HMAC_HEADERS.signature));
  if (!timestamp || !nonce || nonce.length > 128) return { ok: false, reason: 'headers' };

  const timestampMs = Number(timestamp);
  const nowMs = input.nowMs ?? Date.now();
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(nowMs - timestampMs) > INTERNAL_HMAC_WINDOW_MS
  ) {
    return { ok: false, reason: 'timestamp' };
  }

  const bodyDigest = sha256(input.body);
  const expectedDigest = fixedDigest(bodyDigest);
  const expectedSignature = fixedDigest(
    signature(
      input.secret,
      canonicalRequest(input.method, input.path, bodyDigest, timestamp, nonce),
    ),
  );
  if (
    !presentedDigest.valid ||
    !presentedSignature.valid ||
    !timingSafeEqual(presentedDigest.bytes, expectedDigest.bytes) ||
    !timingSafeEqual(presentedSignature.bytes, expectedSignature.bytes)
  ) {
    return { ok: false, reason: 'signature' };
  }

  if (!(await input.claimNonce(nonce, new Date(timestampMs + INTERNAL_HMAC_WINDOW_MS)))) {
    return { ok: false, reason: 'replay' };
  }
  return { ok: true, nonce };
}
