import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { CacheEnv, CacheHonoEnv } from './types';
import { parseCacheClients } from './clients';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const issuer = 'https://accounts.google.com';

/** Resolve only a cryptographically verified Google subject to its configured private namespace. */
async function authenticatedNamespace(token: string, env: CacheEnv): Promise<string | undefined> {
  const { payload } = await jwtVerify(token, googleKeys, {
    algorithms: ['RS256'],
    issuer,
    audience: env.OIDC_AUDIENCE,
    requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp'],
    maxTokenAge: '1h',
    clockTolerance: 5,
  });
  const clients = parseCacheClients(env.CACHE_CLIENTS);
  if (typeof payload.sub !== 'string' || !Object.hasOwn(clients, payload.sub)) return undefined;
  return clients[payload.sub];
}

/** Authenticate a Google-issued, short-lived token for a registered client and its private namespace. */
export const authorize: MiddlewareHandler<CacheHonoEnv> = async (c, next) => {
  const bearer = c.req.header('Authorization');
  if (!bearer?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  let team: string | undefined;
  try {
    team = await authenticatedNamespace(bearer.slice(7), c.env);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  if (!team) return c.json({ error: 'Unauthorized' }, 401);
  const query = new URL(c.req.url).searchParams;
  const requestedTeam = query.get('teamId') ?? query.get('slug');
  if (requestedTeam !== team) return c.json({ error: 'Forbidden' }, 403);
  if (query.getAll('teamId').length > 1 || query.getAll('slug').length > 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (query.has('teamId') && query.has('slug') && query.get('teamId') !== query.get('slug')) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  c.set('cacheTeam', team);
  return next();
};
