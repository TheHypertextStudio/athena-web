/**
 * `@docket/integrations` — the MCP Apps **host** bridge (`io.modelcontextprotocol/ui`).
 *
 * @remarks
 * This is the half of the extension Docket was missing. The API already produces widgets for
 * other people's hosts; this makes Docket a host, so a widget returned by any connected MCP
 * server renders inside Athena.
 *
 * It is deliberately framework-free — no React, no DOM, no `window`. Everything arrives through
 * {@link McpAppHost.receive} and leaves through the `post` callback, which is what lets the whole
 * protocol be driven by a fake view frame in a unit test rather than only in a browser. The React
 * component that owns the actual `<iframe>` is a thin adapter over this object.
 *
 * Three properties are load-bearing and are asserted by tests, not just intended:
 *
 * 1. **Ordering.** The spec forbids the host sending anything to the view before the view's
 *    `ui/notifications/initialized` arrives, and requires `ui/notifications/tool-input` before
 *    `ui/notifications/tool-result`. Both are enforced by a queue here rather than by callers
 *    being careful — a caller cannot get the order wrong.
 * 2. **Refusal is explicit.** A `tools/call` the session is not authorized for returns a JSON-RPC
 *    error with the tool's name in it. It never silently succeeds and never silently no-ops.
 * 3. **Deny by default.** The CSP is built by adding only what the resource declared to a
 *    `default-src 'none'` base, so a resource that declares nothing cannot reach the network.
 *
 * @see `docs/engineering/specs/vendor/mcp-apps-2026-01-26.mdx` — the committed specification.
 */
import {
  AppBridge,
  RESOURCE_MIME_TYPE,
  type McpUiAppCapabilities,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  type McpUiResourceCsp,
  type McpUiResourceMeta,
  type McpUiResourcePermissions,
  McpUiOpenLinkRequestSchema,
  McpUiResourceMetaSchema,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ErrorCode,
  JSONRPCMessageSchema,
  McpError,
  type CallToolResult,
  type ContentBlock,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';

/** JSON-RPC 2.0 reserved error codes this bridge emits. */
export const JSON_RPC_ERROR = {
  /** The method is not one the host serves for a view. */
  methodNotFound: -32601,
  /** The params did not match the method's shape. */
  invalidParams: -32602,
  /** The host failed while servicing an otherwise valid request. */
  internalError: -32603,
  /** Implementation-defined: the host understood the request and refused it. */
  refused: -32000,
} as const;

/** A JSON-RPC id as it may appear on the wire. */
export type JsonRpcId = string | number;

/**
 * A read-only view of a JSON-RPC message travelling across the compatibility facade.
 *
 * @remarks
 * Runtime parsing remains owned by the SDK's {@link JSONRPCMessageSchema}. Optional fields here
 * let adapters inspect a recording containing requests, notifications, and responses without
 * repeatedly narrowing the official discriminated union.
 */
export interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId | undefined;
  readonly method?: string | undefined;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?:
    { readonly code: number; readonly message: string; readonly data?: unknown } | undefined;
}

