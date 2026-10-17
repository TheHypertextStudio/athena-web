import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { CacheEnv } from './types';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const issuer = 'https://accounts.google.com';

/** Authenticate a Google-issued, short-lived token for exactly the configured cache client. */
export const authorize: MiddlewareHandler<{ Bindings: CacheEnv }> = async (c, next) => {
  const bearer = c.req.header('Authorization');
  if (!bearer?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const token = bearer.slice(7);
  try {
    await jwtVerify(token, googleKeys, {
      algorithms: ['RS256'],
      issuer,
      audience: c.env.OIDC_AUDIENCE,
      subject: c.env.OIDC_SUBJECT,
      requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp'],
      maxTokenAge: '1h',
      clockTolerance: 5,
    });
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const query = new URL(c.req.url).searchParams;
  const team = query.get('teamId') ?? query.get('slug');
  if (team !== c.env.CACHE_TEAM) return c.json({ error: 'Forbidden' }, 403);
  if (query.getAll('teamId').length > 1 || query.getAll('slug').length > 1) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (query.has('teamId') && query.has('slug') && query.get('teamId') !== query.get('slug')) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return next();
};
