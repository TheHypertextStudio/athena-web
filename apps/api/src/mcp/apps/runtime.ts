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
 *
 * Sizing is not optional and not the host's problem to guess. A host running flexible container
 * dimensions is required by the spec to size the frame from `ui/notifications/size-changed`, so a
 * widget that never measures itself gets whatever height the host defaulted to and clips its own
 * content. `watchSize` reports on every layout change for the life of the document.
 */
export const RUNTIME_JS = String.raw`
(() => {
  const pending = new Map();
  let nextId = 1;
  let resultHandler = null;
  let lastResult = null;
  let toolInput = null;
  let lastHostContext = null;

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
    if (!hostContext) {
      return;
    }
    const root = document.documentElement;

    // Pin color-scheme to what the host declares. This is what makes the stylesheet's light-dark()
    // fallbacks resolve to the host's theme rather than the viewer's OS setting — which matters
    // precisely because a host may supply some variables and not others, leaving our fallbacks to
    // fill the gaps. It also decides how native form controls render inside the frame.
    if (hostContext.theme === 'dark' || hostContext.theme === 'light') {
      root.style.colorScheme = 'only ' + hostContext.theme;
    }

    const styles = hostContext.styles;
    if (!styles) {
      return;
    }
    for (const [key, value] of Object.entries(styles.variables || {})) {
      // The host owns the palette; a widget that hardcodes colour reads as a foreign object
      // inside someone else's theme. An inline declaration outranks the stylesheet's :root
      // fallback, so supplying a variable is all a host has to do.
      if (key.startsWith('--')) {
        root.style.setProperty(key, String(value));
      }
    }
    const fonts = styles.css && styles.css.fonts;
    if (fonts) {
      const el = document.createElement('style');
      el.textContent = String(fonts);
      document.head.appendChild(el);
    }
  }

  function applyLocale(hostContext) {
    const locale = hostContext && hostContext.locale;
    // Without a lang a screen reader picks the wrong voice for every word on the card.
    document.documentElement.lang = typeof locale === 'string' && locale ? locale : 'en';
  }

  function applyContainerDimensions(hostContext) {
    // host-context-changed carries a PARTIAL context, so an absent key means "unchanged", never
    // "reset". Only act on dimensions the host actually sent.
    const dims = hostContext && hostContext.containerDimensions;
    if (!dims) {
      return;
    }
    const root = document.documentElement;
    if (typeof dims.height === 'number') {
      root.style.height = '100vh';
    } else if (typeof dims.maxHeight === 'number') {
      root.style.maxHeight = dims.maxHeight + 'px';
    }
    if (typeof dims.width === 'number') {
      root.style.width = '100vw';
    } else if (typeof dims.maxWidth === 'number') {
      root.style.maxWidth = dims.maxWidth + 'px';
    }
  }

  let reportedHeight = 0;
  let pendingFrame = 0;

  function reportSize() {
    if (pendingFrame) {
      return;
    }
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      const height = Math.ceil(document.body.scrollHeight);
      if (height === 0 || height === reportedHeight) {
        return;
      }
      reportedHeight = height;
      notify('ui/notifications/size-changed', {
        width: Math.ceil(document.body.scrollWidth),
        height,
      });
    });
  }

  function watchSize() {
    // A host running flexible dimensions sizes the frame from these notifications and from nothing
    // else. Without them the card keeps whatever height the host guessed and its content clips.
    if ('ResizeObserver' in window) {
      new ResizeObserver(reportSize).observe(document.body);
    } else {
      window.addEventListener('load', reportSize);
    }
    reportSize();
  }

  function applyHostContext(hostContext) {
    // Merged, not replaced: host-context-changed sends only what moved, and a widget that reads
    // availableDisplayModes or toolInfo off the last notification would lose them on a theme flip.
    if (hostContext) {
      lastHostContext = Object.assign({}, lastHostContext, hostContext);
    }
    applyTheme(hostContext);
    applyLocale(hostContext);
    applyContainerDimensions(hostContext);
    reportSize();
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') {
      return;
    }

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const waiter = pending.get(msg.id);
      if (!waiter) {
        return;
      }
      pending.delete(msg.id);
      if (msg.error) {
        waiter.reject(new Error(msg.error.message || 'Host call failed'));
      } else {
        waiter.resolve(msg.result);
      }
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
      if (resultHandler) {
        resultHandler(msg.params);
      }
      return;
    }
    if (msg.method === 'ui/notifications/tool-cancelled') {
      // No result is coming. A card that keeps its spinner forever is worse than one that says so.
      if (resultHandler) {
        resultHandler({ content: [], isError: true, cancelled: true });
      }
      return;
    }
    if (msg.method === 'ui/notifications/host-context-changed') {
      // The spec's params ARE the partial host context, not a wrapper around one.
      applyHostContext(msg.params);
      return;
    }
    if (msg.method === 'ui/resource-teardown' && msg.id !== undefined) {
      post({ jsonrpc: '2.0', id: msg.id, result: {} });
      return;
    }
  });

  const ready = request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: 'docket-widget', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  })
    .then((result) => {
      applyHostContext(result && result.hostContext);
      notify('ui/notifications/initialized', {});
      return result;
    })
    .catch(() => null)
    .finally(watchSize);

  window.docket = {
    ready,
    onResult(fn) {
      resultHandler = fn;
      if (lastResult) {
        fn(lastResult);
      }
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
      // The spec requires a role, and only 'user' is permitted.
      return request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
    },
    resize: reportSize,
    get hostContext() {
      return lastHostContext || {};
    },
  };
})();
`;

