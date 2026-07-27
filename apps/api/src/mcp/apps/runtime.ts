/**
 * `@docket/api` — the in-page runtime every Docket MCP App widget shares.
 *
 * @remarks
 * Implements the view side of the MCP Apps extension (`io.modelcontextprotocol/ui`, SEP-1865):
 * JSON-RPC 2.0 over `postMessage` to the host frame. Deliberately hand-written and inlined rather
 * than bundled from a package — the host serves these documents under a deny-all CSP, so there is
 * no network to fetch a library from, and a widget that cannot boot shows the user nothing.
 *
 * The handshake is the spec's, not a convention: the view sends `ui/initialize`, the host answers
 * with its capabilities and `hostContext`, the view announces `ui/notifications/initialized`, and
 * only then does the host deliver `ui/notifications/tool-result`. Rendering before that last step
 * would paint an empty card.
 */

/** The literal extension id, used for the `_meta` key and the capability declaration. */
export const UI_EXTENSION = 'io.modelcontextprotocol/ui';

/** The mimeType every `ui://` resource is served as. */
export const UI_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * The shared view-side JSON-RPC client, inlined into every widget.
 *
 * @remarks
 * Exposes `docket.onResult(fn)` for a widget to render from, `docket.call(tool, args)` to invoke a
 * server tool, `docket.tell(text)` to push what the user just did into the model's context, and
 * `docket.link(url)` to open Docket proper. Nothing else is global.
 *
 * `ui/update-model-context` matters more than it looks: without it the agent goes on describing a
 * change the user has already undone from the card, which is the single most confusing thing a
 * widget can do.
 */
export const RUNTIME_JS = String.raw`
(() => {
  const pending = new Map();
  let nextId = 1;
  let resultHandler = null;
  let lastResult = null;
  let toolInput = null;

  function post(msg) {
    window.parent.postMessage(msg, '*');
  }

  function request(method, params) {
    const id = 'v' + String(nextId++);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ jsonrpc: '2.0', id, method, params });
    });
  }

  function notify(method, params) {
    post({ jsonrpc: '2.0', method, params });
  }

  function applyTheme(hostContext) {
    const styles = hostContext && hostContext.styles;
    if (!styles) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(styles.variables || {})) {
      // The host owns the palette; a widget that hardcodes colour reads as a foreign object
      // inside someone else's theme.
      if (key.startsWith('--')) root.style.setProperty(key, String(value));
    }
    const fonts = styles.css && styles.css.fonts;
    if (fonts) {
      const el = document.createElement('style');
      el.textContent = String(fonts);
      document.head.appendChild(el);
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message || 'Host call failed'));
      else waiter.resolve(msg.result);
      return;
    }

    if (msg.method === 'ui/notifications/tool-input') {
      // The arguments the tool was called with. The card needs the orgId from here rather than
      // from the result, so no write tool has to widen its output schema to feed a widget.
      toolInput = (msg.params && msg.params.arguments) || null;
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') {
      lastResult = msg.params;
      if (resultHandler) resultHandler(msg.params);
      return;
    }
    if (msg.method === 'ui/notifications/host-context-changed') {
      applyTheme(msg.params && msg.params.hostContext);
      return;
    }
  });

  const ready = request('ui/initialize', {
    protocolVersion: '2026-01-26',
    capabilities: {},
    clientInfo: { name: 'docket-widget', version: '1.0.0' },
  })
    .then((result) => {
      applyTheme(result && result.hostContext);
      notify('ui/notifications/initialized', {});
      return result;
    })
    .catch(() => null);

  window.docket = {
    ready,
    onResult(fn) {
      resultHandler = fn;
      if (lastResult) fn(lastResult);
    },
    get input() {
      return toolInput || {};
    },
    call(name, args) {
      return request('tools/call', { name, arguments: args });
    },
    tell(text) {
      return request('ui/update-model-context', { content: [{ type: 'text', text }] });
    },
    link(url) {
      return request('ui/open-link', { url });
    },
    say(text) {
      return request('ui/message', { content: [{ type: 'text', text }] });
    },
  };
})();
`;

/**
 * The shared stylesheet, written entirely against host-supplied custom properties.
 *
 * @remarks
 * Every colour falls back to a neutral so a host that supplies no variables still renders
 * something legible rather than black-on-black. Inline widgets must not scroll or open popovers —
 * they sit inside someone else's transcript, and a nested scroll region there is a trap.
 */
export const RUNTIME_CSS = String.raw`
:root {
  --color-text-primary: var(--color-text-primary, #1a1a1a);
  --color-text-secondary: var(--color-text-secondary, #6b6b6b);
  --color-surface-primary: var(--color-surface-primary, #ffffff);
  --color-surface-secondary: var(--color-surface-secondary, #f4f4f5);
  --color-border-primary: var(--color-border-primary, #e4e4e7);
  --color-accent-primary: var(--color-accent-primary, #2563eb);
  --color-danger-primary: var(--color-danger-primary, #b91c1c);
  --font-family-sans: var(--font-family-sans, ui-sans-serif, system-ui, sans-serif);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-family-sans);
  color: var(--color-text-primary);
  background: transparent;
  font-size: 13px;
  line-height: 1.45;
}
.card {
  border: 1px solid var(--color-border-primary);
  border-radius: 10px;
  background: var(--color-surface-primary);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.headline { font-weight: 600; }
.muted { color: var(--color-text-secondary); }
.rows { display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--color-surface-secondary);
}
.row .name { font-weight: 500; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff { font-variant-numeric: tabular-nums; }
.diff .from { color: var(--color-text-secondary); text-decoration: line-through; }
.diff .to { color: var(--color-text-primary); font-weight: 500; }
.skipped .name { color: var(--color-text-secondary); }
.reason { color: var(--color-danger-primary); font-size: 12px; }
.actions { display: flex; gap: 8px; }
button {
  font: inherit;
  padding: 5px 11px;
  border-radius: 6px;
  border: 1px solid var(--color-border-primary);
  background: var(--color-surface-primary);
  color: var(--color-text-primary);
  cursor: pointer;
}
button:hover { background: var(--color-surface-secondary); }
button:disabled { opacity: 0.5; cursor: default; }
.empty { color: var(--color-text-secondary); }
`;

/**
 * Wrap a widget body in the shared document shell.
 *
 * @param title - The document title.
 * @param body - The widget's markup.
 * @param script - The widget's own script, run after {@link RUNTIME_JS}.
 * @returns a self-contained HTML document.
 */
export function appDocument(title: string, body: string, script: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${RUNTIME_CSS}</style>
</head>
<body>
${body}
<script>${RUNTIME_JS}</script>
<script>${script}</script>
</body>
</html>`;
}
