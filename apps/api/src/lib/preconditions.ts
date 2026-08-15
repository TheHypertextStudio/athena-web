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
 * @see {@link ./http-tags} for the tag function reads and writes share.
 */
import type { MiddlewareHandler } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { PreconditionFailedError } from '../error';
import { representationTag, tagListMatches } from './http-tags';

/** The methods a precondition can guard. `POST` is excluded: it addresses a collection. */
const GUARDED = new Set(['PUT', 'PATCH', 'DELETE']);

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
 * internal `GET` carries the original request's headers so it resolves the same session, and it
 * re-enters this middleware harmlessly because a `GET` is not a guarded method.
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
      headers: c.req.raw.headers,
    });
    const tag = current.status === 200 ? current.headers.get('ETag') : null;
    if (tag === null || !tagListMatches(header, tag)) throw new PreconditionFailedError();

    return next();
  };
}

/**
 * Refuse the write when the caller's `If-Match` names a version the resource no longer has,
 * comparing against a pre-image the handler already holds.
 *
 * @remarks
 * The direct form of {@link preconditions}, for a handler that has the pre-image in hand and
 * would rather not pay for the sub-request. Pass the resource **as it is now**, through the
 * same `*Out` schema its `GET` uses — that is what makes the tag the one the caller's last read
 * handed them.
 *
 * @param c - The Hono context for the write request.
 * @param schema - The `*Out` schema the resource is served through.
 * @param current - The resource's pre-write state, in that schema's input shape.
 * @throws {PreconditionFailedError} When `If-Match` is present and matches nothing.
 */
export function assertIfMatch<T extends z.ZodType>(
  c: { req: { header: (name: string) => string | undefined } },
  schema: T,
  current: z.input<T>,
): void {
  const header = c.req.header('If-Match');
  if (header === undefined) return;
  if (!tagListMatches(header, representationTag(schema, current))) {
    throw new PreconditionFailedError();
  }
}
