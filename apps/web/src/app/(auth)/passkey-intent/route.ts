import { createHmac, randomBytes } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

/**
 * `/passkey-intent` — mint the server-signed intent token for passwordless passkey sign-UP.
 *
 * @remarks
 * Passkey-first registration happens with NO prior session, so the new account's `name` +
 * `email` must be carried into the server's `registration.resolveUser` hook tamper-proof.
 * The server (`@docket/auth`) verifies that token with {@link verifyPasskeyIntent} before it
 * find-or-creates the user; the token is an HMAC-`SHA256` over a compact JSON payload, keyed
 * by `BETTER_AUTH_SECRET`. This route reproduces that exact wire format so the resulting
 * token validates server-side, WITHOUT importing the server-only auth/db packages into the
 * browser bundle: the work is a few lines of `node:crypto` that only ever run on the server
 * (a Route Handler), where `BETTER_AUTH_SECRET` is available.
 *
 * The flow: the sign-up screen `POST`s `{ name, email }` here, receives an opaque `context`
 * token, then passes it to `authClient.passkey.addPasskey({ name, context })`. The token is
 * single-use-shaped (random nonce) and short-lived (5 minutes), so a leaked token cannot be
 * replayed to mint an arbitrary identity beyond its window.
 *
 * @see The server-side signer/verifier it mirrors: `@docket/auth`'s `signPasskeyIntent` /
 * `verifyPasskeyIntent` (`packages/auth/src/passkey-intent.ts`).
 */

/** Time-to-live for a minted passkey-intent token (5 minutes), matching the server signer. */
const TTL_MS = 5 * 60 * 1000;

/** Maximum accepted length for a submitted name/email, guarding against oversized payloads. */
const MAX_FIELD_LENGTH = 320;

/** The JSON payload signed into the intent token (kept byte-identical to the server's shape). */
interface IntentPayload {
  readonly name: string;
  readonly email: string;
  readonly nonce: string;
  readonly exp: number;
}

/** Base64url-encode a Buffer (no padding), the encoding the server signer/verifier expects. */
function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * Compute the base64url HMAC-`SHA256` of the payload segment, keyed by `BETTER_AUTH_SECRET`.
 *
 * @param secret - The shared `BETTER_AUTH_SECRET` (server-only).
 * @param payloadB64 - The base64url-encoded JSON payload segment.
 * @returns the base64url signature segment.
 */
function sign(secret: string, payloadB64: string): string {
  return base64url(createHmac('sha256', secret).update(payloadB64).digest());
}

/** Read + trim a string field from an untyped JSON body, or `null` when absent/invalid. */
function readField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FIELD_LENGTH) return null;
  return trimmed;
}

/**
 * Mint a passkey-intent token for the submitted `{ name, email }`.
 *
 * @param request - The `POST` request whose JSON body carries `{ name, email }`.
 * @returns `200 { context }` with the signed token, or a `4xx`/`5xx` JSON error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) {
    return NextResponse.json(
      { error: 'Passkey sign-up is unavailable: the server is not configured.' },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const fields = body as Record<string, unknown> | null;
  const name = readField(fields?.['name']);
  const email = readField(fields?.['email']);
  if (!name || !email) {
    return NextResponse.json({ error: 'A name and email are required.' }, { status: 400 });
  }

  const payload: IntentPayload = {
    name,
    email,
    nonce: randomBytes(12).toString('base64url'),
    exp: Date.now() + TTL_MS,
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const context = `${payloadB64}.${sign(secret, payloadB64)}`;

  return NextResponse.json({ context });
}
