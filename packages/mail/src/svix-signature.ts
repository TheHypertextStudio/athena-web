/**
 * `@docket/mail` — manual Svix webhook signature verification.
 *
 * @remarks
 * Resend signs every webhook with Svix's scheme, so this is the authentication for Athena's
 * inbound mail edge. It is implemented here rather than pulled from the `svix` SDK for three
 * reasons that all matter at this edge: the algorithm is ~30 lines and fully specified, the SDK
 * would be a runtime dependency inside a signature check (the one place a supply-chain surface is
 * least welcome), and a hand-rolled version is testable against forged, tampered, replayed and
 * multi-signature inputs without a network or a mock library.
 *
 * The scheme (per Svix's published verification steps):
 *
 * 1. The secret is `whsec_<base64>`; the bytes after the prefix are the HMAC key.
 * 2. The signed content is `{svix-id}.{svix-timestamp}.{raw body}` — literally concatenated with
 *    periods, over the exact bytes received.
 * 3. The signature is base64(HMAC-SHA256(key, content)).
 * 4. `svix-signature` is a space-delimited list of `v1,<sig>` entries; a match against **any**
 *    entry passes (that is how secret rotation works without dropping messages).
 * 5. `svix-timestamp` must be within a tolerance window, which is what makes a captured-and-
 *    replayed request stop working.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header carrying the unique message id, part of the signed content. */
export const SVIX_ID_HEADER = 'svix-id';
/** Header carrying the Unix-seconds send time, part of the signed content and the replay guard. */
export const SVIX_TIMESTAMP_HEADER = 'svix-timestamp';
/** Header carrying the space-delimited `v1,<base64>` signature list. */
export const SVIX_SIGNATURE_HEADER = 'svix-signature';

/**
 * Replay window in seconds, in both directions.
 *
 * @remarks
 * Five minutes is Svix's own documented default. It is symmetric because a receiver's clock can
 * legitimately sit slightly behind the sender's, and a one-sided window would reject honest
 * traffic on a machine whose NTP drifted forward.
 */
export const SVIX_TOLERANCE_SECONDS = 300;

/** The prefix every Svix endpoint secret carries. */
export const SVIX_SECRET_PREFIX = 'whsec_';

/** Why a signature check failed, as a stable code (never provider or exception text). */
export type SvixVerificationFailure = 'missing-signature' | 'invalid-signature' | 'stale-timestamp';

/** The outcome of one signature check. */
export type SvixVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: SvixVerificationFailure };

/** Everything one signature check needs. */
export interface SvixVerifyInput {
  /** The endpoint signing secret, with or without its `whsec_` prefix. */
  readonly secret: string;
  /** The `svix-id` header value. */
  readonly id: string | undefined;
  /** The `svix-timestamp` header value (Unix seconds, as sent). */
  readonly timestamp: string | undefined;
  /** The `svix-signature` header value (the whole space-delimited list). */
  readonly signature: string | undefined;
  /** The exact request body bytes, un-parsed. */
  readonly payload: string;
  /** Verification time; injected so the replay window is testable. */
  readonly now: Date;
  /** Replay window override; defaults to {@link SVIX_TOLERANCE_SECONDS}. */
  readonly toleranceSeconds?: number;
}

/**
 * Read the HMAC key out of an endpoint secret.
 *
 * @param secret - The configured secret, with or without the `whsec_` prefix.
 * @returns the raw key bytes.
 */
function keyBytes(secret: string): Buffer {
  const material = secret.startsWith(SVIX_SECRET_PREFIX)
    ? secret.slice(SVIX_SECRET_PREFIX.length)
    : secret;
  return Buffer.from(material, 'base64');
}

/**
 * Compare two base64 signatures without leaking their difference through timing.
 *
 * @remarks
 * `timingSafeEqual` throws on length mismatch, so the lengths are compared first — that
 * comparison is not itself a secret (a signature's length is fixed by the algorithm).
 *
 * @param a - One base64 signature.
 * @param b - The other.
 * @returns whether they are byte-identical.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'base64');
  const right = Buffer.from(b, 'base64');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Compute the expected signature for one message.
 *
 * @remarks
 * Exported so tests (and the local fixture sender) can produce genuinely valid signatures rather
 * than stubbing verification out — which is the only way a test proves the check works.
 *
 * @param secret - The endpoint signing secret.
 * @param id - The `svix-id` value.
 * @param timestamp - The `svix-timestamp` value.
 * @param payload - The exact body bytes.
 * @returns the base64 HMAC-SHA256 signature (without its `v1,` version prefix).
 */
export function signSvixPayload(
  secret: string,
  id: string,
  timestamp: string,
  payload: string,
): string {
  return createHmac('sha256', keyBytes(secret))
    .update(`${id}.${timestamp}.${payload}`, 'utf8')
    .digest('base64');
}

/**
 * Verify one Svix-signed webhook request.
 *
 * @remarks
 * Order matters and is deliberate: presence, then freshness, then cryptography. Checking the
 * timestamp before the HMAC means a flood of replayed requests is rejected without spending a
 * hash each, and it keeps the returned code specific — `stale-timestamp` tells an operator their
 * clock is wrong, where a blanket `invalid-signature` would send them hunting for the wrong bug.
 *
 * @param input - Secret, headers, body and clock (see {@link SvixVerifyInput}).
 * @returns whether the request is authentic, and if not, why.
 */
export function verifySvixSignature(input: SvixVerifyInput): SvixVerification {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return { ok: false, code: 'missing-signature' };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, code: 'stale-timestamp' };
  const tolerance = input.toleranceSeconds ?? SVIX_TOLERANCE_SECONDS;
  const skew = Math.abs(Math.floor(input.now.getTime() / 1000) - sentAt);
  if (skew > tolerance) return { ok: false, code: 'stale-timestamp' };

  const expected = signSvixPayload(input.secret, id, timestamp, input.payload);
  // A space-delimited list, each entry `version,signature`. Any single match passes, which is
  // what lets an operator rotate the endpoint secret without dropping in-flight deliveries.
  const matched = signature
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .some((entry) => {
      const comma = entry.indexOf(',');
      if (comma === -1) return false;
      if (entry.slice(0, comma) !== 'v1') return false;
      return constantTimeEquals(expected, entry.slice(comma + 1));
    });

  return matched ? { ok: true } : { ok: false, code: 'invalid-signature' };
}
