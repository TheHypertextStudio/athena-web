/**
 * `@docket/api` — zod request validators built on Hono's native `validator`.
 *
 * @remarks
 * These give full Hono RPC type inference (`c.req.valid('json')` is `z.infer<T>`)
 * while routing failures through the Problem error model — and they validate with
 * the app's own zod 4, sidestepping the zod-3 peer of the OpenAPI generator.
 */
import { validator } from 'hono/validator';
import type { z } from 'zod';

import { ValidationError } from '../error';

/** Validate the JSON body against `schema`; throws {@link ValidationError} on failure. */
export function zJson<T extends z.ZodType>(schema: T) {
  return validator('json', (value): z.infer<T> => {
    const result = schema.safeParse(value);
    if (!result.success) throw new ValidationError(result.error);
    return result.data;
  });
}

/** Validate the query string against `schema`; throws {@link ValidationError} on failure. */
export function zQuery<T extends z.ZodType>(schema: T) {
  return validator('query', (value): z.infer<T> => {
    const result = schema.safeParse(value);
    if (!result.success) throw new ValidationError(result.error);
    return result.data;
  });
}

/** Validate the path params against `schema`; throws {@link ValidationError} on failure. */
export function zParam<T extends z.ZodType>(schema: T) {
  return validator('param', (value): z.infer<T> => {
    const result = schema.safeParse(value);
    if (!result.success) throw new ValidationError(result.error);
    return result.data;
  });
}
