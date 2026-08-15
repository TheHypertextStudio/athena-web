/**
 * `@docket/api` — request-size limits and method scoping for the shared middleware.
 *
 * @remarks
 * Two small pieces of glue around Hono's own middleware, kept together because both exist to
 * narrow something the library deliberately leaves broad.
 */
import type { MiddlewareHandler } from 'hono';

import { PayloadTooLargeError } from '../error';

/**
 * The largest request body this API will read.
 *
 * @remarks
 * Nothing capped a request body before this, so a single client could make the process buffer
 * as much as it was willing to send. The ceiling is set by the largest thing a person
 * legitimately posts — a file attachment — with headroom for multipart framing; every JSON body
 * on the surface is orders of magnitude smaller.
 */
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

/**
 * Answer an over-long body through the Problem model rather than Hono's plain-text default.
 *
 * @remarks
 * `bodyLimit` otherwise returns a bare `413` with a text body, which would be the one failure on
 * this API that a client parsing the documented error shape could not read.
 */
export function rejectOversizedBody(): never {
  throw new PayloadTooLargeError(MAX_REQUEST_BYTES);
}

/**
 * Run a middleware only for methods that cannot change state.
 *
 * @remarks
 * `app.use` scopes by path, never by method, so a response transformer registered globally also
 * sees every write. For `etag` that is not merely wasteful: it compares `If-None-Match` on
 * whatever it is given, and a `POST` carrying that header would be answered `304` — a create
 * silently turned into "nothing changed".
 *
 * @param middleware - The middleware to scope.
 */
export function safeMethodsOnly(middleware: MiddlewareHandler): MiddlewareHandler {
  return async (c, next) =>
    c.req.method === 'GET' || c.req.method === 'HEAD' ? middleware(c, next) : next();
}