/** The `CallToolResult` shape the host relays to a view. */
export interface HostToolResult {
  readonly content?: readonly ContentBlock[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

/** A UI resource the host has fetched and is about to render. */
export interface McpAppResource {
  /** The `ui://` uri the tool pointed at. */
  readonly uri: string;
  /** Must be {@link MCP_UI_MIME_TYPE} for this revision of the extension. */
  readonly mimeType: string;
  /** The HTML document. */
  readonly text: string;
  /** The resource's own `_meta.ui`, carrying its CSP and permission declarations. */
  readonly meta?: McpUiResourceMeta;
}

/** The tool call that instantiated a view. */
export interface McpAppToolInvocation {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
  /** The JSON-RPC id of the originating `tools/call`, surfaced to the view as `toolInfo.id`. */
  readonly requestId?: JsonRpcId;
  /** The tool definition, so the view can read its schema without a second round trip. */
  readonly definition?: { readonly name: string; readonly [key: string]: unknown };
}

/** Whether a view may invoke a given tool, and why not when it may not. */
export type McpAppToolDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** Everything the host needs in order to serve one view. */
export interface McpAppHostOptions {
  /** Host identity reported in the `ui/initialize` result. */
  readonly hostInfo: { readonly name: string; readonly version: string };
  /** The resource being rendered. */
  readonly resource: McpAppResource;
  /** The tool call that produced it, when there is one. */
  readonly tool?: McpAppToolInvocation;
  /** The environment description handed to the view, and patched later as it changes. */
  readonly hostContext?: McpUiHostContext;
  /** Deliver one JSON-RPC message to the view frame. */
  readonly post: (message: JsonRpcMessage) => void;
  /**
   * Execute a tool on the server this widget came from.
   *
   * @remarks
   * Only ever reached after {@link McpAppHostOptions.authorizeTool} has allowed the call, so an
   * implementation of this does not need to re-check scope.
   */
  readonly callTool?: (
    name: string,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<HostToolResult>;
  /** Read a resource from the server this widget came from. */
  readonly readResource?: (uri: string) => Promise<unknown>;
  /**
   * Decide whether this view may call a tool.
   *
   * @remarks
   * The default refuses everything, because a host that proxies unaudited tool calls from
   * arbitrary third-party HTML is the whole threat model. A caller that wants widget→server calls
   * must say which tools are in scope for the session.
   */
  readonly authorizeTool?: (name: string) => McpAppToolDecision;
  /** Navigate the user to a URL. Returning `false` refuses the request. */
  readonly openLink?: (url: string) => boolean | Promise<boolean>;
  /** Post a message into the host's conversation. Returning `false` refuses it. */
  readonly sendMessage?: (content: readonly ContentBlock[]) => boolean | Promise<boolean>;
  /** Honour (or decline) a display-mode change; return the mode actually applied. */
  readonly requestDisplayMode?: (mode: McpUiDisplayMode) => McpUiDisplayMode;
  /** Hand resource contents to the user as a download. Returning `false` refuses. */
  readonly downloadFile?: (contents: readonly unknown[]) => boolean | Promise<boolean>;
  /** Record a view's `notifications/message` log line. */
  readonly log?: (params: unknown) => void;
  /** The view reported its rendered size. */
  readonly onSizeChanged?: (size: { width?: number; height?: number }) => void;
  /** The view asked to be torn down. */
  readonly onRequestTeardown?: () => void;
  /** Every inbound view→host request, for the audit trail the spec asks hosts to keep. */
  readonly onAudit?: (entry: McpAppAuditEntry) => void;
}

/** One view→host message, recorded for review. */
export interface McpAppAuditEntry {
  readonly method: string;
  readonly id?: JsonRpcId;
  readonly outcome: 'ok' | 'error';
  readonly detail?: string;
}

/** The display modes this host can present a view in. */
const AVAILABLE_DISPLAY_MODES: readonly McpUiDisplayMode[] = ['inline', 'fullscreen'];

/**
 * The iframe `sandbox` attribute every view is rendered under.
 *
 * @remarks
 * `allow-scripts` is the only capability granted. Notably absent: `allow-same-origin` (which
 * would give the document an origin and defeat the isolation), `allow-top-navigation` (which
 * would let a widget navigate the whole app), `allow-popups`, `allow-forms`, and
 * `allow-modals`. The view's only route out is `postMessage`, which is exactly what the spec's
 * auditability argument depends on.
 */
export const MCP_APP_VIEW_SANDBOX = 'allow-scripts';

/**
 * The `sandbox` attribute for the outer proxy frame in the web double-iframe architecture.
 *
 * @remarks
 * The spec requires the proxy to have `allow-scripts` and `allow-same-origin` so it can run the
 * forwarding script and set the inner frame's CSP. It is safe only because it is served from an
 * origin that holds nothing — no cookies, no storage, no API — which is the reason the spec also
 * requires it to differ from the host's origin.
 */
export const MCP_APP_PROXY_SANDBOX = 'allow-scripts allow-same-origin';

/**
 * Build the Content-Security-Policy for a view from the origins its resource declared.
 *
 * @remarks
 * Starts from `default-src 'none'` and adds only declared origins, so the failure mode of a
 * missing declaration is a blocked request rather than an open one. `connect-src` gets NO
 * implicit `'self'`: a view has no meaningful same-origin server (it is rendered from a
 * `srcdoc`/blob in an opaque origin), and granting it would be the one hole that lets a widget
 * exfiltrate what it was shown.
 *
 * @param csp - The resource's declared origins, or `undefined` for the deny-all default.
 * @returns a CSP header value with no newlines, ready for a `<meta http-equiv>` or a header.
 */
export function buildViewCsp(csp?: McpUiResourceCsp): string {
  const resources = declaredCspOrigins(csp?.resourceDomains);
  const connect = declaredCspOrigins(csp?.connectDomains);
  const frames = declaredCspOrigins(csp?.frameDomains);
  const bases = declaredCspOrigins(csp?.baseUriDomains);
  const directives = [
    `default-src 'none'`,
    `script-src 'self' 'unsafe-inline'${resources ? ` 'unsafe-eval' ${resources}` : ''}`,
    `style-src 'self' 'unsafe-inline'${resources ? ` ${resources}` : ''}`,
    `img-src 'self' data:${resources ? ` ${resources}` : ''}`,
    `font-src 'self'${resources ? ` ${resources}` : ''}`,
    `media-src 'self' data:${resources ? ` ${resources}` : ''}`,
    `connect-src ${connect || `'none'`}`,
    ...(resources ? [`worker-src 'self' blob: ${resources}`] : []),
    `frame-src ${frames || `'none'`}`,
    `object-src 'none'`,
    `base-uri ${bases || `'self'`}`,
    `form-action 'none'`,
  ];
  return `${directives.join('; ')};`;
}

function declaredCspOrigins(values: string[] | undefined): string {
  return values?.filter(isCspOrigin).join(' ') ?? '';
}

function isCspOrigin(value: string): boolean {
  if (/\s|;/.test(value)) return false;
  if (/^(?:https?|wss?):\/\/\*\.(?:[a-z\d-]+\.)*[a-z\d-]+(?::\d+)?$/i.test(value)) {
    return true;
  }

  try {
    const origin = new URL(value);
    return (
      ['http:', 'https:', 'ws:', 'wss:'].includes(origin.protocol) &&
      origin.username === '' &&
      origin.password === '' &&
      origin.pathname === '/' &&
      origin.search === '' &&
      origin.hash === ''
    );
  } catch {
    return false;
  }
}

/**
 * Build the iframe `allow` attribute from the permissions a resource requested.
 *
 * @remarks
 * Permission Policy syntax, not a bare feature list: `camera 'src'` grants the feature to the
 * frame's own origin only. A resource that requested nothing gets an empty string, which the
 * caller should render as no attribute at all.
 *
 * @param permissions - The resource's declared permissions.
 * @returns the `allow` attribute value, possibly empty.
 */
export function buildViewPermissionsAllow(permissions?: McpUiResourcePermissions): string {
  const features: string[] = [];
  if (permissions?.camera) features.push(`camera 'src'`);
  if (permissions?.microphone) features.push(`microphone 'src'`);
  if (permissions?.geolocation) features.push(`geolocation 'src'`);
  if (permissions?.clipboardWrite) features.push(`clipboard-write 'src'`);
  return features.join('; ');
}

/** The one-second upper bound for graceful view teardown. */
const TEARDOWN_TIMEOUT_MS = 1_000;

/** The stable display modes Athena implements in the browser. */
const STABLE_DISPLAY_MODES = new Set<McpUiDisplayMode>(['inline', 'fullscreen']);

/** Keep stored and emitted host context inside Athena's stable display-mode surface. */
function stableHostContext(
  value: McpUiHostContext,
  fallbackDisplayMode: McpUiDisplayMode = 'inline',
): McpUiHostContext {
  const displayMode = STABLE_DISPLAY_MODES.has(value.displayMode ?? fallbackDisplayMode)
    ? (value.displayMode ?? fallbackDisplayMode)
    : fallbackDisplayMode;
  return {
    ...value,
    displayMode,
    availableDisplayModes: (value.availableDisplayModes ?? AVAILABLE_DISPLAY_MODES).filter((mode) =>
      STABLE_DISPLAY_MODES.has(mode),
    ),
  };
}

/** Normalize facade results to the official MCP `CallToolResult` contract. */
function officialToolResult(result: HostToolResult): CallToolResult {
  return {
    ...result,
    content: [...(result.content ?? [])],
    ...(result.structuredContent ? { structuredContent: { ...result.structuredContent } } : {}),
  };
}

/** A transport that lets AppBridge speak through Athena's already-authenticated proxy adapter. */
class ProxyTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage: NonNullable<Transport['onmessage']> = () => undefined;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;
  private readonly responseWaiters = new Map<JsonRpcId, () => void>();
  private readonly preInitializeQueue: JSONRPCMessage[] = [];
  private initialized = false;

  /** @param post - Deliver one official JSON-RPC message to the outer proxy iframe. */
  constructor(private readonly post: (message: JsonRpcMessage) => void) {}

  /** Mark the transport ready; the React adapter owns the actual event listener. */
  start(): Promise<void> {
    return Promise.resolve();
  }

  /** Send an AppBridge message through the outer proxy iframe. */
  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if ('method' in message && !this.initialized) {
      this.preInitializeQueue.push(message);
      return;
    }
    this.post(message);
    if ('id' in message && message.id !== undefined && !('method' in message)) {
      const waiter = this.responseWaiters.get(message.id);
      if (waiter) {
        this.responseWaiters.delete(message.id);
        waiter();
      }
    }
  }

  /** Release host notifications only after the app completes the official handshake. */
  markInitialized(): void {
    this.initialized = true;
    for (const message of this.preInitializeQueue.splice(0)) this.post(message);
  }

  /**
   * Feed one iframe message into AppBridge and wait for a request response when one is expected.
   *
   * @param data - Untrusted `postMessage` data.
   */
  async receive(data: unknown): Promise<void> {
    const parsed = JSONRPCMessageSchema.safeParse(data);
    if (!parsed.success) return;
    const message = parsed.data;
    let answered: Promise<void> | undefined;
    if ('method' in message && 'id' in message) {
      answered = new Promise((resolve) => this.responseWaiters.set(message.id, resolve));
    }
    this.onmessage(message);
    if (answered) {
      await answered;
    } else {
      await Promise.resolve();
    }
  }

  /** Close this transport and release pending response waiters. */
  async close(): Promise<void> {
    this.preInitializeQueue.length = 0;
    for (const resolve of this.responseWaiters.values()) resolve();
    this.responseWaiters.clear();
    this.onclose?.();
  }
}

/** A live bridge between one view frame and this host. */
export interface McpAppHost {
  /** Feed one message received from the view frame. Never throws. */
  receive(data: unknown): Promise<void>;
  /** Send best-effort partial tool arguments while the model streams them. */
  deliverToolInputPartial(args: Readonly<Record<string, unknown>>): void;
  /** Send the complete tool arguments. Idempotent; only the first call is delivered. */
  deliverToolInput(args: Readonly<Record<string, unknown>>): void;
  /** Send the tool result. Ordered after `tool-input` no matter when it is called. */
  deliverToolResult(result: HostToolResult): void;
  /** Tell the view no result is coming. */
  deliverToolCancelled(reason?: string): void;
  /** Patch the host context and notify the view in place — no reload. */
  updateHostContext(patch: McpUiHostContext): void;
  /** Ask the view to shut down cleanly; resolves when it answers or the host gives up. */
  requestTeardown(reason?: string): Promise<void>;
  /** Whether the view has completed the handshake. */
  readonly initialized: boolean;
  /** The view's declared capabilities, once it has sent them. */
  readonly appCapabilities: McpUiAppCapabilities | null;
  /** The host context as currently reported to the view. */
  readonly hostContext: McpUiHostContext;
  /** Stop accepting messages and drop queued work. */
  close(): void;
}

/**
 * Create a host bridge for one view frame.
 *
 * @remarks
 * The returned object is stateful and single-use: it belongs to exactly one rendered widget and
 * must be {@link McpAppHost.close}d when that widget unmounts, or the next widget's messages will
 * be answered by the previous one's policy.
 *
 * @param options - Everything the host needs to serve this view.
 * @returns the live bridge.
 */
export function createMcpAppHost(options: McpAppHostOptions): McpAppHost {
  let closed = false;
  let initialized = false;
  let toolInputSent = false;
  let teardownPromise: Promise<void> | null = null;
  let context = stableHostContext({
    ...(options.hostContext ?? {}),
    ...(options.tool
      ? {
          toolInfo: {
            ...(options.tool.requestId === undefined ? {} : { id: options.tool.requestId }),
            tool: {
              inputSchema: { type: 'object', properties: {} },
              ...(options.tool.definition ?? {}),
              name: options.tool.name,
            },
          },
        }
      : {}),
  });
  const capabilities: McpUiHostCapabilities = {
    ...(options.openLink ? { openLinks: {} } : {}),
    ...(options.callTool ? { serverTools: { listChanged: false } } : {}),
    ...(options.sendMessage ? { message: { text: {} } } : {}),
    sandbox: {
      csp: options.resource.meta?.csp ?? {},
      permissions: options.resource.meta?.permissions ?? {},
    },
  };
  const queue: (() => Promise<void>)[] = [];
  const transport = new ProxyTransport(options.post);
  const bridge = new AppBridge(null, options.hostInfo, capabilities, { hostContext: context });

  const audit = (entry: McpAppAuditEntry): void => options.onAudit?.(entry);
  const enqueue = (operation: () => Promise<void>): void => {
    if (closed) return;
    if (!initialized) {
      queue.push(operation);
      return;
    }
    void operation();
  };
  const flush = (): void => {
    for (const operation of queue.splice(0)) void operation();
  };

  bridge.addEventListener('initialized', () => {
    initialized = true;
    transport.markInitialized();
    audit({ method: 'ui/notifications/initialized', outcome: 'ok' });
    flush();
  });
  bridge.addEventListener('sizechange', (size) => options.onSizeChanged?.(size));

  const callTool = options.callTool;
  if (callTool) {
    bridge.oncalltool = async ({ name, arguments: args = {} }) => {
      const decision = options.authorizeTool?.(name) ?? {
        allowed: false,
        reason: 'This host has not authorized any tools for embedded views.',
      };
      if (!decision.allowed) {
        audit({ method: 'tools/call', outcome: 'error', detail: `refused:${name}` });
        throw new McpError(JSON_RPC_ERROR.refused, `${name}: ${decision.reason}`);
      }
      try {
        const result = await callTool(name, args);
        audit({ method: 'tools/call', outcome: 'ok', detail: name });
        toolInputSent = false;
        deliverToolInput(args);
        deliverToolResult(result);
        return officialToolResult(result);
      } catch (error) {
        if (error instanceof McpError) throw error;
        audit({ method: 'tools/call', outcome: 'error', detail: `failed:${name}` });
        throw new McpError(ErrorCode.InternalError, `${name}: the tool call did not complete.`);
      }
    };
  }

  const openLink = options.openLink;
  if (openLink) {
    bridge.onopenlink = async ({ url }) => {
      if (!(await openLink(url))) {
        audit({ method: 'ui/open-link', outcome: 'error', detail: url });
        throw new McpError(JSON_RPC_ERROR.refused, 'This host did not open that link.');
      }
      audit({ method: 'ui/open-link', outcome: 'ok', detail: url });
      return {};
    };
  }

  const sendMessage = options.sendMessage;
  if (sendMessage) {
    bridge.onmessage = async ({ content }) => {
      const textOnly = content.every((block) => block.type === 'text');
      if (!textOnly || content.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, 'ui/message accepts text content only.');
      }
      if (!(await sendMessage(content))) {
        audit({ method: 'ui/message', outcome: 'error' });
        throw new McpError(JSON_RPC_ERROR.refused, 'This host did not post that message.');
      }
      audit({ method: 'ui/message', outcome: 'ok' });
      return {};
    };
  }

