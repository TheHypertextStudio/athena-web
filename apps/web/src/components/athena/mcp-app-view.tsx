'use client';

import { type JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createMcpAppHost,
  MCP_APP_PROXY_SANDBOX,
  sandboxResourceParams,
  type JsonRpcMessage,
  type McpAppHost,
  type McpAppResource,
} from '@docket/integrations/mcp-apps';
import {
  MCP_UI_METHODS,
  type McpUiContentBlock,
  type McpUiDisplayMode,
  type McpUiHostContext,
  type McpUiHostStyles,
  type McpUiTheme,
} from '@docket/types';
import { Text } from '@docket/ui/primitives';

import { UserFacingError } from '@/lib/problem';

/**
 * The MCP Apps host surface: a third-party widget rendered inside the Athena conversation.
 *
 * @remarks
 * The protocol lives in `@docket/integrations`; this component is the browser adapter around it.
 * It owns three things the bridge cannot:
 *
 * 1. **The frames.** The spec requires a web host to wrap untrusted widget HTML in a proxy frame
 *    served from a DIFFERENT origin. Docket's API origin serves that proxy, so the widget never
 *    runs in a document that could reach the app's cookies, storage, or DOM. The inner frame gets
 *    `allow-scripts` and nothing else — no origin, no top-level navigation, no forms.
 * 2. **The theme.** The host pushes `ui/notifications/host-context-changed` when the colour scheme
 *    flips, so the widget restyles in place rather than reloading. A reload would lose whatever
 *    the user had done inside it.
 * 3. **Height.** A widget reports its own size; the frame follows it, so a card never sits in a
 *    fixed box with its own scrollbar inside someone else's transcript.
 */
