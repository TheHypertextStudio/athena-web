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
  MCP_UI_METHODS,
  MCP_UI_MIME_TYPE,
  MCP_UI_PROTOCOL_VERSION,
  MCP_UI_PROXIED_METHODS,
  type McpUiAppCapabilities,
  type McpUiContentBlock,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  type McpUiInitializeResult,
  type McpUiResourceCsp,
  type McpUiResourceMeta,
  type McpUiResourcePermissions,
} from '@docket/types';

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

/** A JSON-RPC message travelling in either direction across the bridge. */
export interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/** The `CallToolResult` shape the host relays to a view. */
export interface HostToolResult {
  readonly content?: readonly McpUiContentBlock[];
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
  readonly sendMessage?: (content: readonly McpUiContentBlock[]) => boolean | Promise<boolean>;
  /** Replace what the model is told about this view. */
  readonly updateModelContext?: (update: McpAppModelContext) => void;
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

/** What a view last told the model about itself. */
export interface McpAppModelContext {
  readonly content?: readonly McpUiContentBlock[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
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
  const resources = csp?.resourceDomains?.join(' ') ?? '';
  const connect = csp?.connectDomains?.join(' ') ?? '';
  const frames = csp?.frameDomains?.join(' ') ?? '';
  const bases = csp?.baseUriDomains?.join(' ') ?? '';
  const directives = [
    `default-src 'none'`,
    `script-src 'self' 'unsafe-inline'${resources ? ` ${resources}` : ''}`,
    `style-src 'self' 'unsafe-inline'${resources ? ` ${resources}` : ''}`,
    `img-src 'self' data:${resources ? ` ${resources}` : ''}`,
    `font-src 'self'${resources ? ` ${resources}` : ''}`,
    `media-src 'self' data:${resources ? ` ${resources}` : ''}`,
    `connect-src ${connect || `'none'`}`,
    `frame-src ${frames || `'none'`}`,
    `object-src 'none'`,
    `base-uri ${bases || `'self'`}`,
    `form-action 'none'`,
  ];
  return `${directives.join('; ')};`;
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

/** The capabilities this host advertises to a view. */
function hostCapabilities(options: McpAppHostOptions): McpUiHostCapabilities {
  const modalities = { text: {}, image: {}, resource: {}, structuredContent: {} } as const;
  return {
    ...(options.openLink ? { openLinks: {} } : {}),
    ...(options.downloadFile ? { downloadFile: {} } : {}),
    ...(options.callTool ? { serverTools: { listChanged: false } } : {}),
    ...(options.readResource ? { serverResources: { listChanged: false } } : {}),
    ...(options.log ? { logging: {} } : {}),
    ...(options.updateModelContext ? { updateModelContext: modalities } : {}),
    ...(options.sendMessage ? { message: { text: {}, image: {} } } : {}),
    sandbox: {
      csp: options.resource.meta?.csp ?? {},
      permissions: options.resource.meta?.permissions ?? {},
    },
  };
}

/** Read a plain object off a JSON-RPC message, or `null`. */
function objectParams(params: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  return params as Readonly<Record<string, unknown>>;
}

/** Read a `string` field off a params object. */
function stringField(params: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = params?.[key];
  return typeof value === 'string' ? value : null;
}

/** Normalize `ui/message` content, which the spec types as an array of content blocks. */
function contentBlocks(value: unknown): readonly McpUiContentBlock[] | null {
  if (Array.isArray(value)) {
    const blocks = value.filter(
      (item): item is McpUiContentBlock =>
        typeof item === 'object' && item !== null && typeof Reflect.get(item, 'type') === 'string',
    );
    return blocks.length === value.length ? blocks : null;
  }
  // The spec's prose example shows a single block where the type says an array; accept both so a
  // widget written against either reading works.
  if (typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string')
    return [value as McpUiContentBlock];
  return null;
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
  /** The last `ui/update-model-context` the view sent, or `null`. */
  readonly modelContext: McpAppModelContext | null;
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
  let appCapabilities: McpUiAppCapabilities | null = null;
  let modelContext: McpAppModelContext | null = null;
  let context: McpUiHostContext = { ...(options.hostContext ?? {}) };
  /** Host→view messages held until `ui/notifications/initialized` arrives. */
  const queue: JsonRpcMessage[] = [];
  /** Pending host→view requests, keyed by the id we minted. */
  const pending = new Map<JsonRpcId, (message: JsonRpcMessage) => void>();
  let nextRequestId = 1;

  const audit = (entry: McpAppAuditEntry): void => {
    options.onAudit?.(entry);
  };

  const send = (message: JsonRpcMessage): void => {
    if (closed) return;
    // The spec is explicit: nothing reaches the View before it announces `initialized`. Holding
    // the message here rather than asking callers to wait is what makes the ordering a property
    // of the bridge instead of a convention.
    if (!initialized) {
      queue.push(message);
      return;
    }
    options.post(message);
  };

  const flush = (): void => {
    while (queue.length > 0) {
      const message = queue.shift();
      if (message) options.post(message);
    }
  };

  const respond = (id: JsonRpcId, result: unknown): void => {
    // A response to the View's own request is not subject to the initialized gate — the View is
    // blocked on it, and `ui/initialize` is by definition answered before `initialized` arrives.
    if (!closed) options.post({ jsonrpc: '2.0', id, result });
  };

  const fail = (id: JsonRpcId, code: number, message: string): void => {
    if (!closed) options.post({ jsonrpc: '2.0', id, error: { code, message } });
  };

  const notify = (method: string, params: unknown): void => {
    send({ jsonrpc: '2.0', method, params });
  };

  const handleInitialize = (id: JsonRpcId, params: Readonly<Record<string, unknown>>): void => {
    const declared = params['appCapabilities'];
    appCapabilities = typeof declared === 'object' && declared !== null ? declared : {};
    const requested = params['protocolVersion'];
    const result: McpUiInitializeResult = {
      // Echo a version we can serve; otherwise state ours and let the view decide.
      protocolVersion:
        typeof requested === 'string' && requested === MCP_UI_PROTOCOL_VERSION
          ? requested
          : MCP_UI_PROTOCOL_VERSION,
      hostInfo: options.hostInfo,
      hostCapabilities: hostCapabilities(options),
      hostContext: {
        ...context,
        availableDisplayModes: context.availableDisplayModes ?? AVAILABLE_DISPLAY_MODES,
        ...(options.tool
          ? {
              toolInfo: {
                ...(options.tool.requestId === undefined ? {} : { id: options.tool.requestId }),
                tool: options.tool.definition ?? { name: options.tool.name },
              },
            }
          : {}),
      },
    };
    context = result.hostContext;
    respond(id, result);
    audit({ method: MCP_UI_METHODS.initialize, id, outcome: 'ok' });
  };

  const handleCallTool = async (
    id: JsonRpcId,
    params: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const name = stringField(params, 'name');
    if (!name) {
      fail(id, JSON_RPC_ERROR.invalidParams, 'tools/call requires a tool name.');
      audit({ method: MCP_UI_PROXIED_METHODS.callTool, id, outcome: 'error', detail: 'no-name' });
      return;
    }
    if (!options.callTool) {
      fail(id, JSON_RPC_ERROR.methodNotFound, 'This host does not proxy tool calls.');
      audit({ method: MCP_UI_PROXIED_METHODS.callTool, id, outcome: 'error', detail: name });
      return;
    }
    const decision = options.authorizeTool?.(name) ?? {
      allowed: false,
      reason: 'This host has not authorized any tools for embedded views.',
    };
    if (!decision.allowed) {
      // An out-of-scope call is answered with an error carrying the tool name, never a silent
      // success and never an empty result: a widget must be able to tell "refused" from "did
      // nothing", and a person reading the audit log must be able to tell which tool was asked for.
      fail(id, JSON_RPC_ERROR.refused, `${name}: ${decision.reason}`);
      audit({
        method: MCP_UI_PROXIED_METHODS.callTool,
        id,
        outcome: 'error',
        detail: `refused:${name}`,
      });
      return;
    }
    const args = objectParams(params['arguments']) ?? {};
    try {
      const result = await options.callTool(name, args);
      respond(id, result);
      audit({ method: MCP_UI_PROXIED_METHODS.callTool, id, outcome: 'ok', detail: name });
      // The interactive-phase sequence in the spec: a view-initiated tool call replays the same
      // input/result notifications the original call did, so a view that renders purely from
      // notifications needs no second code path for its own calls.
      toolInputSent = false;
      deliverToolInput(args);
      deliverToolResult(result);
    } catch {
      fail(id, JSON_RPC_ERROR.internalError, `${name}: the tool call did not complete.`);
      audit({
        method: MCP_UI_PROXIED_METHODS.callTool,
        id,
        outcome: 'error',
        detail: `failed:${name}`,
      });
    }
  };

  const handleReadResource = async (
    id: JsonRpcId,
    params: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const uri = stringField(params, 'uri');
    if (!uri) {
      fail(id, JSON_RPC_ERROR.invalidParams, 'resources/read requires a uri.');
      return;
    }
    if (!options.readResource) {
      fail(id, JSON_RPC_ERROR.methodNotFound, 'This host does not proxy resource reads.');
      return;
    }
    try {
      respond(id, await options.readResource(uri));
      audit({ method: MCP_UI_PROXIED_METHODS.readResource, id, outcome: 'ok', detail: uri });
    } catch {
      fail(id, JSON_RPC_ERROR.internalError, 'The resource could not be read.');
      audit({ method: MCP_UI_PROXIED_METHODS.readResource, id, outcome: 'error', detail: uri });
    }
  };

  const handleOpenLink = async (
    id: JsonRpcId,
    params: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const url = stringField(params, 'url');
    if (!url) {
      fail(id, JSON_RPC_ERROR.invalidParams, 'ui/open-link requires a url.');
      return;
    }
    if (!options.openLink) {
      fail(id, JSON_RPC_ERROR.methodNotFound, 'This host cannot open links.');
      return;
    }
    const opened = await options.openLink(url);
    if (opened) {
      respond(id, {});
      audit({ method: MCP_UI_METHODS.openLink, id, outcome: 'ok', detail: url });
      return;
    }
    // A refusal is a JSON-RPC error, not `{ isError: true }` with a 200 — a widget that cannot
    // distinguish "opened" from "blocked" will show the user a link it believes worked.
    fail(id, JSON_RPC_ERROR.refused, 'This host did not open that link.');
    audit({ method: MCP_UI_METHODS.openLink, id, outcome: 'error', detail: url });
  };

  const handleMessage = async (
    id: JsonRpcId,
    params: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const blocks = contentBlocks(params['content']);
    const role = stringField(params, 'role');
    if (!blocks || blocks.length === 0) {
      fail(id, JSON_RPC_ERROR.invalidParams, 'ui/message requires message content.');
      return;
    }
    if (role !== null && role !== 'user') {
      // The extension allows only `user`. A widget must not be able to put words in the
      // assistant's mouth in a transcript the user reads as Athena's.
      fail(id, JSON_RPC_ERROR.invalidParams, 'ui/message may only send a user message.');
      audit({ method: MCP_UI_METHODS.message, id, outcome: 'error', detail: 'role' });
      return;
    }
    if (!options.sendMessage) {
      fail(id, JSON_RPC_ERROR.methodNotFound, 'This host does not accept messages from views.');
      return;
    }
    const sent = await options.sendMessage(blocks);
    if (sent) {
      respond(id, {});
      audit({ method: MCP_UI_METHODS.message, id, outcome: 'ok' });
      return;
    }
    fail(id, JSON_RPC_ERROR.refused, 'This host did not post that message.');
    audit({ method: MCP_UI_METHODS.message, id, outcome: 'error' });
  };

  const handleUpdateModelContext = (
    id: JsonRpcId,
    params: Readonly<Record<string, unknown>>,
  ): void => {
    if (!options.updateModelContext) {
      fail(id, JSON_RPC_ERROR.methodNotFound, 'This host does not accept context updates.');
      return;
    }
    const content = contentBlocks(params['content']);
    const structured = objectParams(params['structuredContent']);
    if (!content && !structured) {
      fail(id, JSON_RPC_ERROR.invalidParams, 'ui/update-model-context requires content.');
      return;
    }
    // "Each request overwrites the previous context sent by the View" — so this is an assignment,
    // not an append. Accumulating would make the model see a change and its own undo at once.
    modelContext = {
      ...(content ? { content } : {}),
      ...(structured ? { structuredContent: structured } : {}),
    };
    options.updateModelContext(modelContext);
    respond(id, {});
    audit({ method: MCP_UI_METHODS.updateModelContext, id, outcome: 'ok' });
  };

  const handleRequestDisplayMode = (
    id: JsonRpcId,
    params: Readonly<Record<string, unknown>>,
  ): void => {
    const requested = stringField(params, 'mode');
    if (requested !== 'inline' && requested !== 'fullscreen' && requested !== 'pip') {
      fail(id, JSON_RPC_ERROR.invalidParams, 'ui/request-display-mode requires a known mode.');
      return;
    }
    const applied = options.requestDisplayMode
      ? options.requestDisplayMode(requested)
      : (context.displayMode ?? 'inline');
    // The result reports what actually happened, which may not be what was asked for; the view
    // reads the result rather than assuming its request was honoured.
    context = { ...context, displayMode: applied };
    respond(id, { mode: applied });
    audit({ method: MCP_UI_METHODS.requestDisplayMode, id, outcome: 'ok', detail: applied });
  };

  const handleDownloadFile = async (
    id: JsonRpcId,
    params: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const contents = params['contents'];
    if (!Array.isArray(contents) || contents.length === 0) {
      fail(id, JSON_RPC_ERROR.invalidParams, 'ui/download-file requires resource contents.');
      return;
    }
    if (!options.downloadFile) {
      fail(id, JSON_RPC_ERROR.methodNotFound, 'This host does not download files for views.');
      return;
    }
    const accepted = await options.downloadFile(contents);
    if (accepted) {
      respond(id, {});
      audit({ method: MCP_UI_METHODS.downloadFile, id, outcome: 'ok' });
      return;
    }
    fail(id, JSON_RPC_ERROR.refused, 'This host did not download that file.');
    audit({ method: MCP_UI_METHODS.downloadFile, id, outcome: 'error' });
  };

  function deliverToolInput(args: Readonly<Record<string, unknown>>): void {
    if (toolInputSent) return;
    toolInputSent = true;
    notify(MCP_UI_METHODS.toolInput, { arguments: args });
  }

  function deliverToolResult(result: HostToolResult): void {
    // The spec requires complete tool input before the result. If a caller never supplied
    // arguments, an empty set is still sent, because the view is entitled to rely on the
    // ordering and a missing notification would strand a view that waits for it.
    if (!toolInputSent) deliverToolInput(options.tool?.arguments ?? {});
    notify(MCP_UI_METHODS.toolResult, result);
  }

  const host: McpAppHost = {
    async receive(data: unknown): Promise<void> {
      if (closed) return;
      const message = objectParams(data);
      if (message?.['jsonrpc'] !== '2.0') return;
      const id = message['id'];
      const method = typeof message['method'] === 'string' ? message['method'] : null;

      // A response to one of the host's own requests (currently only `ui/resource-teardown`).
      if (
        !method &&
        (id === undefined ? false : typeof id === 'string' || typeof id === 'number')
      ) {
        const waiter = pending.get(id as JsonRpcId);
        if (waiter) {
          pending.delete(id as JsonRpcId);
          waiter(message as unknown as JsonRpcMessage);
        }
        return;
      }
      if (!method) return;

      const params = objectParams(message['params']);

      // Notifications carry no id and are never answered.
      if (id === undefined) {
        switch (method) {
          case MCP_UI_METHODS.initialized:
            if (!initialized) {
              initialized = true;
              flush();
            }
            audit({ method, outcome: 'ok' });
            return;
          case MCP_UI_METHODS.sizeChanged:
            options.onSizeChanged?.({
              ...(typeof params?.['width'] === 'number' ? { width: params['width'] } : {}),
              ...(typeof params?.['height'] === 'number' ? { height: params['height'] } : {}),
            });
            return;
          case MCP_UI_METHODS.requestTeardown:
            options.onRequestTeardown?.();
            audit({ method, outcome: 'ok' });
            return;
          case MCP_UI_PROXIED_METHODS.log:
            options.log?.(message['params']);
            return;
          default:
            // Unknown notifications are dropped, per JSON-RPC: there is nobody to tell.
            return;
        }
      }

      const requestId = id as JsonRpcId;
      if (!params && method !== MCP_UI_PROXIED_METHODS.ping) {
        fail(requestId, JSON_RPC_ERROR.invalidParams, `${method} requires params.`);
        return;
      }
      const safeParams = params ?? {};

      switch (method) {
        case MCP_UI_METHODS.initialize:
          handleInitialize(requestId, safeParams);
          return;
        case MCP_UI_PROXIED_METHODS.ping:
          respond(requestId, {});
          return;
        case MCP_UI_PROXIED_METHODS.callTool:
          await handleCallTool(requestId, safeParams);
          return;
        case MCP_UI_PROXIED_METHODS.readResource:
          await handleReadResource(requestId, safeParams);
          return;
        case MCP_UI_METHODS.openLink:
          await handleOpenLink(requestId, safeParams);
          return;
        case MCP_UI_METHODS.message:
          await handleMessage(requestId, safeParams);
          return;
        case MCP_UI_METHODS.updateModelContext:
          handleUpdateModelContext(requestId, safeParams);
          return;
        case MCP_UI_METHODS.requestDisplayMode:
          handleRequestDisplayMode(requestId, safeParams);
          return;
        case MCP_UI_METHODS.downloadFile:
          await handleDownloadFile(requestId, safeParams);
          return;
        default:
          // Everything else is refused by name. The host is a policy boundary: a view cannot
          // reach a server method simply because the server would have answered it.
          fail(requestId, JSON_RPC_ERROR.methodNotFound, `${method} is not available to views.`);
          audit({ method, id: requestId, outcome: 'error', detail: 'method-not-found' });
      }
    },

    deliverToolInputPartial(args: Readonly<Record<string, unknown>>): void {
      // "MUST stop sending once tool-input is sent with complete arguments."
      if (toolInputSent) return;
      notify(MCP_UI_METHODS.toolInputPartial, { arguments: args });
    },

    deliverToolInput,
    deliverToolResult,

    deliverToolCancelled(reason?: string): void {
      notify(MCP_UI_METHODS.toolCancelled, reason === undefined ? {} : { reason });
    },

    updateHostContext(patch: McpUiHostContext): void {
      context = { ...context, ...patch };
      // Partial by design: the view merges. Sending the whole context would make a theme flip
      // indistinguishable from a re-initialization, which is what causes the flash this
      // notification exists to avoid.
      notify(MCP_UI_METHODS.hostContextChanged, patch);
    },

    async requestTeardown(reason?: string): Promise<void> {
      if (closed || !initialized) return;
      const id: JsonRpcId = `host-${String(nextRequestId++)}`;
      const answered = new Promise<void>((resolve) => {
        pending.set(id, () => {
          resolve();
        });
      });
      options.post({
        jsonrpc: '2.0',
        id,
        method: MCP_UI_METHODS.resourceTeardown,
        params: reason === undefined ? {} : { reason },
      });
      await answered;
      pending.delete(id);
    },

    get initialized(): boolean {
      return initialized;
    },
    get appCapabilities(): McpUiAppCapabilities | null {
      return appCapabilities;
    },
    get modelContext(): McpAppModelContext | null {
      return modelContext;
    },
    get hostContext(): McpUiHostContext {
      return context;
    },

    close(): void {
      closed = true;
      queue.length = 0;
      pending.clear();
    },
  };

  return host;
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
}): boolean {
  return (
    typeof resource.uri === 'string' &&
    resource.uri.startsWith('ui://') &&
    typeof resource.mimeType === 'string' &&
    resource.mimeType.split(';')[0]?.trim() === MCP_UI_MIME_TYPE.split(';')[0] &&
    resource.mimeType.includes('profile=mcp-app') &&
    typeof resource.text === 'string'
  );
}
