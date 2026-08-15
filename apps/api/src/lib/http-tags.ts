/**
 * `@docket/api` — entity tags, the one currency both conditional reads and conditional
 * writes are denominated in.
 *
 * @remarks
 * A resource's tag is a strong hash of its canonical JSON representation — the exact body
 * `GET` would return. Deriving reads and writes from the same function is what makes the
 * two halves agree: the `ETag` a client receives from `GET /tasks/:id` is byte-for-byte the
 * tag `If-Match` is compared against on the next `PATCH`, with no second versioning scheme
 * (a row `version` column, an `updatedAt` timestamp) to drift out of step with it.
 *
 * @see {@link ./ok} for the read half, {@link ./preconditions} for the write half.
 */
import { createHash } from 'node:crypto';

import type { z } from 'zod';

/**
 * The strong entity tag (RFC 9110 §8.8.3) for a representation.
 *
 * @param serialized - The exact JSON text of the representation.
 */
export function strongTag(serialized: string): string {
  return `"${createHash('sha1').update(serialized).digest('base64url')}"`;
}

/**
 * The entity tag for a value as its `*Out` schema renders it.
 *
 * @param schema - The response schema the resource is served through.
 * @param data - The value that schema describes.
 */
export function representationTag<T extends z.ZodType>(schema: T, data: z.input<T>): string {
  return strongTag(JSON.stringify(schema.parse(data)));
}

/**
 * Whether an `If-Match` / `If-None-Match` header selects `tag`.
 *
 * @remarks
 * `*` matches any existing representation. Otherwise the header is a comma-separated tag
 * list; the `W/` prefix is stripped before comparing because this API only mints strong
 * tags, so a client echoing a weakened form of one still names the same representation.
 *
 * @param header - The raw header value, or `undefined` when the client sent none.
 * @param tag - The tag the resource currently has.
 */
export function tagListMatches(header: string | undefined, tag: string): boolean {
  if (header === undefined) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//, '');
  if (normalize(header) === '*') return true;
  const wanted = normalize(tag);
  return header.split(',').some((entry) => normalize(entry) === wanted);
}
