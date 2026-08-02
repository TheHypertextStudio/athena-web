/**
 * `@docket/types` — the MCP Apps extension wire protocol (`io.modelcontextprotocol/ui`).
 *
 * @remarks
 * These names are transcribed from the committed copy of the specification at
 * `docs/engineering/specs/vendor/mcp-apps-2026-01-26.mdx` (version `2026-01-26`, retrieved
 * 2026-08-02) and its published type source. They live in `@docket/types` rather than in the
 * host or the view because BOTH sides of the bridge must agree on them: the API serves widget
 * documents whose inline runtime speaks this protocol, and the web app hosts third-party widgets
 * that speak it back. A constant duplicated across that boundary is a protocol bug waiting to
 * happen, so there is exactly one spelling of each method name in the repo and it is here.
 *
 * A conformance suite (`packages/integrations/tests/mcp/mcp-apps-conformance.test.ts`) reads the
 * committed spec file and fails if any method named there is missing from
 * {@link MCP_UI_METHODS} — so this list cannot silently fall behind the text it claims to
 * implement.
 *
 * @see {@link https://apps.extensions.modelcontextprotocol.io/api/}
 */

/** The extension identifier reserved for MCP Apps. */
export const MCP_UI_EXTENSION = 'io.modelcontextprotocol/ui';

/**
 * The protocol version this implementation speaks.
 *
 * @remarks
 * Matches `LATEST_PROTOCOL_VERSION` in the committed spec type source. The host echoes the
 * view's version when it can serve it and its own otherwise; there is no other negotiation.
 */
export const MCP_UI_PROTOCOL_VERSION = '2026-01-26';

/** The mimeType every `ui://` resource is served as. */
export const MCP_UI_MIME_TYPE = 'text/html;profile=mcp-app';

/** The URI scheme reserved for UI resources. */
export const MCP_UI_SCHEME = 'ui://';

/**
 * The `_meta` key carrying UI metadata on a tool or a resource.
 *
 * @remarks
 * The stable spec spells this `_meta.ui` (see `interface Tool { _meta?: { ui?: McpUiToolMeta } }`
 * and the CSP construction snippet `resource._meta?.ui?.csp` in the committed copy). Docket
 * ALSO emits the full extension identifier as a second key on tools, because hosts written
 * against pre-stable drafts looked for that one; `_meta` is an open map, so carrying both costs
 * a few bytes and loses nothing. Readers must prefer {@link MCP_UI_META_KEY}.
 */
export const MCP_UI_META_KEY = 'ui';

/** Every JSON-RPC method the MCP Apps extension defines, by direction. */
export const MCP_UI_METHODS = {
  /** View → Host: the handshake request that opens the bridge. */
  initialize: 'ui/initialize',
  /** View → Host: the view has applied the initialize result and may now be sent data. */
  initialized: 'ui/notifications/initialized',
  /** Host → View: the complete tool arguments. Sent once, before any tool result. */
  toolInput: 'ui/notifications/tool-input',
  /** Host → View: best-effort partial arguments while the model is still streaming them. */
  toolInputPartial: 'ui/notifications/tool-input-partial',
  /** Host → View: the tool's `CallToolResult`. */
  toolResult: 'ui/notifications/tool-result',
  /** Host → View: the tool execution was abandoned; no result is coming. */
  toolCancelled: 'ui/notifications/tool-cancelled',
  /** Host → View: some part of the host context changed (theme, display mode, size…). */
  hostContextChanged: 'ui/notifications/host-context-changed',
  /** View → Host: open a URL outside the frame. */
  openLink: 'ui/open-link',
  /** View → Host: hand a file to the user through the host. */
  downloadFile: 'ui/download-file',
  /** View → Host: post a message into the host's conversation. */
  message: 'ui/message',
  /** View → Host: replace what the model is told about this view's state. */
  updateModelContext: 'ui/update-model-context',
  /** View → Host: ask to be shown inline / fullscreen / picture-in-picture. */
  requestDisplayMode: 'ui/request-display-mode',
  /** View → Host: the rendered body's size changed. */
  sizeChanged: 'ui/notifications/size-changed',
  /** View → Host: the view would like to be torn down. */
  requestTeardown: 'ui/notifications/request-teardown',
  /** Host → View: a request to shut down cleanly, answered before the frame is removed. */
  resourceTeardown: 'ui/resource-teardown',
  /** Sandbox → Host: the outer proxy frame can accept a document. */
  sandboxProxyReady: 'ui/notifications/sandbox-proxy-ready',
  /** Host → Sandbox: the document, its CSP, and its permissions. */
  sandboxResourceReady: 'ui/notifications/sandbox-resource-ready',
} as const;