  bridge.onrequestdisplaymode = async ({ mode }) => {
    const current = context.displayMode ?? 'inline';
    const hostModes = context.availableDisplayModes ?? [];
    const appModes = bridge.getAppCapabilities()?.availableDisplayModes ?? [];
    if (
      !STABLE_DISPLAY_MODES.has(mode) ||
      !hostModes.includes(mode) ||
      !appModes.includes(mode) ||
      !options.requestDisplayMode
    ) {
      return { mode: current };
    }
    const applied = options.requestDisplayMode(mode);
    if (
      !STABLE_DISPLAY_MODES.has(applied) ||
      !hostModes.includes(applied) ||
      !appModes.includes(applied)
    ) {
      return { mode: current };
    }
    context = { ...context, displayMode: applied };
    audit({ method: 'ui/request-display-mode', outcome: 'ok', detail: applied });
    return { mode: applied };
  };

  async function teardown(appInitiated: boolean): Promise<void> {
    if (teardownPromise) return teardownPromise;
    teardownPromise = (async () => {
      if (initialized && !closed) {
        try {
          await bridge.teardownResource({}, { timeout: TEARDOWN_TIMEOUT_MS });
        } catch {
          // Timeout and view errors both mean the host proceeds with removal after one second.
        }
      }
      if (appInitiated) options.onRequestTeardown?.();
      closed = true;
      queue.length = 0;
      await bridge.close();
    })();
    return teardownPromise;
  }

