/**
 * `@docket/api` — signed OAuth/connect `state` primitives (shared by provider connect flows).
 *
 * @remarks
 * A connect flow round-trips through a third party's browser redirect (GitHub App install,
 * Slack OAuth consent), so the context it started with — which org/integration/user the grant
 * is for — must survive the trip tamper-proof. These helpers mint and verify an opaque
 * `payload.signature` token: the payload is base64url JSON carrying the flow's fields plus an
 * absolute `exp`, and the signature is an HMAC-SHA256 keyed by `BETTER_AUTH_SECRET`. That both
 * prevents an attacker from binding a grant to another tenant and doubles as CSRF protection
 * on the callback.
 *
 * Each provider module ({@link signInstallState} in `github-app.ts`, `slack-app.ts`) owns its
 * payload shape and field validation; this module owns only the envelope (sign/verify/expiry).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env';

/** How long a signed connect `state` is valid (the user consents and returns at once). */
export const CONNECT_STATE_TTL_MS = 10 * 60_000;

/** base64url-encode a UTF-8 string. */
function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** HMAC-SHA256 (base64url) of `data` keyed by the Better Auth secret. */
function sign(data: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(data).digest('base64url');
}

/**
 * Sign an expiring connect-state token: `payload.signature`, where the payload carries the
 * caller's fields plus an absolute `exp`.
 *
 * @param payload - The flow context to carry through the provider redirect (JSON-serializable).
 * @param nowMs - Current time in ms (injected for testability; defaults to `Date.now()`).
 * @returns the opaque, tamper-proof state string to hand to the provider.
 */
export function signConnectState(
  payload: Record<string, string>,
  nowMs: number = Date.now(),
): string {
  const body = b64url(JSON.stringify({ ...payload, exp: nowMs + CONNECT_STATE_TTL_MS }));
  return `${body}.${sign(body)}`;
}

/**
 * Verify and decode a connect-state token minted by {@link signConnectState}.
 *
 * @param token - The `state` value the provider echoed back to the callback.
 * @param nowMs - Current time in ms (injected for testability; defaults to `Date.now()`).
 * @returns the decoded payload (minus `exp`), or `null` when the signature is bad or expired.
 */
export function verifyConnectState(
  token: string,
  nowMs: number = Date.now(),
): Record<string, unknown> | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof decoded['exp'] !== 'number' || decoded['exp'] < nowMs) return null;
    const rest = { ...decoded };
    delete rest['exp'];
    return rest;
  } catch {
    return null;
  }
}