/** A method name defined by the MCP Apps extension. */
export type McpUiMethod = (typeof MCP_UI_METHODS)[keyof typeof MCP_UI_METHODS];

/**
 * Standard MCP methods a view may send through the host bridge.
 *
 * @remarks
 * The spec's "Standard MCP Messages" section: these are proxied to the server the widget came
 * from, subject to the host's own authorization. Anything not on this list is refused — the host
 * is a policy boundary, not a relay.
 */
export const MCP_UI_PROXIED_METHODS = {
  /** Execute a tool on the originating MCP server. */
  callTool: 'tools/call',
  /** Read a resource from the originating MCP server. */
  readResource: 'resources/read',
  /** Liveness check. */
  ping: 'ping',
  /** Log a line to the host for debugging and telemetry. */
  log: 'notifications/message',
} as const;

/** A standard MCP method a view may send through the host bridge. */
export type McpUiProxiedMethod =
  (typeof MCP_UI_PROXIED_METHODS)[keyof typeof MCP_UI_PROXIED_METHODS];

/** Colour theme preference reported to a view. */
export type McpUiTheme = 'light' | 'dark';

/** How a view is presented by the host. */
export type McpUiDisplayMode = 'inline' | 'fullscreen' | 'pip';

/** Every display mode value the spec defines, in the spec's own order. */
export const MCP_UI_DISPLAY_MODES: readonly McpUiDisplayMode[] = ['inline', 'fullscreen', 'pip'];

/** Who may call a tool: the model, the app, or both. */
export type McpUiToolVisibility = 'model' | 'app';

/** UI metadata a tool carries to declare the widget its result renders through. */
export interface McpUiToolMeta {
  /** The `ui://` uri of the resource to render. */
  readonly resourceUri?: string;
  /** Who may call this tool. Absent means `['model', 'app']`. */
  readonly visibility?: readonly McpUiToolVisibility[];
}

/**
 * Origins a UI resource declares it needs.
 *
 * @remarks
 * Field names are the spec's. Anything omitted means "none" — the host builds a deny-all policy
 * and adds only what was declared, so a resource that declares nothing cannot reach the network.
 */
export interface McpUiResourceCsp {
  /** `connect-src`: fetch / XHR / WebSocket origins. */
  readonly connectDomains?: readonly string[];
  /** `img-src` / `script-src` / `style-src` / `font-src` / `media-src` origins. */
  readonly resourceDomains?: readonly string[];
  /** `frame-src`: origins the view may nest frames from. */
  readonly frameDomains?: readonly string[];
  /** `base-uri`: origins the document may set as its base. */
  readonly baseUriDomains?: readonly string[];
}

/** Browser capabilities a UI resource asks the host to grant its frame. */
export interface McpUiResourcePermissions {
  readonly camera?: Record<string, never>;
  readonly microphone?: Record<string, never>;
  readonly geolocation?: Record<string, never>;
  readonly clipboardWrite?: Record<string, never>;
}

/** The `_meta.ui` payload on a UI resource's contents. */
export interface McpUiResourceMeta {
  readonly csp?: McpUiResourceCsp;
  readonly permissions?: McpUiResourcePermissions;
  /** A dedicated sandbox origin the host should use for this resource, when it supports one. */
  readonly domain?: string;
  /** Whether the view wants the host to draw a border and background around it. */
  readonly prefersBorder?: boolean;
}

/** CSS custom properties and font blocks the host offers a view for theming. */
export interface McpUiHostStyles {
  readonly variables?: Readonly<Record<string, string | undefined>>;
  readonly css?: { readonly fonts?: string };
}

/**
 * What the host tells a view about the environment it is rendering into.
 *
 * @remarks
 * Deliberately open (`[key: string]: unknown` upstream) for forward compatibility; the fields
 * spelled out here are the ones Docket populates and the ones its tests assert on.
 */
