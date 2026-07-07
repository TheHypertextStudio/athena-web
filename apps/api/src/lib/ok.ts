/**
 * `@docket/api` — the output helper.
 */
import type { Context } from 'hono';
import type { z } from 'zod';

/**
 * Validate (in dev/test) and serialize a response body against its `*Out` schema.
 *
 * @remarks
 * In non-production it `schema.parse`s the data so a contract drift fails loudly in
 * tests; in production it trusts the data for speed. Preserves the RPC response type.
 *
 * Takes the schema's **input** type (pre-brand) so plain DB strings satisfy branded
 * `*Out` id fields; parsing produces the branded output the RPC client sees.
 *
 * @param c - The Hono context.
 * @param schema - The response Zod schema.
 * @param data - The data to return (the schema's input shape).
 * @returns the JSON response, typed as the schema's output.
 */
export function ok<T extends z.ZodType>(c: Context, schema: T, data: z.input<T>) {
  const body =
    process.env['NODE_ENV'] === 'production' ? (data as z.output<T>) : schema.parse(data);
  return c.json(body);
}
