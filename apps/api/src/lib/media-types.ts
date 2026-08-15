/**
 * `@docket/api` — request and response media-type negotiation.
 *
 * @remarks
 * Two halves of RFC 9110 §12 that this API previously did not implement at all.
 *
 * On the way in: a body arriving under a `Content-Type` nothing here reads used to reach
 * `c.req.json()`, throw a parse error, and surface as **500** — the server reporting its own
 * failure for a mistake the client made and can fix. §15.5.16 has `415` for exactly this.
 *
 * On the way out: `Accept` was ignored. That is permitted — §12.5.1 lets a server disregard it —
 * but silently returning JSON to a client that asked for XML is worse for that client than
 * telling it plainly, and `406` is a shorter conversation than a parse failure two layers away.
 *
 * A missing `Accept` means "anything" and is never refused. A missing `Content-Type` on a
 * request that *does* carry a body is refused, because nothing downstream can read it: Hono's
 * JSON validator declines to parse an undeclared body and hands the schema an empty object, so
 * the caller received a `422` complaining that fields were missing which it had in fact sent.
 * `415` says the true thing — the body could not be read at all — and names what to declare.
 */
import { accepts } from 'hono/accepts';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { NotAcceptableError, UnsupportedMediaTypeError } from '../error';

/** The representation every endpoint answers with. */
const JSON_MEDIA_TYPE = 'application/json';

/** Everything this API can produce. Errors are the problem+json flavour of the same thing. */
const PRODUCED = [JSON_MEDIA_TYPE, 'application/problem+json'];

/** Sentinel for "nothing on offer satisfies this request", which `accepts` has no notion of. */
const UNACCEPTABLE = 'none';

/**
 * Everything this API can consume.
 *
 * @remarks
 * The two form encodings are here because file upload and the OAuth token endpoint need them;
 * a route that only reads JSON still rejects a form body at its schema, with a far better
 * message than this layer could give.
 */
const CONSUMED = ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'];

/** Methods that may carry a request body worth type-checking. */
const BODIED = new Set(['POST', 'PUT', 'PATCH']);

/** The bare media type, without parameters like `; charset=utf-8` or a multipart boundary. */
function bare(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * Refuse a body this API cannot read, and a request whose `Accept` it cannot satisfy.
 *
 * @remarks
 * A range with `q=0` explicitly refuses that type, so it does not count as coverage — a client
 * sending `Accept: application/json;q=0` has said it will not take JSON, and there is nothing
 * else to offer.
 */
export const mediaTypes: MiddlewareHandler<AppEnv> = async (c, next) => {
  // `raw.body` rather than `Content-Length`: the length is often computed at send time and is
  // absent on the request object, while the stream is the authoritative answer to "is there
  // content here". A `POST` to a controller resource frequently carries none, and demanding a
  // type to describe an absent body would reject a well-formed call.
  if (BODIED.has(c.req.method) && c.req.raw.body !== null) {
    const type = bare(c.req.header('Content-Type') ?? '');
    if (type === '' || (!CONSUMED.includes(type) && !type.endsWith('+json'))) {
      throw new UnsupportedMediaTypeError(CONSUMED);
    }
  }

  // Parsed by Hono's own `accepts` helper rather than by splitting the header here: it already
  // handles q-values, quoted parameters, and malformed entries, and re-deriving that was the
  // largest piece of duplicated code in this module. All that remains local is the wildcard
  // policy, which the helper's default matcher has no opinion about.
  const chosen = accepts(c, {
    header: 'Accept',
    supports: PRODUCED,
    // Reached only when the header is absent, which means "anything will do".
    default: JSON_MEDIA_TYPE,
    match: (ranges) =>
      ranges
        .filter((range) => range.q > 0)
        // Lowercased before comparing: a media type is case-insensitive, and Hono's parser
        // hands back whatever the client wrote, so `Accept: APPLICATION/JSON` would otherwise
        // match nothing on offer and be refused with `406`.
        .map((range) => range.type.toLowerCase())
        .some(
          (type) =>
            type === '*/*' ||
            type === 'application/*' ||
            PRODUCED.includes(type) ||
            type.endsWith('+json'),
        )
        ? JSON_MEDIA_TYPE
        : UNACCEPTABLE,
  });
  if (chosen === UNACCEPTABLE) throw new NotAcceptableError();

  await next();
};