export interface McpUiHostContext {
  readonly toolInfo?: {
    readonly id?: string | number;
    readonly tool: { readonly name: string; readonly [key: string]: unknown };
  };
  readonly theme?: McpUiTheme;
  readonly styles?: McpUiHostStyles;
  readonly displayMode?: McpUiDisplayMode;
  readonly availableDisplayModes?: readonly McpUiDisplayMode[];
  readonly containerDimensions?: {
    readonly width?: number;
    readonly height?: number;
    readonly maxWidth?: number;
    readonly maxHeight?: number;
  };
  readonly locale?: string;
  readonly timeZone?: string;
  readonly userAgent?: string;
  readonly platform?: 'web' | 'desktop' | 'mobile';
  readonly deviceCapabilities?: { readonly touch?: boolean; readonly hover?: boolean };
  readonly safeAreaInsets?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly [key: string]: unknown;
}

/** The content-block modalities a host accepts on `ui/message` / `ui/update-model-context`. */
export interface McpUiContentModalities {
  readonly text?: Record<string, never>;
  readonly image?: Record<string, never>;
  readonly audio?: Record<string, never>;
  readonly resource?: Record<string, never>;
  readonly resourceLink?: Record<string, never>;
  readonly structuredContent?: Record<string, never>;
}

/** What the host tells a view it is able to do for it. */
export interface McpUiHostCapabilities {
  readonly experimental?: Readonly<Record<string, object>>;
  readonly openLinks?: Record<string, never>;
  readonly downloadFile?: Record<string, never>;
  readonly serverTools?: { readonly listChanged?: boolean };
  readonly serverResources?: { readonly listChanged?: boolean };
  readonly logging?: Record<string, never>;
  readonly sandbox?: {
    readonly permissions?: McpUiResourcePermissions;
    readonly csp?: McpUiResourceCsp;
  };
  readonly updateModelContext?: McpUiContentModalities;
  readonly message?: McpUiContentModalities;
  readonly sampling?: { readonly tools?: Record<string, never> };
}

/** What a view tells the host it is able to do. */
export interface McpUiAppCapabilities {
  readonly experimental?: Readonly<Record<string, object>>;
  readonly tools?: { readonly listChanged?: boolean };
  readonly availableDisplayModes?: readonly McpUiDisplayMode[];
}

/** The `ui/initialize` params a view sends. */
export interface McpUiInitializeParams {
  readonly appInfo: { readonly name: string; readonly version: string };
  readonly appCapabilities: McpUiAppCapabilities;
  readonly protocolVersion: string;
}

/** The `ui/initialize` result the host answers with. */
export interface McpUiInitializeResult {
  readonly protocolVersion: string;
  readonly hostInfo: { readonly name: string; readonly version: string };
  readonly hostCapabilities: McpUiHostCapabilities;
  readonly hostContext: McpUiHostContext;
}

/** A JSON-RPC content block, narrowed to what this bridge carries. */
export interface McpUiContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

/**
 * The `ui/message` params a view sends to post into the conversation.
 *
 * @remarks
 * `role` is required and, in this spec revision, may only be `'user'` — a widget cannot forge a
 * message from the assistant.
 */
export interface McpUiMessageParams {
  readonly role: 'user';
  readonly content: readonly McpUiContentBlock[];
}

/** The `ui/update-model-context` params a view sends. */
export interface McpUiUpdateModelContextParams {
  readonly content?: readonly McpUiContentBlock[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
}

/**
 * The MCP Apps client capability a host advertises to servers during `initialize`.
 *
 * @remarks
 * Goes under `capabilities.extensions['io.modelcontextprotocol/ui']`. `mimeTypes` is REQUIRED by
 * the spec, which is why it is not optional here.
 */
export interface McpUiClientCapability {
  readonly mimeTypes: readonly string[];
}

/**
 * Whether a URI names a UI resource.
 *
 * @param uri - Any resource URI.
 * @returns `true` when it uses the reserved `ui://` scheme.
 */
export function isUiResourceUri(uri: string): boolean {
  return uri.startsWith(MCP_UI_SCHEME);
}
