/**
 * `@docket/api` — the view-side JSON-RPC client every Docket MCP App widget runs.
 *
 * @remarks
 * Split out of `./runtime`, which assembles the document this is inlined into. It lives as one
 * raw literal because it is a complete program the host iframe runs under a deny-all CSP: there
 * is no network to fetch a library from, and a widget that cannot boot shows the user nothing.
 */

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
const RUNTIME_TRANSPORT = String.raw`
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
`;

import { RUNTIME_VIEW } from './runtime-view';

/** The complete view-side runtime, transport then presentation. */
export const RUNTIME_JS = `${RUNTIME_TRANSPORT}${RUNTIME_VIEW}`;
