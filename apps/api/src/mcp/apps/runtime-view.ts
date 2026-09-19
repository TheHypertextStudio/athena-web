/**
 * `@docket/api` — the presentation half of the shared MCP App widget runtime.
 *
 * @remarks
 * `./runtime-script` holds the JSON-RPC transport; this holds what a widget actually calls —
 * the workflow-state glyphs, the date and label formatting, and the `docket` surface itself.
 * The two are concatenated into one program, so a widget still receives a single script.
 */

/**
 * The presentation half of the runtime: workflow glyphs, formatting, and the `docket` surface.
 *
 * @remarks
 * Separate from the transport above because it is what a widget actually calls. The two are joined
 * back into one program at export, so the document still receives a single script.
 */
export const RUNTIME_VIEW = String.raw`
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
      button.className = 'quiet open';
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
