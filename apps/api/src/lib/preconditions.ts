/**
 * `@docket/api` — conditional writes (`If-Match`), the write half of the entity-tag contract.
 *
 * @remarks
 * Docket is a collaborative product, so two people editing the same task from two tabs is the
 * normal case rather than the exotic one. Without a precondition the second `PATCH` wins by
 * arriving later and silently discards the first — the lost-update problem. `If-Match` closes
 * it: the client sends back the `ETag` it read, and a write against a stale tag is refused
 * with `412` instead of applied.
 *
 * The check is **opt-in by design**. A client that sends no `If-Match` still writes
 * last-writer-wins, which is what every current caller does and what a mobile client with no
 * prior read needs. Demanding the header on every mutation (`428 Precondition Required`) would
 * be the stricter reading of RFC 9110 §13.1.1, and it is deliberately not what this API does:
 * the guarantee offered is "you can protect a write", not "every write is protected".
 *
 * @see {@link ./http-tags} for the tag function reads and writes share.
 */
import type { Context } from 'hono';
import type { z } from 'zod';

import { PreconditionFailedError } from '../error';
import { representationTag, tagListMatches } from './http-tags';

/**
 * Refuse the write when the caller's `If-Match` names a version the resource no longer has.
 *
 * @remarks
 * Call this after loading the row and before writing it, passing the resource **as it is
 * now** through the same `*Out` schema its `GET` uses. That is what makes the comparison
 * meaningful: the tag computed here is the one the caller's last `GET` handed them.
 *
 * @param c - The Hono context for the write request.
 * @param schema - The `*Out` schema the resource is served through.
 * @param current - The resource's pre-write state, in that schema's input shape.
 * @throws {PreconditionFailedError} When `If-Match` is present and matches nothing.
 */
export function assertIfMatch<T extends z.ZodType>(
  c: Context,
  schema: T,
  current: z.input<T>,
): void {
  const header = c.req.header('If-Match');
  if (header === undefined) return;
  if (!tagListMatches(header, representationTag(schema, current))) {
    throw new PreconditionFailedError();
  }
}
