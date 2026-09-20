/** Serve the owned Scalar browser assets and the public and staff HTML shells. */
import type { Hono } from 'hono';

import type { AppEnv } from './context';
import {
  ADMIN_REFERENCE_SCRIPT,
  ADMIN_REFERENCE_SCRIPT_PATH,
  REFERENCE_FONT_PATH,
  REFERENCE_CSS,
  REFERENCE_SCRIPT,
  REFERENCE_SCRIPT_PATH,
  REFERENCE_STYLE_PATH,
  SCALAR_ASSET_PATH,
  adminReferenceHtml,
  publicReferenceHtml,
  referenceFontFile,
  scalarBrowserScript,
} from './openapi-reference';

const IMMUTABLE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' } as const;
const REFERENCE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function immutableAsset(body: string | Uint8Array, contentType: string): Response {
  const responseBody = typeof body === 'string' ? body : new Uint8Array(body);
  return new Response(responseBody, {
    headers: { ...IMMUTABLE_HEADERS, 'Content-Type': contentType },
  });
}

/** Register the local Scalar runtime, Docket loader, styles, and HTML entry points. */
export function registerReferenceAssets(server: Hono<AppEnv>): void {
  server.get(SCALAR_ASSET_PATH, () =>
    immutableAsset(scalarBrowserScript(), 'text/javascript; charset=utf-8'),
  );
  server.get(REFERENCE_FONT_PATH, () => immutableAsset(referenceFontFile(), 'font/woff2'));
  server.get(REFERENCE_SCRIPT_PATH, () =>
    immutableAsset(REFERENCE_SCRIPT, 'text/javascript; charset=utf-8'),
  );
  server.get(ADMIN_REFERENCE_SCRIPT_PATH, () =>
    immutableAsset(ADMIN_REFERENCE_SCRIPT, 'text/javascript; charset=utf-8'),
  );
  server.get(REFERENCE_STYLE_PATH, () => immutableAsset(REFERENCE_CSS, 'text/css; charset=utf-8'));
  server.get(
    '/v1/docs',
    () =>
      new Response(publicReferenceHtml(), {
        headers: {
          'Cache-Control': 'public, max-age=60, must-revalidate, stale-while-revalidate=300',
          'Content-Security-Policy': REFERENCE_CSP,
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
  );
  server.get(
    '/admin/docs',
    () =>
      new Response(adminReferenceHtml(), {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Security-Policy': REFERENCE_CSP,
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
  );
}
