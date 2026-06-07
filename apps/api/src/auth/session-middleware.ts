/**
 * `@docket/api` — session middleware.
 */
import { auth } from '@docket/auth';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';

/** Resolve the Better Auth session from request headers into `c.var.session`. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('session', session);
  await next();
};
