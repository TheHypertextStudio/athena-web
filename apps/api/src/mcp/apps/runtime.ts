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

import { RUNTIME_CSS } from './runtime-css';
import { UI_JS } from './runtime-ui';

export { RUNTIME_CSS } from './runtime-css';

/**
 * The shared view-side JSON-RPC client, inlined into every widget.
 *
 * @remarks
 * Exposes `docket.onData(fn)` for a widget to render from, `docket.call(tool, args)` to invoke a
 * server tool, `docket.link(url)` to open Docket proper, `docket.notice(text, tone)` to report a failure beside
 * content already on screen, and `docket.stateGlyph(type)` for the workflow-state icon. Nothing
 * else is global.
 *
 * `onData` rather than a raw result handler because loading, stalling, cancellation and failure
 * belong here, not in four widgets: each one would otherwise reimplement them, and the first
 * version of this surface simply did not — every card shipped with a hardcoded "Working…" that
 * never cleared.
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
    // A dimensions object that IS present is a complete statement about both axes, so the mode it
    // does not name has to be cleared. Leaving a stale max-height behind is how an inline cap
    // survives into fullscreen and clips the frame from the inside.
    const root = document.documentElement;
    if (typeof dims.height === 'number') {
      root.style.height = '100vh';
      root.style.removeProperty('max-height');
    } else if (typeof dims.maxHeight === 'number') {
      root.style.maxHeight = dims.maxHeight + 'px';
      root.style.removeProperty('height');
    }
    if (typeof dims.width === 'number') {
      root.style.width = '100vw';
      root.style.removeProperty('max-width');
    } else if (typeof dims.maxWidth === 'number') {
      root.style.maxWidth = dims.maxWidth + 'px';
      root.style.removeProperty('width');
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

  // Every table in these widgets is keyed by a value the host or the payload chose, so none of
  // them may use a plain property read: 'constructor', 'toString' and friends all resolve through
  // the prototype and defeat a truthy guard. One helper, shared, rather than five spellings.
  function own(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  }

  // The host tells us both, and neither is the browser's business: a plan rendered for someone in
  // New York must not shift three hours because the viewer's laptop is in Los Angeles.
  function locales() {
    const locale = lastHostContext && lastHostContext.locale;
    return typeof locale === 'string' && locale ? [locale] : [];
  }

  function withZone(options) {
    const zone = lastHostContext && lastHostContext.timeZone;
    return typeof zone === 'string' && zone ? Object.assign({ timeZone: zone }, options) : options;
  }

  function label(value) {
    const raw = String(value === null || value === undefined ? '' : value);
    const day = asDay(raw);
    if (day) {
      // Formatted without a timeZone for the same reason it is parsed at local midnight: this is a
      // calendar day, not an instant.
      return day.toLocaleDateString(locales(), { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // Only lower_snake wire enums get rewritten. A title, an id, a sentence, or anything a person
    // typed has to survive untouched, so the test is on the shape rather than on a list of keys.
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(raw)) {
      return raw;
    }
    const spaced = raw.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  // Shared so every widget spells a missing title the same way instead of each writing its own
  // 'Untitled <kind>' string — the kind names a real fact ("no name was captured for this task"),
  // where a bare 'Untitled' or the row's raw id would not.
  function untitled(kind) {
    return 'Untitled ' + (kind || 'item');
  }

  // Parsed at local midnight rather than as UTC, so a calendar day never slips backwards.
  function asDay(raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
      return null;
    }
    const day = new Date(raw + 'T00:00:00');
    return isNaN(day.getTime()) ? null : day;
  }

  // 'Sep 12' makes the reader work out today's date and subtract. This subtracts. Calendar days on
  // both sides, in the host's timezone: measured against a UTC 'now', a task due today reads as
  // yesterday for anyone west of Greenwich after 4pm.
  function due(iso) {
    const day = asDay(iso || '');
    if (!day) {
      return null;
    }
    const today = new Date(new Date().toLocaleDateString('en-CA', withZone({})) + 'T00:00:00');
    const days = Math.round((day.getTime() - today.getTime()) / 86400000);
    if (days < 0) {
      return { late: true, text: days === -1 ? 'a day late' : String(-days) + ' days late' };
    }
    // Inside a week the weekday is what a person plans against; past that it is a date.
    const when =
      days === 0
        ? 'today'
        : days === 1
          ? 'tomorrow'
          : days < 7
            ? day.toLocaleDateString(locales(), { weekday: 'long' })
            : day.toLocaleDateString(locales(), { month: 'short', day: 'numeric' });
    return { late: false, text: 'due ' + when };
  }

  function stateGlyph(type) {
    // own(), not STATE_GLYPHS[type]: the key comes off the wire, and a plain property read finds
    // inherited members — STATE_GLYPHS['constructor'] is a function, which passes a truthy guard
    // and lands stringified source in the card.
    const markup = own(STATE_GLYPHS, type);
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
    if (hostContext && hostContext.availableDisplayModes && modeHandler) {
      // Withdrawing a mode has to reach the widget too. Expand affordances are computed from
      // canDisplay(), so a host that drops 'fullscreen' would otherwise leave a button on screen
      // that refuses itself when clicked.
      modeHandler(displayMode);
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
      try {
        dataHandler(data, params);
      } catch {
        // A render that threw leaves the content block half-built. Staying in 'ready' would show a
        // blank bordered box claiming success, which is worse than the error state the runtime
        // already knows how to draw.
        setState('error', 'Docket sent something this card could not read.', 'error');
        return;
      }
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
    .catch(() => null);

  // Not chained off the handshake. Measuring has no dependency on it, and a host that answers
  // ui/initialize slowly — or never — would otherwise leave the card with no observer at all,
  // which is the clipping failure this whole loop exists to prevent.
  watchSize();

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
    /** The whole tool result, including the \`_meta\` a card reads its render model from. */
    get result() {
      return lastResult || {};
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
    /** A placeholder title for a row with none, naming its kind ('Untitled task') rather than its id. */
    untitled,
    /** A due date said the way a person reads one — 'due Tuesday', '3 days late' — or null. */
    due,
    /** Read a table keyed by an untrusted value without reaching Object.prototype. */
    own,
    /** Format an instant in the host's locale and timezone, never the browser's. */
    time(iso, options) {
      const when = new Date(iso);
      return isNaN(when.getTime()) ? '' : when.toLocaleTimeString(locales(), withZone(options));
    },
    /** Format a date in the host's locale and timezone, never the browser's. */
    date(iso, options) {
      const when = new Date(iso);
      return isNaN(when.getTime()) ? '' : when.toLocaleDateString(locales(), withZone(options));
    },
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
    link(url) {
      // ui/open-link takes a URL, and a host refuses anything that is not one — which is why
      // every "Open in Docket" was silently inert. Every href this server puts in a payload is a
      // path, so the origin is joined on here rather than at six call sites.
      const origin = window.__docketWebOrigin || '';
      return request('ui/open-link', {
        url: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : origin + url,
      });
    },
    say(text) {
      // The spec requires a role, and only 'user' is permitted.
      return request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
    },
    openButton(item) {
      // Every list tool puts an href on its rows, so a card never assembles a route or needs the
      // workspace id. Rows that predate that just get no button.
      if (!item.href) {
        return null;
      }
      const button = document.createElement('button');
      button.className = 'open';
      button.textContent = 'Open';
      button.setAttribute('aria-label', 'Open ' + (item.title || 'this') + ' in Docket');
      button.addEventListener('click', () => window.docket.link(item.href));
      return button;
    },
    resize: reportSize,
    get hostContext() {
      return lastHostContext || {};
    },
  };
})();
`;

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
 * Wrap one widget's script in the shared MCP app shell.
 *
 * @remarks
 * Every widget ships the same chrome — the stylesheet, the skeleton shown while the data arrives,
 * a status line for anything the widget needs to say, the runtime that swaps `data-state` once
 * content is ready, and the structural builders in `runtime-ui.ts`. A widget draws everything it
 * shows into the `#view` region with those builders, so no card can look like a different product
 * from the next one.
 *
 * Both display modes are declared by default: every card budgets what it shows inline, and
 * fullscreen is where the rest goes.
 *
 * @param title - The document title, also the card's accessible name.
 * @param script - The widget's own script, run after the shared runtime and builders.
 * @param options - `skeletonRows` sizes the placeholder to the real layout; `displayModes` declares
 *   which presentations the host may use.
 * @returns the complete HTML document.
 */
export function appDocument(
  title: string,
  script: string,
  options: { skeletonRows?: number; displayModes?: readonly ('inline' | 'fullscreen')[] } = {},
): string {
  const { skeletonRows = 2, displayModes = ['inline', 'fullscreen'] } = options;
  const rows = Array.from({ length: skeletonRows }, () => '<div class="sk sk-row"></div>').join(
    '\n    ',
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
  <div class="content" id="view"></div>
</section>
<script>${RUNTIME_JS}</script>
<script>${UI_JS}</script>
<script>${script}</script>
</body>
</html>`;
}
