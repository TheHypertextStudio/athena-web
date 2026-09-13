/**
 * `@docket/api` — request credential selection for public REST and staff surfaces.
 */
import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv, CallerPrincipal } from '../context';
import { AuthError, CapabilityError } from '../error';
import { verifyRestBearer } from './oauth-bearer';

const BEARER = /^Bearer[\t ]+([A-Za-z0-9\-._~+/]+={0,})$/i;

function isRestOrAdmin(path: string): boolean {
  return (
    path === '/v1' || path.startsWith('/v1/') || path === '/admin' || path.startsWith('/admin/')
  );
}

/** Parse the single Bearer credential selected by Authorization header presence. */
export function parseBearerAuthorization(raw: string | null): string {
  const match = raw === null ? null : BEARER.exec(raw);
  const token = match?.[1];
  if (!token) throw new AuthError();
  return token;
}

/** Resolve a presented REST bearer once and install it as the request's only principal. */
export async function resolvePresentedRestBearer(
  c: Context<AppEnv>,
): Promise<CallerPrincipal | null> {
  if (!isRestOrAdmin(c.req.path)) return c.get('principal') ?? null;
  if (!c.req.raw.headers.has('authorization')) return c.get('principal') ?? null;
  const existing = c.get('principal');
  if (existing?.kind === 'oauth') return existing;
  c.set('session', null);
  c.set('principal', null);
  try {
    const principal = await verifyRestBearer(
      parseBearerAuthorization(c.req.raw.headers.get('authorization')),
    );
    c.set('principal', principal);
    return principal;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError();
  }
}

/** Resolve a REST bearer before root-mounted, typed, and staff route dispatch. */
export const principalMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await resolvePresentedRestBearer(c);
  await next();
};

/** Refuse a valid OAuth identity at a surface that accepts real browser sessions only. */
export const requireSessionPrincipal: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('principal')?.kind === 'oauth') throw new CapabilityError();
  if (!c.get('session')?.user) throw new AuthError();
  await next();
};

/** Preserve one exact public GET while keeping every other method session-only. */
export const requireSessionForNonGet: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'GET') {
    await next();
    return;
  }
  await requireSessionPrincipal(c, next);
};