  bridge.addEventListener('requestteardown', () => {
    audit({ method: 'ui/notifications/request-teardown', outcome: 'ok' });
    void teardown(true);
  });

  const ready = bridge.connect(transport);

  function deliverToolInput(args: Readonly<Record<string, unknown>>): void {
    if (toolInputSent) return;
    toolInputSent = true;
    enqueue(async () => bridge.sendToolInput({ arguments: { ...args } }));
  }

  function deliverToolResult(result: HostToolResult): void {
    if (!toolInputSent) deliverToolInput(options.tool?.arguments ?? {});
    enqueue(async () => bridge.sendToolResult(officialToolResult(result)));
  }

  return {
    async receive(data: unknown): Promise<void> {
      if (closed) return;
      await ready;
      const candidate = JSONRPCMessageSchema.safeParse(data);
      if (
        candidate.success &&
        'method' in candidate.data &&
        'id' in candidate.data &&
        candidate.data.method === 'ui/initialize'
      ) {
        audit({ method: 'ui/initialize', id: candidate.data.id, outcome: 'ok' });
      }
      if (
        candidate.success &&
        'method' in candidate.data &&
        'id' in candidate.data &&
        candidate.data.method === 'ui/open-link' &&
        !McpUiOpenLinkRequestSchema.safeParse(candidate.data).success
      ) {
        options.post({
          jsonrpc: '2.0',
          id: candidate.data.id,
          error: {
            code: JSON_RPC_ERROR.invalidParams,
            message: 'Invalid params for ui/open-link.',
          },
        });
        audit({ method: 'ui/open-link', id: candidate.data.id, outcome: 'error' });
        return;
      }
      await transport.receive(data);
    },
    deliverToolInputPartial(args): void {
      if (toolInputSent) return;
      enqueue(async () => bridge.sendToolInputPartial({ arguments: { ...args } }));
    },
    deliverToolInput,
    deliverToolResult,
    deliverToolCancelled(reason): void {
      enqueue(async () => bridge.sendToolCancelled(reason === undefined ? {} : { reason }));
    },
    updateHostContext(patch): void {
      context = stableHostContext({ ...context, ...patch }, context.displayMode ?? 'inline');
      if (!closed) bridge.setHostContext(context);
    },
    async requestTeardown(): Promise<void> {
      await teardown(false);
    },
    get initialized(): boolean {
      return initialized;
    },
    get appCapabilities(): McpUiAppCapabilities | null {
      return bridge.getAppCapabilities() ?? null;
    },
    get hostContext(): McpUiHostContext {
      return context;
    },
    close(): void {
      if (closed) return;
      closed = true;
      queue.length = 0;
      void bridge.close();
    },
  };
}

