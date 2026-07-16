/** Signed internal-request header names shared by both execution directions. */
export const INTERNAL_HMAC_HEADERS = {
  bodyDigest: 'x-docket-content-sha256',
  nonce: 'x-docket-nonce',
  signature: 'x-docket-signature',
  timestamp: 'x-docket-timestamp',
} as const;

/** Maximum accepted clock skew and replay window for internal requests. */
export const INTERNAL_HMAC_WINDOW_MS = 300_000;

/** Inputs required to sign one internal request. */
export interface InternalRequestToSign {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly timestampMs?: number;
  readonly nonce?: string;
}

/** Successful or rejected internal-request verification. */
export type InternalRequestVerification =
  | { readonly ok: true; readonly nonce: string }
  | { readonly ok: false; readonly reason: 'headers' | 'timestamp' | 'signature' | 'replay' };

/** Untrusted request inputs plus the persistent nonce-claim boundary. */
export interface InternalRequestToVerify {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly headers: Headers;
  readonly nowMs?: number;
  readonly claimNonce: (nonce: string, expiresAtMs: number) => Promise<boolean>;
}

const encoder = new TextEncoder();

/** Encode bytes as lowercase hexadecimal without Node-only Buffer APIs. */
function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** Decode an expected SHA-256/HMAC hex value into a fixed-size buffer. */
function fixedDigest(value: string | null): {
  readonly bytes: Uint8Array;
  readonly valid: boolean;
} {
  const valid = Boolean(value && /^[0-9a-f]{64}$/i.test(value));
  const bytes = new Uint8Array(32);
  if (valid && value) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
  }
  return { bytes, valid };
}

/** Calculate a SHA-256 body digest. */
async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/** Calculate HMAC-SHA256 over the canonical request. */
async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

/** Construct the method/path/body/timestamp/nonce string covered by HMAC. */
function canonicalRequest(
  method: string,
  path: string,
  bodyDigest: string,
  timestamp: string,
  nonce: string,
): string {
  return [method.toUpperCase(), path, bodyDigest, timestamp, nonce].join('\n');
}

/** Sign one directional request using current Workers Web Crypto primitives. */
export async function signInternalRequest(input: InternalRequestToSign): Promise<Headers> {
  const timestamp = String(input.timestampMs ?? Date.now());
  const nonce = input.nonce ?? crypto.randomUUID();
  const bodyDigest = await sha256(input.body);
  const signature = await hmac(
    input.secret,
    canonicalRequest(input.method, input.path, bodyDigest, timestamp, nonce),
  );
  return new Headers({
    'content-type': 'application/json',
    [INTERNAL_HMAC_HEADERS.bodyDigest]: bodyDigest,
    [INTERNAL_HMAC_HEADERS.nonce]: nonce,
    [INTERNAL_HMAC_HEADERS.signature]: signature,
    [INTERNAL_HMAC_HEADERS.timestamp]: timestamp,
  });
}

/** Verify the complete request and atomically claim its nonce after authentication succeeds. */
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

  const bodyDigest = await sha256(input.body);
  const expectedDigest = fixedDigest(bodyDigest);
  const digestMatches = crypto.subtle.timingSafeEqual(presentedDigest.bytes, expectedDigest.bytes);
  const signature = await hmac(
    input.secret,
    canonicalRequest(input.method, input.path, bodyDigest, timestamp, nonce),
  );
  const expectedSignature = fixedDigest(signature);
  const signatureMatches = crypto.subtle.timingSafeEqual(
    presentedSignature.bytes,
    expectedSignature.bytes,
  );
  if (!presentedDigest.valid || !presentedSignature.valid || !digestMatches || !signatureMatches) {
    return { ok: false, reason: 'signature' };
  }
  if (!(await input.claimNonce(nonce, timestampMs + INTERNAL_HMAC_WINDOW_MS))) {
    return { ok: false, reason: 'replay' };
  }
  return { ok: true, nonce };
}
