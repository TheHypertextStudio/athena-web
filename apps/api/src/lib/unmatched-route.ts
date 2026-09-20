/**
 * `@docket/api` — the fallback for a request that matched no route.
 *
 * @remarks
 * Hono's default answer to an unmatched request is the plain-text body `404 Not Found`. That
 * made this API's error contract conditional on which failure you hit: every handled error
 * arrives as `application/problem+json` with a machine `code`, but a typo in a path arrived as
 * text, so a client parsing the documented shape got a parse error instead of a diagnosis.
 *
 * It also collapsed two different mistakes into one answer. `POST` to a path that only serves
 * `GET` is not "no such resource" — the resource is there and the method is wrong, which RFC
 * 9110 §15.5.6 says is `405` **and** requires an `Allow` header naming what would have worked.
 * Asking the router which other methods match separates the two cases.
 */
import type { Hono, Context } from 'hono';

import type { AppEnv } from '../context';
import { MethodNotAllowedError, NotFoundError } from '../error';

/** Methods that may own an operation at a path; HEAD is implied by every GET registration. */
const ROUTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

function hasRegisteredOperation(app: Hono<AppEnv>, method: string, path: string): boolean {
  return app.router
    .match(method, path)[0]
    .some((match) => match[0][1].method === method && match[0][1].path !== '*');
}

/**
 * Build the `notFound` handler for a fully-composed app.
 *
 * @remarks
 * Takes the app rather than reading it from the context because it must consult the router
 * for *other* methods on the same path, which only the app instance can answer. Register it
 * after the last route: the router it closes over is read at request time, but passing a
 * half-built app reads as though registration order does not matter, and it does.
 *
 * @param app - The root app whose router should be probed for alternative methods.
 * @returns a handler that throws `405` when the path exists under another method, else `404`.
 */
export function unmatchedRoute(app: Hono<AppEnv>) {
  return (c: Context<AppEnv>): never => {
    const path = new URL(c.req.url).pathname;
    const registered = ROUTED_METHODS.filter((method) => hasRegisteredOperation(app, method, path));
    const allowed = registered.includes('GET')
      ? (['GET', 'HEAD', ...registered.filter((method) => method !== 'GET')] as const)
      : registered;
    if (allowed.length > 0) throw new MethodNotAllowedError(allowed);
    throw new NotFoundError();
  };
}
