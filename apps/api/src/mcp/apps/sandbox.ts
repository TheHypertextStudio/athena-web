/**
 * `@docket/api` — the MCP Apps sandbox proxy endpoint.
 *
 * @remarks
 * The MCP Apps spec requires a web host to render third-party widget HTML through an intermediate
 * proxy frame served from a DIFFERENT origin than the host page. Docket already has one: the web
 * app is `docket.<apex>` and this API is `api.docket.<apex>`, so serving the proxy from here
 * satisfies that requirement without inventing new infrastructure.
 *
 * The document served here is inert. It holds no session, reads no database, and its own CSP
 * forbids it from making a single network request — so even a total compromise of the widget
 * inside it cannot become a channel out. Its whole job is to own the `allow-same-origin`
 * privilege the inner frame must never have, apply the CSP the resource declared, and forward
 * messages verbatim in both directions.
 *
 * Deliberately unauthenticated: it contains no data. Access control lives on the routes that
 * hand it a document, not on the empty shell.
 */
import { MCP_APP_SANDBOX_CSP, sandboxProxyDocument } from '@docket/integrations';
import type { Context } from 'hono';

import { env } from '../../env';

/**
 * The single origin permitted to drive the sandbox proxy.
 *
 * @remarks
 * The web app's origin, from `WEB_URL`. This is the check that stops an unrelated page from
 * framing the proxy and injecting HTML of its own choosing into a frame the user might mistake
 * for Docket's.
 */
export function sandboxHostOrigin(): string {
  return new URL(env.WEB_URL).origin;
}

/**
 * Serve the sandbox proxy document.
 *
 * @remarks
 * Response headers matter as much as the body: the proxy's own CSP is applied as a real header
 * (not only a meta tag), `X-Frame-Options` is deliberately absent because being framed IS the
 * point, and `frame-ancestors` restricts who may frame it to the web app.
 *
 * @param _c - The Hono context. Unread: the document is identical for every caller, which is the
 *   point — it carries no session and no data.
 * @returns the proxy document.
 */
export function mcpAppSandboxHandler(_c: Context): Response {
  const origin = sandboxHostOrigin();
  return new Response(sandboxProxyDocument(origin), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `${MCP_APP_SANDBOX_CSP}; frame-ancestors ${origin}`,
      'Cache-Control': 'public, max-age=300',
      'Referrer-Policy': 'no-referrer',
      // The proxy is framed by design, so `X-Frame-Options` must NOT be set; `frame-ancestors`
      // above is the modern, origin-specific replacement and is what actually constrains it.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
