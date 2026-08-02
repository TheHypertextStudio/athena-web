/**
 * `@docket/notifications` — the real Web Push sender: RFC 8291 encryption + RFC 8292 VAPID.
 *
 * @remarks
 * Imports `node:crypto`, so it is reachable only through the `@docket/notifications/webpush/node`
 * subpath and never from the package barrel — browser code that needs the subscription shape must
 * not drag a signing implementation into its bundle.
 *
 * Written against the specifications rather than pulled in as a dependency because the entire
 * surface is four primitives Node already ships (P-256 ECDH, HKDF-SHA256, AES-128-GCM, ES256), and
 * the alternative is a transitive dependency inside the path that carries a person's questions.
 *
 * - **RFC 8291 §3.4** — `aes128gcm` content encoding. The wire body is
 *   `salt(16) ‖ rs(4) ‖ idlen(1) ‖ as_public(65) ‖ ciphertext`, and the plaintext is the payload
 *   followed by the single `0x02` last-record delimiter.
 * - **RFC 8188** — the HKDF ladder: the shared ECDH secret is extracted under the subscription's
 *   `auth` secret with the `WebPush: info\0 ‖ ua_public ‖ as_public` context, then the record salt
 *   derives the content-encryption key and the nonce.
 * - **RFC 8292** — the `vapid` authorization scheme: an ES256 JWT whose `aud` is the push service's
 *   origin, presented alongside the application server's public key.
 */
import {
  createECDH,
  createHash,
  createPrivateKey,
  createCipheriv,
  hkdfSync,
  randomBytes,
  sign as signOneShot,
} from 'node:crypto';

import {
  WebPushSendError,
  type SentWebPush,
  type WebPushMessage,
  type WebPushSender,
  type WebPushSubscription,
} from './types';

/** The elliptic curve every Web Push participant uses. */
const CURVE = 'prime256v1';
/** The record size advertised in the `aes128gcm` header; one record is always enough for us. */
const RECORD_SIZE = 4096;
/** How long a VAPID assertion stays valid. The spec caps this at 24h; 12h leaves clock slack. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;

/** Encode bytes as unpadded base64url. */
function b64url(input: Buffer): string {
  return input.toString('base64url');
}

/** Decode unpadded base64url into bytes. */
function unb64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/**
 * Derive the content-encryption key and nonce for one push message.
 *
 * @param uaPublic - The subscription's `p256dh` key, raw uncompressed point.
 * @param authSecret - The subscription's `auth` secret, raw bytes.
 * @param asPublic - This message's ephemeral public key, raw uncompressed point.
 * @param sharedSecret - The ECDH shared secret.
 * @param salt - This message's 16-byte record salt.
 * @returns The AES-128-GCM key and 12-byte nonce.
 */
function deriveKeys(
  uaPublic: Buffer,
  authSecret: Buffer,
  asPublic: Buffer,
  sharedSecret: Buffer,
  salt: Buffer,
): { key: Buffer; nonce: Buffer } {
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const key = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12),
  );
  return { key, nonce };
}

/**
 * Encrypt one payload for one subscription, producing an `aes128gcm` request body.
 *
 * @remarks
 * Exported because the encryption is the part worth testing directly: a test can decrypt the body
 * back with the subscription's own private key and assert the round trip, which is the only honest
 * way to know this is correct without a live browser.
 *
 * @param subscription - The browser subscription to encrypt for.
 * @param payload - The plaintext bytes (the JSON the service worker will read).
 * @param salt - Optional fixed salt, for deterministic tests.
 * @param ephemeral - Optional fixed ephemeral private key, for deterministic tests.
 * @returns The complete request body.
 */
export function encryptWebPushPayload(
  subscription: WebPushSubscription,
  payload: Buffer,
  salt: Buffer = randomBytes(16),
  ephemeral: Buffer | null = null,
): Buffer {
  const uaPublic = unb64url(subscription.keys.p256dh);
  const authSecret = unb64url(subscription.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) {
    throw new WebPushSendError('invalid_subscription');
  }

  const ecdh = createECDH(CURVE);
  if (ephemeral) ecdh.setPrivateKey(ephemeral);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const { key, nonce } = deriveKeys(uaPublic, authSecret, asPublic, sharedSecret, salt);
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  // RFC 8188 §2: the final record's plaintext ends with the 0x02 delimiter.
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(5);
  header.writeUInt32BE(RECORD_SIZE, 0);
  header.writeUInt8(asPublic.length, 4);
  return Buffer.concat([salt, header, asPublic, ciphertext]);
}

/** The application server's VAPID identity. */
export interface VapidKeys {
  /** Uncompressed P-256 public point, base64url — the `applicationServerKey` the browser subscribes with. */
  readonly publicKey: string;
  /** The matching 32-byte private scalar, base64url. */
  readonly privateKey: string;
  /** The `sub` claim: a `mailto:` or `https:` URI identifying the operator. */
  readonly subject: string;
}

/**
 * Turn a raw P-256 scalar + point into a key Node can sign with.
 *
 * @remarks
 * Via JWK rather than hand-assembled DER: the affine coordinates come straight out of the
 * uncompressed point (`0x04 ‖ X ‖ Y`), and Node validates that the point is actually on the curve
 * while importing. Hand-rolling the PKCS#8 length prefixes would be one more thing to get subtly
 * wrong in the path that authenticates every notification.
 */
