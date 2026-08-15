/**
 * `@docket/api` — the output helper.
 */
import type { Context } from 'hono';
import type { z } from 'zod';

import { ApiError } from '../error';

/**
 * Validate and serialize a response body against its `*Out` schema.
 *
 * @remarks
 * Parsing runs in **every** environment, including production. It used to be skipped when
 * `NODE_ENV === 'production'`, and that made the schemas unenforceable rather than merely
 * unenforced: because the `*Out` objects are non-strict, `parse` *strips* unknown keys, so a
 * handler that accidentally passed a raw Drizzle row produced a correct, clean response in dev
 * and test and serialized the entire row — including columns no schema declares — in production.
 * No environment could observe the difference, so no test could have caught it. The parse is what
 * makes `openapi.ts`'s published claim that "the documented shape is the runtime shape" true.
 *
 * A parse failure is a server bug, never the caller's fault, and it must not escape as a bare
 * `ZodError`: `onError` maps those to a 422 whose `fieldErrors` are keyed by the *output* schema's
 * internal paths, which would both mislead the caller and disclose field names. It becomes a 500
 * with the closed-catalog `internal` title instead.
 *
 * The offending paths are logged here rather than attached as `fieldErrors`, for two reasons that
 * are both properties of `onError`: it renders `fieldErrors` at any status, so a 500 carrying them
 * would disclose exactly what this is trying to withhold; and it logs only errors that are *not*
 * `ApiError`, so an `ApiError` thrown from here would otherwise vanish without a trace.
 *
 * Takes the schema's **input** type (pre-brand) so plain DB strings satisfy branded
 * `*Out` id fields; parsing produces the branded output the RPC client sees.
 *
 * @param c - The Hono context.
 * @param schema - The response Zod schema.
 * @param data - The data to return (the schema's input shape).
 * @returns the JSON response, typed as the schema's output.
 * @throws {ApiError} 500 `internal` when the data does not satisfy its declared schema.
 */
export function ok<T extends z.ZodType>(c: Context, schema: T, data: z.input<T>) {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'api',
        event: 'response_contract_violation',
        method: c.req.method,
        path: c.req.path,
        // Paths and issue codes only — never the values, which are the response data itself.
        issues: result.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.join('.'),
        })),
      }),
    );
    throw new ApiError(500, 'internal', 'Response body did not match its declared schema');
  }
  return c.json(result.data);
}