export interface McpAppViewProps {
  /** The `ui://` document to render, as the connected server served it. */
  readonly resource: McpAppResource;
  /** The tool call that produced it. */
  readonly tool: { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>> };
  /** The tool's result, delivered to the view once it finishes its handshake. */
  readonly result: Readonly<Record<string, unknown>>;
  /** Human-readable name of the server the widget came from, shown on the frame's chrome. */
  readonly serverName: string;
  /** Run a tool the widget asked for. Rejecting refuses the call. */
  readonly onCallTool: (
    name: string,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>;
  /** Post a message the widget composed into the conversation. */
  readonly onMessage?: (text: string) => Promise<boolean> | boolean;
  /** Overrides the API origin the sandbox proxy is served from. Tests only. */
  readonly sandboxOrigin?: string;
}

/** How tall a card starts out before the widget reports its own size. */
const INITIAL_HEIGHT = 96;

/** The widest a card may grow before it gets its own scroll region. */
const MAX_HEIGHT = 640;

/** Maximum time a sandboxed app may take to complete its official initialization handshake. */
const MCP_APP_INITIALIZATION_TIMEOUT_MS = 5_000;

/**
 * Docket token → the style variable the extension standardizes.
 *
 * @remarks
 * Every key here is a member of the spec's `McpUiStyleVariableKey` union. A key outside it is not
 * a customization, it is a value the widget will never receive, so the vocabulary is the contract.
 * `--font-sans` is deliberately absent: it is resolved from a real element rather than read as a
 * token, for the reason spelled out in {@link hostStyleVariables}.
 */
const STYLE_VARIABLE_MAP: Readonly<Record<string, string>> = {
  '--color-background-primary': '--color-surface-container-low',
  '--color-background-secondary': '--color-surface-container',
  '--color-background-tertiary': '--color-surface-container-high',
  '--color-background-danger': '--color-error-container',
  '--color-text-primary': '--color-on-surface',
  '--color-text-secondary': '--color-on-surface-variant',
  '--color-text-tertiary': '--color-outline',
  '--color-text-info': '--color-primary',
  '--color-text-danger': '--color-error',
  '--color-border-primary': '--color-outline-variant',
  '--color-border-secondary': '--color-outline',
  '--color-ring-primary': '--color-primary',
  '--border-radius-md': '--radius-md',
  '--border-radius-lg': '--radius-lg',
  '--border-radius-xl': '--radius-xl',
};

/**
 * Docket-specific variables a widget owns, sent only because Docket is the host.
 *
 * @remarks
 * Kept separate from {@link STYLE_VARIABLE_MAP} so that map's invariant stays true: every key in
 * it is a member of the extension's standardized union. These names are not, and cannot be — the
 * spec has no vocabulary for workflow state. A Docket widget declares its own fallbacks for them
 * and a foreign host simply never sends them, which is the intended degradation.
 */
const DOCKET_VARIABLE_MAP: Readonly<Record<string, string>> = {
  '--state-backlog': '--color-state-backlog',
  '--state-unstarted': '--color-state-unstarted',
  '--state-started': '--color-state-started',
  '--state-completed': '--color-state-completed',
  '--state-canceled': '--color-state-canceled',
};

/**
 * The API origin the sandbox proxy is served from.
 *
 * @remarks
 * Deliberately NOT the same-origin `/v1` proxy the rest of the app uses. The whole security
 * argument for the proxy is that it does not share an origin with the host page, so this must be
 * the real API origin even though every other request in the app is relative.
 */
function sandboxProxyUrl(override?: string): string {
  const origin = override ?? process.env['NEXT_PUBLIC_API_URL'] ?? '';
  return `${origin.replace(/\/$/, '')}/mcp/apps/sandbox`;
}

/** Read the colour scheme the app is currently rendering under. */
function currentTheme(): McpUiTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const attribute = document.documentElement.dataset['theme'];
  if (attribute === 'dark' || attribute === 'light') {
    return attribute;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Translate Docket's MD3 tokens into the style variables the extension standardizes.
 *
 * @remarks
 * The spec defines a fixed vocabulary of `--color-*` / `--font-*` custom properties that hosts
 * supply and widgets consume. Docket's own tokens have different names, so the bridge is where
 * they are mapped — a widget must never have to know what a Docket token is called, and Docket
 * must never adopt a foreign token name to make one happy.
 *
 * Values are resolved from the live computed style rather than hard-coded, so a widget tracks the
 * app's real palette in both themes and after any future token change.
 */
function hostStyleVariables(): NonNullable<McpUiHostStyles['variables']> {
  if (typeof window === 'undefined') {
    return {} as NonNullable<McpUiHostStyles['variables']>;
  }
  // Read off `body`, not `documentElement`. `next/font` declares its family variable on a class
  // further down the tree, so a token that references it is unresolved at the root — which is how
  // `--font-sans` used to reach widgets as the literal text `var(--font-ibm-plex-sans), …` and take
  // the whole `font-family` declaration down with it. Body inherits everything the root defines and
  // sees the font variable as well.
  const computed = window.getComputedStyle(document.body);
  const read = (token: string): string => computed.getPropertyValue(token).trim();

  const variables: Record<string, string> = {};
  for (const [key, docketToken] of [
    ...Object.entries(STYLE_VARIABLE_MAP),
    ...Object.entries(DOCKET_VARIABLE_MAP),
  ]) {
    const value = read(docketToken);
    if (value) {
      variables[key] = value;
    }
  }

  // The resolved stack, not the token. It still names the generated `@font-face` family first, and
  // the widget cannot load that font under `font-src 'self'` in an opaque origin — but the rest of
  // the stack is real, so the card lands on the same system sans the app falls back to rather than
  // on the browser's default serif.
  const fontFamily = computed.fontFamily.trim();
  if (fontFamily) {
    variables['--font-sans'] = fontFamily;
  }
  return variables as NonNullable<McpUiHostStyles['variables']>;
}

/**
 * Build the host context handed to a view.
 *
 * @param maxWidth - The measured width of the frame's container, when it is known.
 * @returns the context to send on `ui/initialize` and to patch on any later change.
 */
function buildHostContext(maxWidth?: number): McpUiHostContext {
  return {
    theme: currentTheme(),
    styles: { variables: hostStyleVariables() },
    displayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    // Flexible on both axes, never fixed. A card in a transcript should be exactly as tall as what
    // it has to say, which means the view measures and the frame follows — the alternative is a
    // guessed height that either clips the content or leaves dead space under it.
    containerDimensions: {
      maxHeight: MAX_HEIGHT,
      ...(typeof maxWidth === 'number' && maxWidth > 0 ? { maxWidth: Math.round(maxWidth) } : {}),
    },
    platform: 'web',
    userAgent: 'docket-athena',
    ...(typeof Intl === 'undefined'
      ? {}
      : { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    ...(typeof navigator === 'undefined' ? {} : { locale: navigator.language }),
  };
}

/**
 * Render one MCP Apps widget.
 *
 * @param props - The resource, the tool call behind it, and the host callbacks.
 * @returns the framed widget.
 */
export function McpAppView(props: McpAppViewProps): JSX.Element | null {
  const { resource, tool, result, serverName, onCallTool, onMessage, sandboxOrigin } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const hostRef = useRef<McpAppHost | null>(null);
  const onCallToolRef = useRef(onCallTool);
  const onMessageRef = useRef(onMessage);
  onCallToolRef.current = onCallTool;
  onMessageRef.current = onMessage;
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [displayMode, setDisplayMode] = useState<McpUiDisplayMode>('inline');
  const [failure, setFailure] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  const proxyUrl = useMemo(() => sandboxProxyUrl(sandboxOrigin), [sandboxOrigin]);
  const proxyOrigin = useMemo(() => {
    try {
      return new URL(proxyUrl).origin;
    } catch {
      return '';
    }
  }, [proxyUrl]);
  const presentationIdentity = `${resource.uri}\u0000${tool.name}`;

  // The proxy can finish loading immediately after the iframe enters the DOM. Install the message
  // listener in the same commit, before paint, so its one-shot `sandbox/proxy-ready` announcement
  // cannot race a passive effect and leave the widget waiting forever for its resource document.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !proxyOrigin) {
      return;
    }

    let proxyWindow: Window | null = frame.contentWindow;
    let lifecycleResource: McpAppResource | null = resource;
    let initializationDeadline: number | undefined;
    let disposed = false;
    let disposal: Promise<void> | null = null;
    let onWindowMessage: ((event: MessageEvent) => void) | null = null;
    let host: McpAppHost | null = null;
    const clearInitializationDeadline = (): void => {
      if (initializationDeadline !== undefined) {
        window.clearTimeout(initializationDeadline);
        initializationDeadline = undefined;
      }
    };
    const release = (): void => {
      if (disposed) return;
      disposed = true;
      clearInitializationDeadline();
      if (onWindowMessage) window.removeEventListener('message', onWindowMessage);
      frame.removeEventListener('error', onFrameError);
      if (hostRef.current === host) hostRef.current = null;
      host?.close();
      host = null;
      proxyWindow = null;
      lifecycleResource = null;
    };
    const dispose = (graceful: boolean): Promise<void> => {
      if (disposal) return disposal;
      disposal = (async () => {
        if (graceful && host?.initialized) {
          await host.requestTeardown().catch(() => undefined);
        }
        release();
      })();
      return disposal;
    };
    const fail = (): void => {
      setFailure('Interactive view unavailable.');
      void dispose(false);
    };
    const onFrameError = (): void => {
      fail();
    };
    frame.addEventListener('error', onFrameError);
    const post = (message: JsonRpcMessage): void => {
      const target = frame.contentWindow ?? proxyWindow;
      target?.postMessage(message, proxyOrigin || '*');
    };

    host = createMcpAppHost({
      hostInfo: { name: 'docket-athena', version: '1.0.0' },
      resource,
      tool: { name: tool.name, ...(tool.arguments ? { arguments: tool.arguments } : {}) },
      hostContext: buildHostContext(containerRef.current?.clientWidth),
      post,
      callTool: (name, args) => onCallToolRef.current(name, args),
      // Scope: the API decides. The browser holds no credential for the connected server, so an
      // unauthorized call fails there, not here — but the bridge still requires an explicit
      // allow, so a widget can never reach a tool the host did not intend to expose.
      authorizeTool: () => ({ allowed: true }),
      // The bridge already refuses a mode the view never declared, so this only has to decide
      // whether Docket will honour it — and it will, for the two the spec defines.
      requestDisplayMode: (mode) => {
        setDisplayMode(mode);
        return mode;
      },
      openLink: (url) => {
        // The frame itself can never navigate: it has no `allow-top-navigation`. Off-origin
        // targets open in a new tab with the opener severed; anything that is not http(s) is
        // refused outright rather than handed to the browser.
        let parsed: URL;
        try {
          parsed = new URL(url, window.location.href);
        } catch {
          return false;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return false;
        }
        if (parsed.origin === window.location.origin) {
          window.location.assign(parsed.href);
          return true;
        }
        const opened = window.open(parsed.href, '_blank', 'noopener,noreferrer');
        return opened !== null;
      },
      ...(onMessageRef.current
        ? {
            sendMessage: async (content: readonly McpUiContentBlock[]) => {
              const text = content
                .map((block) => (block.type === 'text' ? block.text : ''))
                .filter(Boolean)
                .join('\n');
              if (!text) {
                return false;
              }
              return (await onMessageRef.current?.(text)) ?? false;
            },
          }
        : {}),
      onSizeChanged: ({ height: reported }) => {
        if (typeof reported === 'number' && reported > 0) {
          setHeight(Math.min(Math.max(reported, 96), MAX_HEIGHT));
        }
      },
      onRequestTeardown: () => {
        void dispose(true).finally(() => {
          setVisible(false);
        });
      },
    });
    hostRef.current = host;

    onWindowMessage = (event: MessageEvent): void => {
      if (disposed) return;
      if (event.source !== frame.contentWindow) {
        return;
      }
      proxyWindow = event.source;
      if (proxyOrigin && event.origin !== proxyOrigin) {
        return;
      }
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) {
        return;
      }
      const method: unknown = Reflect.get(data, 'method');
      if (method === MCP_UI_METHODS.sandboxProxyReady) {
        // The proxy is up. Hand it the document plus the policy computed from what the resource
        // declared — the host decides the CSP, never a script running on the sandbox origin.
        const readyResource = lifecycleResource;
        if (!readyResource) return;
        post({
          jsonrpc: '2.0',
          method: MCP_UI_METHODS.sandboxResourceReady,
          params: sandboxResourceParams(readyResource),
        });
        lifecycleResource = null;
        return;
      }
      const receivingHost = host;
      if (!receivingHost) return;
      void receivingHost
        .receive(data)
        .then(() => {
          if (receivingHost.initialized) clearInitializationDeadline();
        })
        .catch(() => {
          fail();
        });
    };
    window.addEventListener('message', onWindowMessage);
    initializationDeadline = window.setTimeout(fail, MCP_APP_INITIALIZATION_TIMEOUT_MS);

    return () => {
      // A route/browser unmount cannot keep the React subtree visible, but the captured proxy
      // channel remains alive until the app answers teardown or the bridge's one-second bound
      // expires. Every failure before initialization releases immediately.
      void dispose(host?.initialized === true);
    };
  }, [presentationIdentity, proxyOrigin]);

