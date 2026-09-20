/**
 * `@docket/api` — the in-page runtime every Docket MCP App widget shares.
 *
 * @remarks
 * Implements the view side of the MCP Apps extension (`io.modelcontextprotocol/ui`, SEP-1865):
 * JSON-RPC 2.0 over `postMessage` to the host frame. Deliberately hand-written and inlined rather
 * than bundled from a package — the host serves these documents under a deny-all CSP, so there is
 * no network to fetch a library from, and a widget that cannot boot shows the user nothing.
 *
 * The handshake is the spec's, not a convention: the view sends `ui/initialize` carrying
 * `appInfo`, `appCapabilities`, and `protocolVersion`; the host answers with its capabilities and
 * `hostContext`; the view announces `ui/notifications/initialized`; and only then does the host
 * deliver `ui/notifications/tool-input` and `ui/notifications/tool-result`. Rendering before that
 * last step would paint an empty card.
 */

/** The literal extension id, used for the `_meta` key and the capability declaration. */
export const UI_EXTENSION = 'io.modelcontextprotocol/ui';

/** The mimeType every `ui://` resource is served as. */
export const UI_MIME_TYPE = 'text/html;profile=mcp-app';

import { RUNTIME_JS } from './runtime-script';
import { RUNTIME_CSS } from './runtime-style';

/**
 * The composed document delegates view behavior to the inlined runtime fragments: `applyHostContext`
 * and `async requestDisplayMode(mode)` live in the view fragment, while `handleResult` and
 * `reportSize` live in the transport fragment. Keeping the assembly point explicit makes the
 * complete runtime contract discoverable without duplicating executable code.
 */

export { RUNTIME_JS } from './runtime-script';
export { RUNTIME_CSS } from './runtime-style';

/**
 * The product origin every widget link resolves against, with no trailing slash.
 *
 * @remarks
 * Read from `process.env` rather than through `@docket/env/api`, which is the one place in this
 * app that is worth doing. These documents are pure strings with no server behind them, and
 * `apps/web/e2e/mcp/widget-shots.spec.ts` imports them with no API environment at all to
 * photograph every widget — the validated env module throws on import there.
 *
 * Empty when unset, which leaves a link relative and therefore refused by the host. That is the
 * same outcome as before this existed, and it is confined to a deploy that configured no web URL.
 */
const WEB_ORIGIN = (process.env['WEB_URL'] ?? '').replace(/\/$/, '');

/**
 * Wrap one widget's markup in the shared MCP app shell.
 *
 * @remarks
 * Every widget ships the same chrome — the runtime stylesheet, the skeleton the host shows while
 * the data arrives, a status line for anything the widget needs to say, and the runtime script that
 * swaps `data-state` once content is ready. Building that here rather than per widget is what keeps
 * one widget's loading state from looking like a different product than the next one's.
 *
 * @param title - The document title, also the card's accessible name.
 * @param body - The widget's own markup, placed inside the content region.
 * @param script - The widget's own script, run after the shared runtime.
 * @param options - `skeletonRows` sizes the placeholder to the real layout; `displayModes` declares
 *   which presentations the host may use.
 * @returns the complete HTML document.
 */
export function appDocument(
  title: string,
  body: string,
  script: string,
  options: { skeletonRows?: number; displayModes?: readonly ('inline' | 'fullscreen')[] } = {},
): string {
  const { skeletonRows = 2, displayModes = ['inline'] } = options;
  const rows = Array.from({ length: skeletonRows }, () => '<div class="sk sk-row"></div>').join(
    '\n      ',
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>${RUNTIME_CSS}</style>
</head>
<body data-state="loading" data-display-mode="inline">
<script>window.__docketDisplayModes = ${JSON.stringify(displayModes)};window.__docketWebOrigin = ${JSON.stringify(WEB_ORIGIN)};</script>
<section class="card" aria-label="${title}">
  <div class="skeleton" aria-hidden="true">
    <div class="sk sk-headline"></div>
      ${rows}
  </div>
  <p class="status" role="status" hidden></p>
  <div class="content">
${body}
  </div>
</section>
<script>${RUNTIME_JS}</script>
<script>${script}</script>
</body>
</html>`;
}
