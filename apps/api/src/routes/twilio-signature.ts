/**
 * `@docket/api` — proving an inbound call webhook really came from Twilio.
 *
 * @remarks
 * The inbound call webhook is a public URL that, if forged, hands an attacker the ability to
 * claim any caller id and open somebody else's Athena conversation. Caller id is the *only*
 * identity a phone call carries, so the signature is not defense in depth here — it is the
 * authentication.
 *
 * Twilio's scheme (documented under "Validating Signatures from Twilio"): take the full request
 * URL exactly as Twilio called it, append every POST parameter as `key + value` in
 * lexicographic key order with no separators, HMAC-SHA1 the result with the account's auth
 * token, base64 the digest, and compare against `X-Twilio-Signature`.
 *
 * Two details this implementation is careful about:
 *
 * - **The URL must be the one Twilio signed**, which behind a proxy is the *external* URL, not
 *   the one the Node server saw. {@link externalRequestUrl} rebuilds it from the forwarded
 *   headers, because getting this wrong produces a signature mismatch that looks exactly like an
 *   attack and wastes an afternoon.
 * - **Comparison is timing-safe** and length-guarded, so a mismatched-length signature returns
 *   false rather than throwing out of `timingSafeEqual`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The header Twilio carries its signature in. */
export const TWILIO_SIGNATURE_HEADER = 'x-twilio-signature';

/**
 * Compute the signature Twilio would have sent for this request.
 *
 * @param authToken - The account auth token.
 * @param url - The full URL Twilio requested, including query string.
 * @param params - The POST form parameters.
 * @returns the base64 HMAC-SHA1 signature.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Readonly<Record<string, string>>,
): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), url);
  return createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest('base64');
}

/**
 * Whether a request's signature is authentic.
 *
 * @remarks
 * Returns `false` — never throws — for a missing token, a missing header, or a length mismatch,
 * so the caller has exactly one branch to write and cannot accidentally treat a thrown error as
 * a passing check.
 *
 * @param authToken - The account auth token.
 * @param url - The full external URL Twilio requested.
 * @param params - The POST form parameters.
 * @param signature - The `X-Twilio-Signature` header value.
 */
export function verifyTwilioSignature(
  authToken: string | undefined,
  url: string,
  params: Readonly<Record<string, string>>,
  signature: string | undefined | null,
): boolean {
  if (!authToken || !signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Rebuild the URL the provider actually called, from behind a proxy.
 *
 * @remarks
 * Cloud Run terminates TLS and forwards over plain HTTP, so `new URL(c.req.url)` yields
 * `http://…` while Twilio signed `https://…`. `x-forwarded-proto` and `x-forwarded-host` (or
 * `host`) are what reconstruct the signed string. Only the first value of a comma-joined
 * forwarded header is used, which is the outermost proxy — the one the provider talked to.
 *
 * @param rawUrl - `c.req.url`, as the Node server saw it.
 * @param headers - The request headers.
 * @returns the external URL, including the original query string.
 */
export function externalRequestUrl(rawUrl: string, headers: Headers): string {
  const url = new URL(rawUrl);
  const proto = first(headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '');
  const host = first(headers.get('x-forwarded-host')) ?? headers.get('host') ?? url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

function first(value: string | null): string | undefined {
  const [head] = (value ?? '').split(',');
  const trimmed = head?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}