function privateKeyObject(keys: VapidKeys): ReturnType<typeof createPrivateKey> {
  const priv = unb64url(keys.privateKey);
  const pub = unb64url(keys.publicKey);
  if (priv.length !== 32 || pub.length !== 65 || pub[0] !== 0x04) {
    throw new WebPushSendError('not_configured');
  }
  return createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: b64url(priv),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
  });
}

/**
 * Mint the `Authorization: vapid …` header value for one push service origin.
 *
 * @remarks
 * Exported so a test can verify the assertion against the public key without sending anything.
 *
 * @param keys - The application server's VAPID identity.
 * @param audience - The push service's origin (scheme + host, no path).
 * @param nowSeconds - Unix seconds; injectable so the assertion is reproducible under test.
 * @returns The complete header value.
 */
export function vapidAuthorization(
  keys: VapidKeys,
  audience: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }), 'utf8'));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({ aud: audience, exp: nowSeconds + VAPID_TTL_SECONDS, sub: keys.subject }),
      'utf8',
    ),
  );
  const signingInput = Buffer.from(`${header}.${claims}`, 'utf8');
  const signature = signOneShot('sha256', signingInput, {
    key: privateKeyObject(keys),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/**
 * Derive the base64url public key that pairs with a VAPID private scalar.
 *
 * @remarks
 * Used by `pnpm`-side tooling and by the config route so the browser is never handed a public key
 * that does not match the private key the server will sign with — a mismatch produces a
 * subscription the push service silently refuses, which is the single most confusing Web Push
 * failure mode.
 *
 * @param privateKeyBase64Url - The 32-byte private scalar, base64url.
 * @returns The matching uncompressed public point, base64url.
 */
export function vapidPublicKeyFor(privateKeyBase64Url: string): string {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(unb64url(privateKeyBase64Url));
  return b64url(ecdh.getPublicKey());
}

/** Assert a VAPID public/private pair actually belongs together. */
export function vapidKeysAgree(keys: VapidKeys): boolean {
  try {
    // Parsing the DER proves the scalar is a well-formed P-256 key; recomputing the point proves
    // the advertised public key is the one this scalar will actually sign under. A byte comparison
    // alone would accept a syntactically valid but off-curve scalar.
    privateKeyObject(keys);
    return vapidPublicKeyFor(keys.privateKey) === keys.publicKey;
  } catch {
    return false;
  }
}

/** The HTTP transport the sender posts through; matches the platform `fetch` shape. */
export type WebPushHttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Buffer },
) => Promise<{ status: number; ok: boolean }>;

const defaultHttpClient: WebPushHttpClient = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: new Uint8Array(init.body),
  });
  return { status: response.status, ok: response.ok };
};

/** A real Web Push sender: encrypts under RFC 8291 and authorizes under RFC 8292. */
export class VapidWebPushSender implements WebPushSender {
  private readonly keys: VapidKeys;
  private readonly http: WebPushHttpClient;

  /**
   * @param keys - The application server's VAPID identity.
   * @param http - HTTP transport, defaulting to platform `fetch`.
   */
  constructor(keys: VapidKeys, http: WebPushHttpClient = defaultHttpClient) {
    this.keys = keys;
    this.http = http;
  }

  /** {@inheritDoc WebPushSender.send} */
  async send(subscription: WebPushSubscription, message: WebPushMessage): Promise<SentWebPush> {
    const body = encryptWebPushPayload(subscription, Buffer.from(JSON.stringify(message), 'utf8'));
    let audience: string;
    try {
      audience = new URL(subscription.endpoint).origin;
    } catch {
      throw new WebPushSendError('invalid_subscription');
    }
    const response = await this.http(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(this.keys, audience),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(message.ttlSeconds),
        Urgency: message.urgency,
        // A single collapse key per question: a re-notified question replaces its own banner.
        Topic: createHash('sha256').update(message.tag).digest('base64url').slice(0, 32),
      },
      body,
    });
    if (response.status === 404 || response.status === 410) {
      throw new WebPushSendError('gone', response.status);
    }
    if (!response.ok) throw new WebPushSendError('push_service', response.status);
    return {
      endpoint: subscription.endpoint,
      sentAt: new Date().toISOString(),
      status: response.status,
    };
  }
}

/** Raw env shape parsed by {@link vapidKeysFromEnv}. */
export interface VapidEnv {
  /** `WEB_PUSH_VAPID_PUBLIC_KEY`. */
  readonly WEB_PUSH_VAPID_PUBLIC_KEY?: string | undefined;
  /** `WEB_PUSH_VAPID_PRIVATE_KEY`. */
  readonly WEB_PUSH_VAPID_PRIVATE_KEY?: string | undefined;
  /** `WEB_PUSH_VAPID_SUBJECT` — a `mailto:` or `https:` URI identifying the operator. */
  readonly WEB_PUSH_VAPID_SUBJECT?: string | undefined;
}

/**
 * Read a complete VAPID identity out of env, or `null` when web push is not configured.
 *
 * @remarks
 * Returns `null` rather than throwing on a partial configuration, and the caller degrades to
 * in-app-only notification — but a *mismatched* pair returns `null` too, because a key pair that
 * does not agree produces subscriptions that fail at delivery time with no visible cause.
 *
 * @param env - The process environment.
 * @returns The identity, or `null` when unset, incomplete, or inconsistent.
 */
export function vapidKeysFromEnv(env: VapidEnv): VapidKeys | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  const keys: VapidKeys = { publicKey, privateKey, subject };
  return vapidKeysAgree(keys) ? keys : null;
}
