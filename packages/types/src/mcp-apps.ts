/**
 * Browser-safe compatibility names for the official stable MCP Apps protocol.
 *
 * @remarks
 * Protocol types, schemas, method names, the MIME type, and the protocol version come from
 * `@modelcontextprotocol/ext-apps@1.7.5`. Docket keeps the `MCP_UI_*` names because they are a
 * public workspace contract, but it does not maintain a second copy of the wire definitions.
 */
import {
  DOWNLOAD_FILE_METHOD,
  HOST_CONTEXT_CHANGED_METHOD,
  INITIALIZED_METHOD,
  INITIALIZE_METHOD,
  LATEST_PROTOCOL_VERSION,
  MESSAGE_METHOD,
  OPEN_LINK_METHOD,
  REQUEST_DISPLAY_MODE_METHOD,
  REQUEST_TEARDOWN_METHOD,
  RESOURCE_MIME_TYPE,
  RESOURCE_TEARDOWN_METHOD,
  SANDBOX_PROXY_READY_METHOD,
  SANDBOX_RESOURCE_READY_METHOD,
  SIZE_CHANGED_METHOD,
  TOOL_CANCELLED_METHOD,
  TOOL_INPUT_METHOD,
  TOOL_INPUT_PARTIAL_METHOD,
  TOOL_RESULT_METHOD,
  type McpUiMessageRequest,
  type McpUiUpdateModelContextRequest,
} from '@modelcontextprotocol/ext-apps/app-bridge';

export type {
  McpUiAppCapabilities,
  McpUiClientCapabilities,
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostStyles,
  McpUiInitializeRequest,
  McpUiInitializeResult,
  McpUiResourceCsp,
  McpUiResourceMeta,
  McpUiResourcePermissions,
  McpUiStyleVariableKey,
  McpUiTheme,
  McpUiToolMeta,
  McpUiToolVisibility,
} from '@modelcontextprotocol/ext-apps/app-bridge';

/** The extension identifier reserved for MCP Apps. */
export const MCP_UI_EXTENSION = 'io.modelcontextprotocol/ui';

/** The official stable protocol version spoken by the pinned package. */
export const MCP_UI_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

/** The official MIME type for renderable MCP App HTML resources. */
export const MCP_UI_MIME_TYPE = RESOURCE_MIME_TYPE;

/** The URI scheme reserved for UI resources. */
export const MCP_UI_SCHEME = 'ui://';

/** The stable nested `_meta` key carrying MCP App metadata. */
export const MCP_UI_META_KEY = 'ui';

/** Official MCP Apps method names, grouped under Docket's compatibility facade. */
export const MCP_UI_METHODS = {
  initialize: INITIALIZE_METHOD,
  initialized: INITIALIZED_METHOD,
  toolInput: TOOL_INPUT_METHOD,
  toolInputPartial: TOOL_INPUT_PARTIAL_METHOD,
  toolResult: TOOL_RESULT_METHOD,
  toolCancelled: TOOL_CANCELLED_METHOD,
  hostContextChanged: HOST_CONTEXT_CHANGED_METHOD,
  openLink: OPEN_LINK_METHOD,
  downloadFile: DOWNLOAD_FILE_METHOD,
  message: MESSAGE_METHOD,
  updateModelContext: 'ui/update-model-context',
  requestDisplayMode: REQUEST_DISPLAY_MODE_METHOD,
  sizeChanged: SIZE_CHANGED_METHOD,
  requestTeardown: REQUEST_TEARDOWN_METHOD,
  resourceTeardown: RESOURCE_TEARDOWN_METHOD,
  sandboxProxyReady: SANDBOX_PROXY_READY_METHOD,
  sandboxResourceReady: SANDBOX_RESOURCE_READY_METHOD,
} as const;

/** A method name defined by the official MCP Apps protocol. */
export type McpUiMethod = (typeof MCP_UI_METHODS)[keyof typeof MCP_UI_METHODS];

/** Standard MCP methods used by the MCP Apps bridge. */
export const MCP_UI_PROXIED_METHODS = {
  callTool: 'tools/call',
  readResource: 'resources/read',
  ping: 'ping',
  log: 'notifications/message',
} as const;

/** A standard MCP method name used by the MCP Apps bridge. */
export type McpUiProxiedMethod =
  (typeof MCP_UI_PROXIED_METHODS)[keyof typeof MCP_UI_PROXIED_METHODS];

/** Every display mode the stable specification names. */
export const MCP_UI_DISPLAY_MODES = ['inline', 'fullscreen', 'pip'] as const;

/** One official content block accepted by `ui/message`. */
export type McpUiContentBlock = McpUiMessageRequest['params']['content'][number];

/** The official `ui/message` parameters. */
export type McpUiMessageParams = McpUiMessageRequest['params'];

/** The official `ui/update-model-context` parameters. */
export type McpUiUpdateModelContextParams = McpUiUpdateModelContextRequest['params'];

/** The MCP Apps client capability Docket advertises during MCP initialization. */
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
