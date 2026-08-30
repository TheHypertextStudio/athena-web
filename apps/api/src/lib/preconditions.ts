/**
 * `@docket/api` — conditional writes (`If-Match`), the write half of the entity-tag contract.
 *
 * @remarks
 * Docket is a collaborative product, so two people editing the same task from two tabs is the
 * normal case rather than the exotic one. Without a precondition the second write wins by
 * arriving later and silently discards the first — the lost-update problem. `If-Match` closes
 * it: the client sends back the `ETag` it read, and a write against a stale tag is refused with
 * `412` instead of applied.
 *
 * The check is **opt-in by design**. A client that sends no `If-Match` still writes
 * last-writer-wins, which is what every current caller does and what a mobile client with no
 * prior read needs. Demanding the header on every mutation (`428 Precondition Required`) would
 * be the stricter reading of RFC 9110 §13.1.1, and it is deliberately not what this API does:
 * the guarantee offered is "you can protect a write", not "every write is protected".
 *
 * Tags themselves are not minted here. Hono's `etag` middleware puts one on every response, so
 * this only has to compare — `If-None-Match` is the middleware's job, `If-Match` is this one's.
 */
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { PreconditionFailedError } from '../error';

/** The methods a precondition can guard. `POST` is excluded: it addresses a collection. */
const GUARDED = new Set(['PUT', 'PATCH', 'DELETE']);

/**
 * Conditional headers that must not travel to the sub-request.
 *
 * @remarks
 * The sub-request exists to ask "what is this resource's current tag", and any of these turns it
 * into a different question. `If-None-Match` is the one that bites: a client that kept one header
 * set from its read — `If-None-Match` for the conditional GET, `If-Match` for the conditional
 * write — would have the sub-request answered `304`, which this middleware reads as "no current
 * representation" and refuses with `412`, despite the caller holding exactly the right version.
 */
const CONDITIONAL_HEADERS = [
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'if-range',
];

/** The original request's headers minus anything that would re-condition the sub-request. */
function unconditional(headers: Headers): Headers {
  const forwarded = new Headers(headers);
  for (const name of CONDITIONAL_HEADERS) forwarded.delete(name);
  return forwarded;
}

/**
 * Whether an `If-Match` header selects `tag`.
 *
 * @remarks
 * `*` matches any existing representation. Otherwise the header is a comma-separated tag list;
 * the `W/` prefix is stripped before comparing, matching how Hono's `etag` middleware compares
 * `If-None-Match`, so the two halves of the contract agree on what "the same tag" means.
 */
export function tagListMatches(header: string, tag: string): boolean {
  const normalize = (value: string) => value.trim().replace(/^W\//, '');
  if (normalize(header) === '*') return true;
  const wanted = normalize(tag);
  return header.split(',').some((entry) => normalize(entry) === wanted);
}

/**
 * Refuse an unsafe request whose `If-Match` names a version the resource no longer has.
 *
 * @remarks
 * The tag is resolved by asking the app for the resource — a real `GET` of the very URI being
 * written, through the same routing, auth, and serialization a client would use. That is what
 * makes the comparison sound without a line of per-handler code: the value compared here is,
 * by construction, the `ETag` the caller's last read handed them, whatever shape that
 * resource's representation happens to be.
 *
 * The cost is one extra read, and only for a request that opted in by sending the header. The
 * internal `GET` carries the original request's credentials so it resolves the same caller, minus
 * the conditional headers (see {@link CONDITIONAL_HEADERS}), and it re-enters this middleware
 * harmlessly because a `GET` is not a guarded method.
 *
 * `fetchSelf` must route through the session middleware, not straight into the `/v1` app: that
 * middleware is registered on the root server, so a sub-request that skips it arrives with no
 * session at all and `requireAuth` rejects it — which this would then read as a stale tag and
 * refuse every conditional write with `412`.
 *
 * A URI with no readable representation cannot satisfy any precondition, including `*`, and is
 * refused — a caller asserting the version of something it could never have read is mistaken
 * about what it is writing.
 *
 * @param fetchSelf - Issues a sub-request against the composed app.
 */
export function preconditions(
  fetchSelf: (url: string, init: RequestInit) => Promise<Response>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('If-Match');
    if (header === undefined || !GUARDED.has(c.req.method)) return next();

    const current = await fetchSelf(c.req.url, {
      method: 'GET',
      headers: unconditional(c.req.raw.headers),
    });
    const tag = current.status === 200 ? current.headers.get('ETag') : null;
    if (tag === null || !tagListMatches(header, tag)) throw new PreconditionFailedError();

    return next();
  };
}