/**
 * The shared stylesheet, written entirely against the extension's standardized custom properties.
 *
 * @remarks
 * Every name used here is a member of the spec's `McpUiStyleVariableKey` union, which is what a
 * host actually supplies — asking for a name outside it means the declaration silently never
 * arrives. `runtime-tokens.test.ts` parses the vendored spec and fails the build if that drifts.
 *
 * The `:root` values are literals, never `var(--x, …)` self-references. A custom property that
 * references itself is a dependency cycle, and CSS resolves cycles to guaranteed-invalid *before*
 * it would reach the fallback — so a self-referencing declaration is not a default, it is a
 * deleted property. A host-supplied value arrives as an inline style on the root element and
 * outranks these regardless.
 *
 * The fallbacks are `light-dark()` pairs and both halves clear AA against the surface they sit on,
 * because the spec explicitly permits a host to supply some colours and not others. `color-scheme`
 * decides which half applies, and {@link RUNTIME_JS} pins it to the host's declared theme.
 *
 * Inline widgets must not scroll or open popovers — they sit inside someone else's transcript, and
 * a nested scroll region there is a trap.
 */
export const RUNTIME_CSS = String.raw`
:root {
  color-scheme: light dark;

  --color-background-primary: light-dark(#ffffff, #1c1c20);
  --color-background-secondary: light-dark(#f4f4f6, #26262c);
  --color-background-tertiary: light-dark(#e8e8ec, #303038);
  --color-text-primary: light-dark(#18181b, #f2f2f4);
  --color-text-secondary: light-dark(#52525b, #b1b1bd);
  --color-text-tertiary: light-dark(#6b6b76, #9595a1);
  --color-text-info: light-dark(#1d4ed8, #8ab0f8);
  --color-text-danger: light-dark(#b42318, #f9a8a0);
  --color-text-success: light-dark(#15803d, #7fd6a0);
  --color-border-primary: light-dark(#e4e4e7, #3a3a44);
  --color-ring-primary: light-dark(#2563eb, #8ab0f8);

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-text-sm-size: 0.8125rem;
  --font-text-md-size: 0.875rem;
  --font-text-sm-line-height: 1.4;
  --font-text-md-line-height: 1.45;
  --font-heading-xs-size: 0.9375rem;
  --font-heading-xs-line-height: 1.35;

  --border-radius-md: 6px;
  --border-radius-lg: 10px;
  --border-radius-full: 999px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  background: transparent;
  font-size: var(--font-text-md-size);
  line-height: var(--font-text-md-line-height);
}
.card {
  border: 1px solid var(--color-border-primary);
  border-radius: var(--border-radius-lg);
  background: var(--color-background-primary);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.headline {
  font-size: var(--font-heading-xs-size);
  line-height: var(--font-heading-xs-line-height);
  font-weight: var(--font-weight-semibold);
}
.muted { color: var(--color-text-secondary); }
.rows { display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--border-radius-md);
  background: var(--color-background-secondary);
}
.row .name { font-weight: var(--font-weight-medium); flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff { font-variant-numeric: tabular-nums; }
.diff .from { color: var(--color-text-secondary); text-decoration: line-through; }
.diff .to { color: var(--color-text-primary); font-weight: var(--font-weight-medium); }
.skipped .name { color: var(--color-text-secondary); }
.reason { color: var(--color-text-danger); font-size: var(--font-text-sm-size); }
.actions { display: flex; gap: 8px; }
button {
  font: inherit;
  padding: 5px 11px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-border-primary);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  cursor: pointer;
}
button:hover { background: var(--color-background-secondary); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--color-ring-primary); outline-offset: 2px; }
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
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