  // Deliver the result whenever it changes. The bridge holds it until the view says it is ready,
  // so this does not need to know anything about the handshake.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.deliverToolInput(tool.arguments ?? {});
    host.deliverToolResult(result);
  }, [result, tool.arguments]);

  // Tell the view how much room it has whenever the panel is resized. Without this the view sizes
  // itself against whatever width it was first given and reports a height for a layout that no
  // longer exists, which shows up as a card with a strip of dead space under it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !('ResizeObserver' in window)) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width <= 0) {
        return;
      }
      hostRef.current?.updateHostContext({
        containerDimensions:
          displayMode === 'fullscreen'
            ? // Fixed on both axes: the frame is the whole viewport and the view should fill it.
              // Sending maxHeight here would cap the view's own root at 640px inside a frame far
              // taller than that, which clips the expanded content fullscreen exists to show.
              { width: Math.round(box.width), height: Math.round(box.height) }
            : { maxHeight: MAX_HEIGHT, maxWidth: Math.round(box.width) },
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
    // Re-attached on a mode change so the first measurement after expanding is already the
    // fullscreen one, rather than the inline cap arriving from a stale closure.
  }, [displayMode]);

  // Restyle in place on a theme flip: a patch, not a reload.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const push = (): void => {
      hostRef.current?.updateHostContext({
        theme: currentTheme(),
        styles: { variables: hostStyleVariables() },
      });
    };
    media.addEventListener('change', push);
    const observer = new MutationObserver(push);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      media.removeEventListener('change', push);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!proxyOrigin) {
      setFailure('Interactive view unavailable.');
    }
  }, [proxyOrigin]);

  // Escape closes a fullscreen card. The view is told through a host-context change rather than a
  // reply, because nothing it sent is being answered — the host moved it.
  useEffect(() => {
    if (displayMode !== 'fullscreen') {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      setDisplayMode('inline');
      hostRef.current?.updateHostContext({ displayMode: 'inline' });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [displayMode]);

  // The frame is an opaque origin, so the host cannot see individual controls inside it to
  // implement a conventional first/last-element loop. It can still enforce the modal boundary:
  // when Tab leaves the iframe (or an assistive-technology shortcut reaches background chrome),
  // the document's capture-phase focus event returns the person to the visible Close control.
  // Focus inside the iframe remains untouched because the outer frame is a descendant here.
  useEffect(() => {
    if (displayMode !== 'fullscreen') {
      return;
    }
    const keepFocusInside = (event: FocusEvent): void => {
      const container = containerRef.current;
      if (!container || !(event.target instanceof Node) || container.contains(event.target)) {
        return;
      }
      closeButtonRef.current?.focus();
    };
    document.addEventListener('focusin', keepFocusInside, true);
    return () => {
      document.removeEventListener('focusin', keepFocusInside, true);
    };
  }, [displayMode]);

  if (!visible) return null;

  if (failure) {
    return (
      <div className="bg-surface-container rounded-xl px-4 py-3" data-testid="mcp-app-view-failure">
        <Text token="body-small" tone="muted">
          {failure}
        </Text>
      </div>
    );
  }

  return (
    <figure
      ref={containerRef}
      className={
        displayMode === 'fullscreen'
          ? 'bg-surface-container-low fixed inset-0 z-50 m-0 flex flex-col overflow-hidden'
          : resource.meta?.prefersBorder === true
            ? 'bg-surface-container-low border-outline-variant m-0 overflow-hidden rounded-xl border'
            : 'm-0 overflow-hidden rounded-xl bg-transparent'
      }
      // A fullscreen card covers the app, so it has to say it is a modal and name itself. Without
      // this a screen reader announces nothing on expand and tab order walks straight out into the
      // page underneath.
      {...(displayMode === 'fullscreen'
        ? {
            role: 'dialog' as const,
            'aria-modal': true,
            'aria-label': `${serverName}: ${tool.name}`,
          }
        : {})}
      data-testid="mcp-app-view"
      data-display-mode={displayMode}
      data-resource-uri={resource.uri}
      data-prefers-border={String(resource.meta?.prefersBorder ?? false)}
    >
      {displayMode === 'fullscreen' ? (
        // Escape alone is not an exit a person can find. The widget's own "Show less" may also be
        // hidden if the host withdraws the mode, which would leave no visible way out at all.
        <div className="flex justify-end p-2">
          <button
            ref={closeButtonRef}
            type="button"
            autoFocus
            className="text-on-surface-variant hover:bg-surface-container text-label-large rounded-md px-3 py-1.5"
            onClick={() => {
              setDisplayMode('inline');
              hostRef.current?.updateHostContext({ displayMode: 'inline' });
            }}
          >
            Close
          </button>
        </div>
      ) : null}
      <iframe
        key={presentationIdentity}
        ref={frameRef}
        src={proxyUrl}
        title={`${serverName}: ${tool.name}`}
        // The proxy needs an origin so it can set the inner frame's policy; the WIDGET never gets
        // one. Both facts matter, and they live on different frames for exactly that reason.
        sandbox={MCP_APP_PROXY_SANDBOX}
        referrerPolicy="no-referrer"
        // A card grows into its measured height rather than snapping. The global reduced-motion
        // rule in `globals.css` collapses this to nothing for anyone who asked for that.
        className={
          displayMode === 'fullscreen'
            ? 'block w-full flex-1 border-0 bg-transparent'
            : 'block w-full border-0 bg-transparent transition-[height]'
        }
        // Fullscreen takes the frame it is given; only an inline card sizes itself from what the
        // view reported, because only an inline card is sitting in someone else's flow.
        style={displayMode === 'fullscreen' ? undefined : { height: `${String(height)}px` }}
      />
      <figcaption className="px-4 pb-2">
        <Text token="label-small" tone="muted">
          {serverName}
        </Text>
      </figcaption>
    </figure>
  );
}

/**
 * Turn a failed widget tool call into copy Docket owns.
 *
 * @remarks
 * The connected server's error text is not shown. It is someone else's prose, it may be a raw
 * stack trace, and in the worst case it is attacker-authored — none of which belongs in a
 * transcript the user reads as Athena's.
 *
 * @param serverName - The visible name of the server that refused.
 * @returns the error to surface.
 */
export function widgetCallFailure(serverName: string): UserFacingError {
  return new UserFacingError(`${serverName} did not accept that action.`);
}
