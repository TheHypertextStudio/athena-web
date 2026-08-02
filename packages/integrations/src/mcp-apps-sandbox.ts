/**
 * `@docket/integrations` — the MCP Apps **sandbox proxy** document.
 *
 * @remarks
 * The spec's §"Sandbox proxy" requirement for web hosts: a web page MUST NOT put untrusted widget
 * HTML directly in a frame it can reach: it wraps the View in an intermediate proxy served from a
 * DIFFERENT origin, and talks to the View only through that proxy.
 *
 * Docket already has a second origin — the API host — so the proxy is served from there and the
 * web app embeds it. The proxy holds nothing: no session, no storage, no API surface. It exists to
 * (a) own the `allow-same-origin` privilege the inner frame must not have, (b) apply the CSP the
 * resource declared, and (c) forward messages verbatim in both directions.
 *
 * What the proxy deliberately does NOT do: originate messages. It never synthesizes a request id
 * and never answers on the View's behalf, so every request the Host sees is one the View actually
 * made — which is the property the extension's auditability argument rests on.
 *
 * The document is a string rather than a bundled asset for the same reason the widget runtime is:
 * it runs under a policy that forbids fetching anything, so there is nothing to bundle from.
 */
import { MCP_UI_METHODS } from '@docket/types';

import {
  buildViewCsp,
  buildViewPermissionsAllow,
  MCP_APP_VIEW_SANDBOX,
  type McpAppResource,
} from './mcp-apps-host';

/**
 * The sandbox proxy's own Content-Security-Policy.
 *
 * @remarks
 * The proxy runs one inline script and nothing else. `frame-src 'self' data:` is what lets it
 * create the inner `srcdoc` frame; `connect-src 'none'` means the proxy itself can never phone
 * anywhere, so a compromise of the proxy origin cannot become an exfiltration channel.
 */
export const MCP_APP_SANDBOX_CSP = [
  `default-src 'none'`,
  `script-src 'unsafe-inline'`,
  `style-src 'unsafe-inline'`,
  `frame-src 'self' data:`,
  `connect-src 'none'`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `form-action 'none'`,
].join('; ');

/**
 * Prepend a `Content-Security-Policy` meta tag to a widget document.
 *
 * @remarks
 * A `srcdoc` frame has no response headers, so the policy has to travel inside the document, and
 * it only binds if it precedes everything it governs. Inserting immediately after `<head>` — or
 * synthesizing a head when the document has none — is what makes that true for real-world HTML
 * rather than only for well-formed HTML.
 *
 * @param html - The widget document as the server served it.
 * @param csp - The policy value to enforce.
 * @returns the document with the policy as the first thing in its head.
 */
export function withCspMeta(html: string, csp: string): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`;
  const headOpen = /<head(\s[^>]*)?>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  const htmlOpen = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  }
  return `<head>${tag}</head>${html}`;
}

/**
 * Everything the proxy needs to render one view, as it travels in `sandbox-resource-ready`.
 */
export interface SandboxResourcePayload {
  readonly html: string;
  readonly sandbox?: string;
  readonly csp?: McpAppResource['meta'] extends undefined ? never : unknown;
  readonly permissions?: unknown;
}

/**
 * Build the `ui/notifications/sandbox-resource-ready` params for a resource.
 *
 * @remarks
 * The CSP is computed host-side rather than left to the proxy, so the policy a view runs under is
 * decided by code the host controls and can log, not by a script running on the sandbox origin.
 *
 * @param resource - The UI resource being rendered.
 * @returns the notification params, ready to post to the proxy.
 */
export function sandboxResourceParams(resource: McpAppResource): Record<string, unknown> {
  const csp = buildViewCsp(resource.meta?.csp);
  return {
    html: withCspMeta(resource.text, csp),
    sandbox: MCP_APP_VIEW_SANDBOX,
    allow: buildViewPermissionsAllow(resource.meta?.permissions),
    csp: resource.meta?.csp ?? {},
    permissions: resource.meta?.permissions ?? {},
  };
}

/**
 * The sandbox proxy document.
 *
 * @remarks
 * Served with `MCP_APP_SANDBOX_CSP` and `X-Frame-Options` deliberately absent (it is meant to be
 * framed). It accepts exactly one `sandbox-resource-ready` and ignores any later attempt to swap
 * the document, so a compromised host tab cannot silently replace a widget the user is looking at
 * with a different one under the same frame.
 *
 * @param allowedHostOrigin - The single origin permitted to drive this proxy, or `'*'` when the
 *   host origin is not known at build time. A concrete origin is strongly preferred: it is the
 *   check that stops an unrelated page from framing the proxy and injecting its own HTML.
 * @returns the complete HTML document.
 */
export function sandboxProxyDocument(allowedHostOrigin: string): string {
  const originLiteral = JSON.stringify(allowedHostOrigin);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MCP App sandbox</title>
<style>html,body{margin:0;padding:0;height:100%;background:transparent}iframe{display:block;border:0;width:100%;height:100%;background:transparent}</style>
</head>
<body>
<script>
(() => {
  const HOST_ORIGIN = ${originLiteral};
  const RESOURCE_READY = ${JSON.stringify(MCP_UI_METHODS.sandboxResourceReady)};
  const PROXY_READY = ${JSON.stringify(MCP_UI_METHODS.sandboxProxyReady)};
  const SANDBOX_PREFIX = 'ui/notifications/sandbox-';
  let view = null;
  let loaded = false;

  function hostAllows(origin) {
    return HOST_ORIGIN === '*' || origin === HOST_ORIGIN;
  }

  function toHost(message) {
    parent.postMessage(message, HOST_ORIGIN);
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.jsonrpc !== '2.0') return;

    // View -> Host. The inner frame is sandboxed without allow-same-origin, so its origin is
    // opaque ('null'); identity is established by comparing the source window, not the origin.
    if (view && event.source === view.contentWindow) {
      if (typeof data.method === 'string' && data.method.indexOf(SANDBOX_PREFIX) === 0) return;
      toHost(data);
      return;
    }

    // Host -> View.
    if (event.source !== parent || !hostAllows(event.origin)) return;
    if (data.method === RESOURCE_READY) {
      // One document per proxy. A second attempt is ignored rather than honoured.
      if (loaded) return;
      loaded = true;
      const params = data.params || {};
      view = document.createElement('iframe');
      view.setAttribute('sandbox', typeof params.sandbox === 'string' ? params.sandbox : 'allow-scripts');
      if (typeof params.allow === 'string' && params.allow) view.setAttribute('allow', params.allow);
      view.setAttribute('referrerpolicy', 'no-referrer');
      view.srcdoc = String(params.html || '');
      document.body.appendChild(view);
      return;
    }
    if (typeof data.method === 'string' && data.method.indexOf(SANDBOX_PREFIX) === 0) return;
    if (!view || !view.contentWindow) return;
    view.contentWindow.postMessage(data, '*');
  });

  toHost({ jsonrpc: '2.0', method: PROXY_READY, params: {} });
})();
</script>
</body>
</html>`;
}
