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
  MCP_APP_PRESENTATION_MAX_BYTES,
  MCP_UI_METHODS,
  type McpUiContentBlock,
  type McpUiDisplayMode,
  type McpUiHostContext,
  type McpUiHostStyles,
  type McpUiTheme,
  type McpUiUpdateModelContextParams,
} from '@docket/integrations/mcp-apps-contract';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Surface,
  Text,
} from '@docket/ui/primitives';

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
  /** Stable identity for the originating connection and persisted/manual presentation instance. */
  readonly instanceId: string;
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
  /**
   * Record the widget's `ui/update-model-context` for the conversation's next turn.
   *
   * @remarks
   * Only durable cards can honour this — the context is stored on the activity row the card
   * lives on — so a manually launched widget with no activity simply does not receive the
   * capability, which the bridge advertises only when this prop is present.
   */
  readonly onUpdateModelContext?: (
    params: McpUiUpdateModelContextParams,
  ) => Promise<boolean> | boolean;
  /** Overrides the API origin the sandbox proxy is served from. Tests only. */
  readonly sandboxOrigin?: string;
}

/** How tall a card starts out before the widget reports its own size. */
const INITIAL_HEIGHT = 96;

/** The widest a card may grow before it gets its own scroll region. */
const MAX_HEIGHT = 640;

/**
 * Maximum time a sandboxed app may take to complete its official initialization handshake.
 *
 * Official apps may load declared framework or visualization assets before calling
 * `App.connect()`. Five seconds proved too short for the SDK's own Cesium example on a cold
 * production load, so the host keeps the textual fallback available while allowing a realistic
 * bounded startup window.
 */
