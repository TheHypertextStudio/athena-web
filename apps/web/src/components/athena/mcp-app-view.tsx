'use client';

import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createMcpAppHost,
  sandboxResourceParams,
  type JsonRpcMessage,
  type McpAppHost,
  type McpAppResource,
} from '@docket/integrations/mcp-apps';
import {
  MCP_UI_METHODS,
  type McpUiContentBlock,
  type McpUiHostContext,
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
  /** Record what the widget wants the model to know about its state. */
  readonly onModelContext?: (text: string) => void;
  /** Overrides the API origin the sandbox proxy is served from. Tests only. */
  readonly sandboxOrigin?: string;
}

/** How tall a card starts out before the widget reports its own size. */
const INITIAL_HEIGHT = 180;

/** The widest a card may grow before it gets its own scroll region. */
const MAX_HEIGHT = 640;

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
  if (typeof window === 'undefined') return 'light';
  const attribute = document.documentElement.dataset['theme'];
  if (attribute === 'dark' || attribute === 'light') return attribute;
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
function hostStyleVariables(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const computed = window.getComputedStyle(document.documentElement);
  const read = (token: string): string => computed.getPropertyValue(token).trim();
  const map: Readonly<Record<string, string>> = {
    '--color-background-primary': '--color-surface-container-low',
    '--color-background-secondary': '--color-surface-container',
    '--color-background-tertiary': '--color-surface-container-high',
    '--color-text-primary': '--color-on-surface',
    '--color-text-secondary': '--color-on-surface-variant',
    '--color-text-info': '--color-primary',
    '--color-text-danger': '--color-error',
    '--color-border-primary': '--color-outline-variant',
    '--font-sans': '--font-sans',
  };
  const variables: Record<string, string> = {};
  for (const [specKey, docketToken] of Object.entries(map)) {
    const value = read(docketToken);
    if (value) variables[specKey] = value;
  }
  return variables;
}

/** Build the host context handed to a view. */
function buildHostContext(): McpUiHostContext {
  return {
    theme: currentTheme(),
    styles: { variables: hostStyleVariables() },
    displayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
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
export function McpAppView(props: McpAppViewProps): JSX.Element {
  const {
    resource,
    tool,
    result,
    serverName,
    onCallTool,
    onMessage,
    onModelContext,
    sandboxOrigin,
  } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<McpAppHost | null>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [failure, setFailure] = useState<string | null>(null);

  const proxyUrl = useMemo(() => sandboxProxyUrl(sandboxOrigin), [sandboxOrigin]);
  const proxyOrigin = useMemo(() => {
    try {
      return new URL(proxyUrl).origin;
    } catch {
      return '';
    }
  }, [proxyUrl]);

  const callTool = useCallback(
    async (name: string, args: Readonly<Record<string, unknown>>) => onCallTool(name, args),
    [onCallTool],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const post = (message: JsonRpcMessage): void => {
      frame.contentWindow?.postMessage(message, proxyOrigin || '*');
    };

    const host = createMcpAppHost({
      hostInfo: { name: 'docket-athena', version: '1.0.0' },
      resource,
      tool: { name: tool.name, ...(tool.arguments ? { arguments: tool.arguments } : {}) },
      hostContext: buildHostContext(),
      post,
      callTool,
      // Scope: the API decides. The browser holds no credential for the connected server, so an
      // unauthorized call fails there, not here — but the bridge still requires an explicit
      // allow, so a widget can never reach a tool the host did not intend to expose.
      authorizeTool: () => ({ allowed: true }),
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
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        if (parsed.origin === window.location.origin) {
          window.location.assign(parsed.href);
          return true;
        }
        const opened = window.open(parsed.href, '_blank', 'noopener,noreferrer');
        return opened !== null;
      },
      ...(onMessage
        ? {
            sendMessage: async (content: readonly McpUiContentBlock[]) => {
              const text = content
                .map((block) => (typeof block.text === 'string' ? block.text : ''))
                .filter(Boolean)
                .join('\n');
              if (!text) return false;
              return await onMessage(text);
            },
          }
        : {}),
      ...(onModelContext
        ? {
            updateModelContext: (update) => {
              const text = (update.content ?? [])
                .map((block) => (typeof block.text === 'string' ? block.text : ''))
                .filter(Boolean)
                .join('\n');
              if (text) onModelContext(text);
            },
          }
        : {}),
      onSizeChanged: ({ height: reported }) => {
        if (typeof reported === 'number' && reported > 0) {
          setHeight(Math.min(Math.max(reported, 96), MAX_HEIGHT));
        }
      },
    });
    hostRef.current = host;

    const onWindowMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow) return;
      if (proxyOrigin && event.origin !== proxyOrigin) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const method: unknown = Reflect.get(data, 'method');
      if (method === MCP_UI_METHODS.sandboxProxyReady) {
        // The proxy is up. Hand it the document plus the policy computed from what the resource
        // declared — the host decides the CSP, never a script running on the sandbox origin.
        post({
          jsonrpc: '2.0',
          method: MCP_UI_METHODS.sandboxResourceReady,
          params: sandboxResourceParams(resource),
        });
        return;
      }
      void host.receive(data);
    };
    window.addEventListener('message', onWindowMessage);

    return () => {
      window.removeEventListener('message', onWindowMessage);
      host.close();
      hostRef.current = null;
    };
  }, [resource, tool.name, tool.arguments, callTool, onMessage, onModelContext, proxyOrigin]);

  // Deliver the result whenever it changes. The bridge holds it until the view says it is ready,
  // so this does not need to know anything about the handshake.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.deliverToolInput(tool.arguments ?? {});
    host.deliverToolResult(result);
  }, [result, tool.arguments]);

  // Restyle in place on a theme flip: a patch, not a reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
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
      setFailure('This card cannot be shown here yet.');
      return;
    }
    setFailure(null);
  }, [proxyOrigin]);

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
      className="bg-surface-container-low m-0 overflow-hidden rounded-xl"
      data-testid="mcp-app-view"
      data-resource-uri={resource.uri}
      data-prefers-border={String(resource.meta?.prefersBorder ?? false)}
    >
      <iframe
        ref={frameRef}
        src={proxyUrl}
        title={`${serverName}: ${tool.name}`}
        // The proxy needs an origin so it can set the inner frame's policy; the WIDGET never gets
        // one. Both facts matter, and they live on different frames for exactly that reason.
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        className="block w-full border-0 bg-transparent"
        style={{ height: `${String(height)}px` }}
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
