/**
 * `@docket/auth` — Apple "Sign in with Apple" client-secret minter.
 *
 * @remarks
 * Unlike Google/GitHub/Linear, Apple's OAuth `client_secret` is not a static string: it is a
 * short-lived **ES256 JWT** signed with the developer's `.p8` private key, valid for at most six
 * months (Apple rejects a longer `exp`). We therefore store the *durable* credentials (Services
 * ID, Team ID, Key ID, private key) in env and mint a fresh JWT here at server boot — a restart
 * re-mints it, so it never approaches the ceiling and there is no static secret to silently expire.
 *
 * Kept **synchronous** so it can run inside the pure `buildAuthOptions`: Node's `crypto.sign` with
 * `dsaEncoding: 'ieee-p1363'` emits the raw `r‖s` signature JOSE requires directly, so no `jose`
 * dependency and no async DER→JOSE conversion are needed.
 */
import { createPrivateKey, sign } from 'node:crypto';

/** The Apple audience every Sign-in-with-Apple client-secret JWT is issued for. */
const APPLE_AUDIENCE = 'https://appleid.apple.com';

/**
 * The client-secret lifetime: 180 days, comfortably under Apple's hard ceiling of 15,777,000s
 * (six months), beyond which Apple rejects the secret. Re-minted every boot, so it never ages out.
 */
const LIFETIME_SECONDS = 180 * 24 * 60 * 60;

/** The durable Apple credentials a client secret is minted from (see the module remarks). */
export interface AppleClientSecretInput {
  /** Apple Services ID (e.g. `com.docket.web`) — the JWT `sub` and OAuth `client_id`. */
  readonly clientId: string;
  /** Apple 10-char Team ID — the JWT `iss`. */
  readonly teamId: string;
  /** The `.p8` key's Key ID — the JWT header `kid`. */
  readonly keyId: string;
  /** The `.p8` PKCS#8 PEM (real or `\n`-escaped newlines are both accepted). */
  readonly privateKey: string;
}

/** base64url-encode a UTF-8 string (JWT segment encoding). */
function encodeSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * Mint an Apple "Sign in with Apple" client-secret JWT (ES256), valid for 180 days.
 *
 * @remarks
 * Pure and synchronous. `.p8` PEMs are commonly stored in `.env` with escaped `\n`; those are
 * normalized back to real newlines before parsing so either form works. The signature is produced
 * in JOSE `r‖s` form via `dsaEncoding: 'ieee-p1363'`.
 *
 * @param input - The durable Apple credentials (see {@link AppleClientSecretInput}).
 * @returns the compact-serialized JWT to pass as Better Auth's `socialProviders.apple.clientSecret`.
 * @throws {Error} when `privateKey` is not a valid EC (P-256) PKCS#8 PEM.
 *
 * @example
 * ```typescript
 * const clientSecret = generateAppleClientSecret({ clientId, teamId, keyId, privateKey });
 * ```
 */
export function generateAppleClientSecret(input: AppleClientSecretInput): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: input.keyId };
  const payload = {
    iss: input.teamId,
    iat: now,
    exp: now + LIFETIME_SECONDS,
    aud: APPLE_AUDIENCE,
    sub: input.clientId,
  };

  const signingInput = `${encodeSegment(JSON.stringify(header))}.${encodeSegment(
    JSON.stringify(payload),
  )}`;

  const key = createPrivateKey({ key: input.privateKey.replace(/\\n/g, '\n') });
  // `ieee-p1363` yields the fixed-length r‖s signature JOSE (ES256) requires — no DER unwrap needed.
  const signature = sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  return `${signingInput}.${signature}`;
}
