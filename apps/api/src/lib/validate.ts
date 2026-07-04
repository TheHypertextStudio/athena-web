/**
 * `@docket/api` — zod request validators built on `hono-openapi`'s `validator`.
 *
 * @remarks
 * These give full Hono RPC type inference (`c.req.valid('json')` is `z.infer<T>`)
 * AND feed the OpenAPI document: `hono-openapi`'s `validator` registers each schema as
 * the route's request body / query / path parameters when the spec is generated
 * (`openAPIRouteHandler` in {@link ./../openapi}). The inline failure hook routes
 * validation failures through the Problem error model — and we validate with the app's
 * own zod 4 (which `hono-openapi` 1.x reads via the Standard Schema interface).
 */
import { validator } from 'hono-openapi';
import type { z } from 'zod';

import { ValidationError } from '../error';

/** Validate the JSON body against `schema`; throws {@link ValidationError} on failure. */
export function zJson<T extends z.ZodType>(schema: T) {
  return validator('json', schema, (result) => {
    if (!result.success) throw new ValidationError(result.error);
  });
}

/** Validate the query string against `schema`; throws {@link ValidationError} on failure. */
export function zQuery<T extends z.ZodType>(schema: T) {
  return validator('query', schema, (result) => {
    if (!result.success) throw new ValidationError(result.error);
  });
}

/** Validate the multipart/form-data body against `schema`; throws {@link ValidationError} on failure. */
export function zForm<T extends z.ZodType>(schema: T) {
  return validator('form', schema, (result) => {
    if (!result.success) throw new ValidationError(result.error);
  });
}

/** Validate the path params against `schema`; throws {@link ValidationError} on failure. */
export function zParam<T extends z.ZodType>(schema: T) {
  return validator('param', schema, (result) => {
    if (!result.success) throw new ValidationError(result.error);
  });
}
