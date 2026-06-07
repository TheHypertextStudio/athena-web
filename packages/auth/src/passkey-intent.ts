/**
 * `@docket/auth` — passkey-intent HMAC signer.
 *
 * @remarks
 * Passkey-first onboarding registers a passkey with no prior session, so the
 * name/email the new account will use must be carried into the registration
 * callback tamper-proof. This signs a short-lived (5-minute) HMAC token over
 * `{name,email,nonce,exp}` with `BETTER_AUTH_SECRET`; the pre-registration route
 * verifies it before the transactional user+hub birth (P6 `PAB-AUTH-03`).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '@docket/env/api';

/** The verified payload carried through passkey-first registration. */
export interface PasskeyIntent {
  /** Display name for the new account. */
  readonly name: string;
  /** Email for the new account. */
  readonly email: string;
  /** Single-use nonce. */
  readonly nonce: string;
  /** Expiry (epoch ms). */
  readonly exp: number;
}

/** Time-to-live for a passkey intent token (5 minutes). */
const TTL_MS = 5 * 60 * 1000;

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function hmac(payloadB64: string): string {
  return base64url(createHmac('sha256', env.BETTER_AUTH_SECRET).update(payloadB64).digest());
}

/**
 * Sign a passkey intent into a compact `payload.signature` token (5-minute TTL).
 *
 * @param input - The name + email the new account will use.
 * @returns an opaque token to round-trip through the WebAuthn registration call.
 */
export function signPasskeyIntent(input: { name: string; email: string }): string {
  const intent: PasskeyIntent = {
    name: input.name,
    email: input.email,
    nonce: randomBytes(12).toString('base64url'),
    exp: Date.now() + TTL_MS,
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(intent)));
  return `${payloadB64}.${hmac(payloadB64)}`;
}

/**
 * Verify and decode a passkey intent token.
 *
 * @param token - The token from {@link signPasskeyIntent}.
 * @returns the decoded {@link PasskeyIntent}.
 * @throws {Error} when the token is malformed, tampered, or expired.
 */
export function verifyPasskeyIntent(token: string): PasskeyIntent {
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) throw new Error('passkey intent: malformed token');

  const expected = hmac(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('passkey intent: invalid signature');
  }

  const intent = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as PasskeyIntent;
  if (typeof intent.exp !== 'number' || intent.exp < Date.now()) {
    throw new Error('passkey intent: expired');
  }
  return intent;
}