/**
 * Whether a resource is one this host knows how to render.
 *
 * @param resource - A resource read from a connected server.
 * @returns `true` for a `ui://` document served with the extension's mimeType.
 */
export function isRenderableUiResource(resource: {
  uri?: unknown;
  mimeType?: unknown;
  text?: unknown;
  blob?: unknown;
  meta?: unknown;
}): boolean {
  return (
    typeof resource.uri === 'string' &&
    resource.uri.startsWith('ui://') &&
    typeof resource.mimeType === 'string' &&
    resource.mimeType.trim() === RESOURCE_MIME_TYPE &&
    (resource.meta === undefined || McpUiResourceMetaSchema.safeParse(resource.meta).success) &&
    decodeUiResourceHtml(resource) !== null
  );
}

/**
 * Read an official MCP text or base64 blob resource as UTF-8 HTML.
 *
 * @param resource - A stable MCP resource content item.
 * @returns the HTML string, or `null` when neither representation is valid UTF-8 content.
 */
export function decodeUiResourceHtml(resource: { text?: unknown; blob?: unknown }): string | null {
  if (typeof resource.text === 'string') return resource.text;
  if (typeof resource.blob !== 'string') return null;
  if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(resource.blob))
    return null;
  try {
    const binary = atob(resource.blob);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
