import type { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';

import type { AppEnv } from './context';
import { buildCorsMiddleware } from './cors';
import {
  API_REVISION,
  API_VERSION,
  API_VERSION_HEADER,
  parseApiVersion,
  SUPPORTED_API_VERSIONS,
} from './api-version';
import { publicProblemTitle } from './contracts/errors';
import { problemTypeUrl } from './error';

function isPublicRestPath(path: string): boolean {
  return path === '/v1' || path.startsWith('/v1/');
}

function isControlPath(path: string): boolean {
  const canonical = path.replace(/\/+$/, '');
  return (
    ['/v1/docs', '/v1/openapi.json', '/v1/health'].includes(canonical) ||
    canonical.startsWith('/v1/docs/assets/')
  );
}

/** Install identity, CORS, canonical redirects, and version assertions before session resolution. */
export function registerPublicApiBoundary(
  server: Hono<AppEnv>,
  trustedOrigins: readonly string[],
): void {
  // CORS terminates preflights itself; the identity must wrap it to cover OPTIONS too.
  server.use('*', async (c, next) => {
    await next();
    if (!isPublicRestPath(c.req.path)) return;
    const headers = new Headers(c.res.headers);
    headers.set(API_VERSION_HEADER, API_VERSION);
    headers.set('Docket-Revision', API_REVISION);
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  });
  server.use('*', buildCorsMiddleware(trustedOrigins));
  // Canonical redirects must retain CORS and identity before any version rejection. The
  // conformance suite proves routes never end in a slash; unmatched routes throw, so the
  // default behavior that only rewrites a returned 404 cannot canonicalize this server.
  server.use('*', trimTrailingSlash({ alwaysRedirect: true }));
  server.use('*', async (c, next) => {
    if (!isPublicRestPath(c.req.path) || c.req.method === 'OPTIONS' || isControlPath(c.req.path)) {
      await next();
      return;
    }
    // Fetch combines repeated fields with commas. Reading the complete Headers value keeps
    // identical duplicates invalid too, instead of accidentally accepting the first value.
    const requestedVersion = c.req.raw.headers.get(API_VERSION_HEADER);
    if (parseApiVersion(requestedVersion) !== null) {
      await next();
      return;
    }
    return c.body(
      JSON.stringify({
        type: problemTypeUrl('unsupported_api_version'),
        title: publicProblemTitle('unsupported_api_version'),
        status: 400,
        code: 'unsupported_api_version',
        requestedVersion,
        supportedVersions: SUPPORTED_API_VERSIONS,
      }),
      400,
      { 'Content-Type': 'application/problem+json' },
    );
  });
}
