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
 * Exposes `docket.onData(fn)` for a widget to render from, `docket.call(tool, args)` to invoke a
 * server tool, `docket.tell(text)` to push what the user just did into the model's context,
 * `docket.link(url)` to open Docket proper, `docket.notice(text, tone)` to report a failure beside
 * content already on screen, and `docket.stateGlyph(type)` for the workflow-state icon. Nothing
 * else is global.
 *
 * `onData` rather than a raw result handler because loading, stalling, cancellation and failure
 * belong here, not in four widgets: each one would otherwise reimplement them, and the first
 * version of this surface simply did not — every card shipped with a hardcoded "Working…" that
 * never cleared.
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

  // The Linear-style state grammar from @docket/ui's StatusIcon, hand-written because a widget has
  // no icon library and nothing to fetch one from. Ring, dashed ring, ring-with-dot, filled check,
  // filled cross — keyed off the canonical type, never the free-form per-team state key, so a team
  // that renames "In Progress" still gets the started treatment.
  const STATE_GLYPHS = {
    backlog:
      '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.6 2.2"/></svg>',
    unstarted:
      '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    started:
      '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.8" fill="currentColor"/></svg>',
    completed:
      '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.8" fill="currentColor"/><path d="M5 8.2 7 10.2 11 6.1" fill="none" stroke="var(--color-background-primary)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    canceled:
      '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.8" fill="currentColor"/><path d="M5.9 5.9 10.1 10.1M10.1 5.9 5.9 10.1" fill="none" stroke="var(--color-background-primary)" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };

  function label(value) {
    const raw = String(value === null || value === undefined ? '' : value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const when = new Date(raw + 'T00:00:00');
      // The host told us its locale, so a date reads the way the reader writes dates.
      return isNaN(when.getTime())
        ? raw
        : when.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // Only lower_snake wire enums get rewritten. A title, an id, a sentence, or anything a person
    // typed has to survive untouched, so the test is on the shape rather than on a list of keys.
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(raw)) {
      return raw;
    }
    const spaced = raw.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function stateGlyph(type) {
    const markup = STATE_GLYPHS[type];
    if (!markup) {
      // No glyph beats a wrong glyph: an unresolved type means the owning team no longer lists
      // that state key, and guessing one from the key is the mistake the type exists to prevent.
      return null;
    }
    const span = document.createElement('span');
    span.className = 'glyph state-' + type;
    // The state is already spelled out in the row's text, so the glyph is decoration.
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = markup;
    return span;
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
    if (hostContext && hostContext.displayMode) {
      // The host can move the view on its own — a fullscreen card dismissed from the host's own
      // chrome arrives here as a context change, not as a reply to anything the view asked for.
      setDisplayMode(hostContext.displayMode);
    }
    reportSize();
  }

  // How long a card waits before it stops implying the work is nearly done, and before it stops
  // claiming anything is happening at all. A card that shows a spinner forever is a lie the user
  // cannot detect: the tool may have failed, the host may have dropped the result, or the agent may
  // have moved on, and all three look identical to a permanent "Working…".
  const STALL_MS = 20000;
  const GIVE_UP_MS = 90000;

  let dataHandler = null;
  let stallTimer = 0;
  let giveUpTimer = 0;

  function clearTimers() {
    window.clearTimeout(stallTimer);
    window.clearTimeout(giveUpTimer);
    stallTimer = 0;
    giveUpTimer = 0;
  }

  function setStatus(message, tone) {
    const status = document.querySelector('.status');
    if (status) {
      status.textContent = message || '';
      status.hidden = !message;
      if (tone) {
        status.dataset.tone = tone;
      } else {
        delete status.dataset.tone;
      }
    }
    reportSize();
  }

  function setState(state, message, tone) {
    document.body.dataset.state = state;
    setStatus(message, tone);
  }

  function handleResult(params) {
    clearTimers();
    if (params && params.cancelled) {
      setState('error', 'That was cancelled before it finished.', 'error');
      return;
    }
    if (params && params.isError) {
      // The tool's own error text is not shown. It may be a stack trace, and on a connected server
      // it is someone else's prose appearing inside a Docket card.
      setState('error', 'Docket could not finish that.', 'error');
      return;
    }
    const data = params && params.structuredContent;
    if (!data) {
      setState('error', 'Docket did not send anything to show.', 'error');
      return;
    }
    setState('ready');
    if (dataHandler) {
      dataHandler(data, params);
    }
    reportSize();
  }

  function startWaiting() {
    clearTimers();
    setState('loading');
    stallTimer = window.setTimeout(() => {
      setState('stalled', 'Still working…');
    }, STALL_MS);
    giveUpTimer = window.setTimeout(() => {
      setState('error', 'No result arrived. Open Docket to check whether this went through.', 'error');
    }, GIVE_UP_MS);
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
      handleResult(msg.params);
      return;
    }
    if (msg.method === 'ui/notifications/tool-cancelled') {
      // No result is coming. A card that keeps its spinner forever is worse than one that says so.
      lastResult = { content: [], cancelled: true };
      handleResult(lastResult);
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

  // Declared per document, not per runtime. The spec forbids a host switching a view into a mode
  // it never claimed, so a card with nothing more to show at full size says so by not asking.
  const MODES = window.__docketDisplayModes || ['inline'];

  let displayMode = 'inline';
  let modeHandler = null;

  function setDisplayMode(mode) {
    if (!mode || mode === displayMode) {
      return;
    }
    displayMode = mode;
    document.body.dataset.displayMode = mode;
    if (modeHandler) {
      modeHandler(mode);
    }
    reportSize();
  }

  const ready = request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: 'docket-widget', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: MODES },
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
    /**
     * Render from the tool's structured output.
     *
     * The runtime owns loading, stalled, cancelled, and error. The handler runs only when there
     * is something real to draw, so no widget has to reimplement the four ways a result can fail
     * to arrive — which is how the old cards ended up on a hardcoded "Working…" and nothing else.
     */
    onData(fn) {
      dataHandler = fn;
      if (lastResult) {
        handleResult(lastResult);
      } else {
        startWaiting();
      }
    },
    get input() {
      return toolInput || {};
    },
    /**
     * Say something alongside content that is already on screen.
     *
     * Distinct from the runtime's own states: this is for a failure that happens *after* the card
     * rendered, such as an undo the server refused, where hiding what the user is looking at would
     * lose the very context the message is about.
     */
    notice(message, tone) {
      setStatus(message, tone);
    },
    /** The status glyph for a canonical workflow-state type, or null when it does not resolve. */
    stateGlyph,
    /** A wire value rendered for a person: snake_case enums and ISO dates, everything else as-is. */
    label,
    /** The mode the view is currently displayed in. */
    get displayMode() {
      return displayMode;
    },
    /** Whether the host says this view can be shown at 'mode' right now. */
    canDisplay(mode) {
      const available = (lastHostContext && lastHostContext.availableDisplayModes) || [];
      return MODES.indexOf(mode) !== -1 && available.indexOf(mode) !== -1;
    },
    /** Re-render when the mode changes, from either side. */
    onDisplayMode(fn) {
      modeHandler = fn;
      fn(displayMode);
    },
    /**
     * Ask the host to show this view at 'mode'.
     *
     * @remarks
     * Three spec requirements in one call, all of them MUSTs: check the host's
     * 'availableDisplayModes' before asking, accept that the answer may be a different mode than
     * the one requested, and render whatever comes back. A view that assumed its request was
     * granted would draw a fullscreen layout inside an inline frame.
     */
    async requestDisplayMode(mode) {
      if (!window.docket.canDisplay(mode)) {
        return displayMode;
      }
      try {
        const result = await request('ui/request-display-mode', { mode });
        setDisplayMode((result && result.mode) || displayMode);
      } catch {
        // A refusal is an answer. The card stays where it is rather than reporting a failure the
        // person did not cause.
      }
      return displayMode;
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

  /* Workflow-state colours, which the extension standardizes no vocabulary for. These are
     Docket's own --state-* ramp verbatim, so a card in a foreign host still reads in Docket's
     state language; Docket's own host overrides them with the live tokens. Anything outside the
     spec's union has to be declared here or the widget receives nothing — see WIDGET_OWNED in
     mcp-apps-tokens.test.ts. */
  --state-backlog: light-dark(oklch(0.5 0 0), oklch(0.72 0 0));
  --state-unstarted: light-dark(oklch(0.5 0.06 250), oklch(0.75 0.06 250));
  --state-started: light-dark(oklch(0.52 0.15 250), oklch(0.78 0.13 250));
  --state-completed: light-dark(oklch(0.52 0.15 150), oklch(0.78 0.14 150));
  --state-canceled: light-dark(oklch(0.5 0.03 25), oklch(0.72 0.03 25));
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  background: transparent;
  font-size: var(--font-text-md-size);
  line-height: var(--font-text-md-line-height);
  /* The card reflows against the width it is actually given, not the viewport. A widget has no
     idea how wide the transcript around it is, and on a phone that is 320px. */
  container-type: inline-size;
}

/* The four ways a card can be, exactly one at a time. */
body[data-state='loading'] .content,
body[data-state='stalled'] .content,
body[data-state='error'] .content { display: none; }
body[data-state='ready'] .skeleton,
body[data-state='error'] .skeleton { display: none; }

.skeleton { display: flex; flex-direction: column; gap: 8px; }
.sk { background: var(--color-background-secondary); border-radius: var(--border-radius-md); }
.sk-headline { height: 0.9375rem; width: 42%; }
.sk-row { height: 1.75rem; }
@media (prefers-reduced-motion: no-preference) {
  .sk { animation: sk-pulse 1.4s ease-in-out infinite; }
}
@keyframes sk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.status { margin: 0; color: var(--color-text-secondary); }
.status[data-tone='error'] { color: var(--color-text-danger); }

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
.diff {
  font-variant-numeric: tabular-nums;
  /* A diff line summarises what moved. Two lines is the most it can take before it stops being a
     line and starts being the document it is describing. */
  min-width: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
.diff .from { color: var(--color-text-secondary); text-decoration: line-through; }
.diff .to { color: var(--color-text-primary); font-weight: var(--font-weight-medium); }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }

/* Fullscreen is the one place a card may scroll: it is no longer sitting in the transcript flow,
   so a scroll region here traps nothing. The card loses its own frame because the host is now
   drawing one around the whole surface. */
body[data-display-mode='fullscreen'] { height: 100vh; }
body[data-display-mode='fullscreen'] .card {
  height: 100vh;
  border: 0;
  border-radius: 0;
}
body[data-display-mode='fullscreen'] .rows {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.skipped .name { color: var(--color-text-secondary); }
.reason { color: var(--color-text-danger); font-size: var(--font-text-sm-size); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
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

/* One bordered action per card and the rest quiet. Filling a button would mean choosing a
   foreground against a host-supplied colour whose contrast nobody here can check. */
button.quiet {
  border-color: transparent;
  background: transparent;
  color: var(--color-text-secondary);
}
button.quiet:hover { background: var(--color-background-secondary); color: var(--color-text-primary); }

/* The two edits someone makes with the card in front of them. Native select and date input on
   purpose: they open the host's own picker outside this frame, they are keyboard-operable and
   labelled for free, and an inline widget must not open a popover of its own inside someone
   else's transcript. */
.edits { display: flex; flex-wrap: wrap; gap: 8px; }
.field { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.field-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
}
select,
input[type='date'] {
  font: inherit;
  min-height: 1.75rem;
  padding: 3px 8px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-border-primary);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  max-width: 100%;
}
select:focus-visible,
input[type='date']:focus-visible {
  outline: 2px solid var(--color-ring-primary);
  outline-offset: 2px;
}
select:disabled,
input[type='date']:disabled { opacity: 0.5; }

/* Names the block below it. A group of rows with no heading reads as more of the same thing,
   which for skipped work is the opposite of true. */
.group-label {
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-weight: var(--font-weight-medium);
}
.empty { color: var(--color-text-secondary); }

/* A tick is the one control someone taps rather than clicks, so it carries a real target even
   though the glyph inside it is small. */
.tick {
  flex: 0 0 auto;
  width: 1.75rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
}
.tick[aria-checked='true'] { color: var(--color-text-success); }
.row .name.done { text-decoration: line-through; color: var(--color-text-secondary); }

/* The state glyph is the one piece of this card that is unmistakably Docket, so it renders at the
   product's 16px icon floor rather than shrinking to fit a dense row. */
.glyph { flex: 0 0 auto; display: inline-flex; width: 1rem; height: 1rem; }
.glyph svg { width: 1rem; height: 1rem; display: block; }
.state-backlog { color: var(--state-backlog); }
.state-unstarted { color: var(--state-unstarted); }
.state-started { color: var(--state-started); }
.state-completed { color: var(--state-completed); }
.state-canceled { color: var(--state-canceled); }

@container (max-width: 380px) {
  /* Below this the title and its diff cannot share a line without one of them becoming unreadable.
     Stacking is a decision; ellipsising a title down to "LV…" is an accident. */
  .row { flex-direction: column; align-items: stretch; gap: 2px; }
  .row .name { white-space: normal; overflow: visible; text-overflow: clip; }
  .row:has(.tick) { flex-direction: row; align-items: center; }
  .tick { width: 2.5rem; height: 2.5rem; }
  .actions button { flex: 1 1 auto; min-height: 2.5rem; }
  .field { width: 100%; }
  .field select,
  .field input[type='date'] { flex: 1 1 auto; min-height: 2.5rem; }
}
`;

/**
 * Wrap a widget body in the shared document shell.
 *
 * @remarks
 * The card chrome, the loading skeleton, and the status line live here rather than in each widget,
 * because every one of them needs all three and the four ways a result can fail to arrive are not
 * a widget's business. A widget supplies only what it draws when there is something to draw.
 *
 * @param title - The document title, and the accessible name of the card.
 * @param body - The widget's own markup, rendered inside `.content`.
 * @param script - The widget's own script, run after {@link RUNTIME_JS}.
 * @param skeletonRows - How many placeholder rows to show while waiting, matched to the widget's
 *   usual density so the card does not jump size when the real content lands.
 * @returns a self-contained HTML document.
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
<script>window.__docketDisplayModes = ${JSON.stringify(displayModes)};</script>
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