const MCP_APP_INITIALIZATION_TIMEOUT_MS = 30_000;

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
/** One decodable embedded file from a `ui/download-file` request. */
interface EmbeddedDownload {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** Derive a safe filename from a resource URI, falling back to a generic one. */
function downloadName(uri: unknown): string {
  const base = typeof uri === 'string' ? (uri.split(/[/\\]/).pop() ?? '') : '';
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return safe.length > 0 ? safe.slice(0, 120) : 'download';
}

/**
 * Decode one `ui/download-file` content entry, or `null` when it is not deliverable.
 *
 * @remarks
 * Embedded resources only. A `resource_link` asks the host to go fetch someone else's URL with
 * the user's network position, which this host does not do — the refusal is all-or-nothing so a
 * widget never believes a partial delivery succeeded.
 */
function decodeDownload(entry: unknown): EmbeddedDownload | null {
  if (entry === null || typeof entry !== 'object') return null;
  const resource: unknown = Reflect.get(entry, 'resource');
  if (resource === null || typeof resource !== 'object') return null;
  const text: unknown = Reflect.get(resource, 'text');
  const blob: unknown = Reflect.get(resource, 'blob');
  const mimeTypeValue: unknown = Reflect.get(resource, 'mimeType');
  const mimeType = typeof mimeTypeValue === 'string' ? mimeTypeValue : 'application/octet-stream';
  let bytes: Uint8Array;
  if (typeof text === 'string') {
    bytes = new TextEncoder().encode(text);
  } else if (typeof blob === 'string') {
    try {
      bytes = Uint8Array.from(atob(blob), (char) => char.codePointAt(0) ?? 0);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MCP_APP_PRESENTATION_MAX_BYTES) return null;
  return { name: downloadName(Reflect.get(resource, 'uri')), mimeType, bytes };
}

/** Hand each embedded file to the browser as a download; refuse the batch on any bad entry. */
function deliverDownloads(contents: readonly unknown[]): boolean {
  const files = contents.map(decodeDownload);
  if (files.some((file) => file === null)) return false;
  for (const file of files as readonly EmbeddedDownload[]) {
    const url = URL.createObjectURL(new Blob([file.bytes.slice()], { type: file.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.rel = 'noopener';
    anchor.click();
    // Revoke on the next tick so the click's navigation has started before the URL dies.
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }
  return true;
}

/**
 * The browser half of the MCP Apps host: one sandboxed card in a transcript.
 *
 * @remarks
 * Owns the two-frame embedding (the API-origin proxy iframe and, inside it, the origin-less view
 * frame), drives the framework-free bridge from `@docket/integrations/mcp-apps`, and adapts the
 * protocol to this page: theme variables read live from Docket's computed styles, height that
 * follows `ui/notifications/size-changed`, fullscreen by relocating the live frame into a dialog,
 * link/message/download/model-context callbacks, and the textual fallback when a view never
 * completes its handshake.
 *
 * @param props - See {@link McpAppViewProps}.
 * @returns the framed card, or `null` once the view has torn itself down.
 */
export function McpAppView(props: McpAppViewProps): JSX.Element | null {
  const {
    instanceId,
    resource,
    tool,
    result,
    serverName,
    onCallTool,
    onMessage,
    onUpdateModelContext,
    sandboxOrigin,
  } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameHostRef = useRef<HTMLDivElement | null>(null);
  const inlineContainerRef = useRef<HTMLDivElement | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<McpAppHost | null>(null);
  const presentationIdentity = `${instanceId}\u0000${resource.uri}\u0000${tool.name}`;
  const callbackLifecycleRef = useRef<{
    identity: string;
    onCallTool: McpAppViewProps['onCallTool'];
    onMessage: McpAppViewProps['onMessage'];
    onUpdateModelContext: McpAppViewProps['onUpdateModelContext'];
  } | null>(null);
  if (callbackLifecycleRef.current?.identity === presentationIdentity) {
    callbackLifecycleRef.current.onCallTool = onCallTool;
    callbackLifecycleRef.current.onMessage = onMessage;
    callbackLifecycleRef.current.onUpdateModelContext = onUpdateModelContext;
  }
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
    const lifecycleCallbacks = {
      identity: presentationIdentity,
      onCallTool,
      onMessage,
      onUpdateModelContext,
    };
    callbackLifecycleRef.current = lifecycleCallbacks;
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
      if (callbackLifecycleRef.current === lifecycleCallbacks) callbackLifecycleRef.current = null;
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
      hostContext: buildHostContext(inlineContainerRef.current?.clientWidth),
      post,
      callTool: (name, args) => lifecycleCallbacks.onCallTool(name, args),
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
      ...(lifecycleCallbacks.onMessage
        ? {
            sendMessage: async (content: readonly McpUiContentBlock[]) => {
              const text = content
                .map((block) => (block.type === 'text' ? block.text : ''))
                .filter(Boolean)
                .join('\n');
              if (!text) {
                return false;
              }
              return (await lifecycleCallbacks.onMessage?.(text)) ?? false;
            },
          }
        : {}),
      ...(lifecycleCallbacks.onUpdateModelContext
        ? {
            updateModelContext: async (params: McpUiUpdateModelContextParams) =>
              (await lifecycleCallbacks.onUpdateModelContext?.(params)) ?? false,
          }
        : {}),
      downloadFile: (contents) => deliverDownloads(contents),
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
    const container =
      displayMode === 'fullscreen' ? fullscreenContainerRef.current : inlineContainerRef.current;
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

  const closeFullscreen = (): void => {
    setDisplayMode('inline');
    hostRef.current?.updateHostContext({ displayMode: 'inline' });
  };

  // Move the existing frame host instead of rendering a second iframe. The widget keeps its DOM,
  // message channel, and in-frame state while the shared Dialog takes over modal behavior.
  useLayoutEffect(() => {
    const frameHost = frameHostRef.current;
    const target =
      displayMode === 'fullscreen' ? fullscreenContainerRef.current : inlineContainerRef.current;
    if (frameHost && target && frameHost.parentElement !== target) {
      target.append(frameHost);
    }
  }, [displayMode]);

  if (!visible) return null;

  if (failure) {
    return (
      <Surface tone="canvas" shape="medium" pad="roomy" data-testid="mcp-app-view-failure">
        <Text token="body-small" tone="muted">
          {failure}
        </Text>
      </Surface>
    );
  }

  return (
    <>
      <Surface
        as="figure"
        tone={resource.meta?.prefersBorder === true ? 'card' : 'page'}
        shape="medium"
        className={
          displayMode === 'fullscreen'
            ? 'm-0 hidden'
            : resource.meta?.prefersBorder === true
              ? 'border-outline-variant m-0 overflow-hidden border'
              : 'm-0 overflow-hidden bg-transparent'
        }
        data-testid="mcp-app-view"
        data-display-mode={displayMode}
        data-resource-uri={resource.uri}
        data-prefers-border={String(resource.meta?.prefersBorder ?? false)}
      >
        <div ref={inlineContainerRef} className="min-h-0 w-full">
          <div
            ref={frameHostRef}
            className={displayMode === 'fullscreen' ? 'flex min-h-0 flex-1' : 'min-h-0 w-full'}
          >
            <iframe
              key={presentationIdentity}
              ref={frameRef}
              src={proxyUrl}
              title={`${serverName}: ${tool.name}`}
              // The proxy needs an origin so it can set the inner frame's policy; the widget never
              // gets one. Both facts live on different frames for exactly that reason.
              sandbox={MCP_APP_PROXY_SANDBOX}
              referrerPolicy="no-referrer"
              className={
                displayMode === 'fullscreen'
                  ? 'block h-full w-full flex-1 border-0 bg-transparent'
                  : 'block w-full border-0 bg-transparent transition-[height]'
              }
              style={displayMode === 'fullscreen' ? undefined : { height: `${String(height)}px` }}
            />
          </div>
        </div>
        <figcaption className="px-4 pb-2">
          <Text token="label-small" tone="muted">
            {serverName}
          </Text>
        </figcaption>
      </Surface>
      <Dialog
        open={displayMode === 'fullscreen'}
        onOpenChange={(open) => {
          if (!open) closeFullscreen();
        }}
      >
        <DialogContent
          presentation={{ kind: 'fullscreen' }}
          showClose={false}
          aria-modal="true"
          aria-describedby={undefined}
        >
          <DialogHeader className="flex-row items-center justify-between" inset="compact">
            <DialogTitle>{`${serverName}: ${tool.name}`}</DialogTitle>
            <Button type="button" variant="ghost" onClick={closeFullscreen}>
              Close
            </Button>
          </DialogHeader>
          <DialogBody inset="none">
            <div ref={fullscreenContainerRef} className="flex min-h-0 flex-1" />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
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
