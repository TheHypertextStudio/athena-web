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
  McpUiResourceMetaSchema,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  type McpUiUpdateModelContextRequest,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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

/** Maximum serialized size of one retained MCP App presentation. */
export const MCP_APP_PRESENTATION_MAX_BYTES = 2 * 1024 * 1024;

/** Stable, host-retained metadata for one normalized MCP App resource. */
export interface McpAppResourceSnapshotMeta {
  /** Origins the app may contact or load, after stable-schema validation. */
  readonly csp?: McpUiResourceCsp | undefined;
  /** Browser capabilities the app requested, after stable-schema validation. */
  readonly permissions?: McpUiResourcePermissions | undefined;
  /** Server-requested host domain hint; Docket still owns the actual sandbox origin. */
  readonly domain?: string | undefined;
  /** Whether the host should draw a visible boundary around the app. */
  readonly prefersBorder?: boolean | undefined;
}

/** A decoded, renderable `ui://` document safe to hand to the sandbox adapter. */
export interface McpAppResourceSnapshot {
  /** The stable `ui://` resource identifier. */
  readonly uri: string;
  /** The stable MCP App profile MIME type. */
  readonly mimeType: string;
  /** Decoded HTML, including when the server originally returned a base64 blob. */
  readonly text: string;
  /** Only stable resource metadata retained from the provider response. */
  readonly meta?: McpAppResourceSnapshotMeta | undefined;
}

/** A durable model-invoked MCP App card that can reopen without rerunning its tool. */
export interface McpAppPresentation {
  /** The owner-scoped personal MCP connection used for this call. */
  readonly connectionId: string;
  /** The application-owned visible name of the connected server. */
  readonly serverName: string;
  /** The remote server's un-namespaced tool name. */
  readonly tool: string;
  /** The JSON-safe arguments sent by the model. */
  readonly arguments: Readonly<Record<string, unknown>>;
  /** The validated raw stable MCP `CallToolResult`. */
  readonly result: CallToolResult;
  /** The normalized resource captured immediately after the tool call. */
  readonly resource: McpAppResourceSnapshot;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

const CREDENTIAL_KEYS = new Set([
  'authorization',
  'bearertoken',
  'cookie',
  'credential',
  'credentials',
  'password',
  'secret',
  'secrets',
  'token',
  'tokens',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'codeverifier',
  'privatekey',
]);

function containsCredential(value: unknown, seen = new WeakSet()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsCredential(item, seen));
  return Object.entries(value).some(
    ([key, item]) =>
      CREDENTIAL_KEYS.has(key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')) ||
      containsCredential(item, seen),
  );
}

function jsonSafeClone<T>(value: T, maxBytes: number = MCP_APP_PRESENTATION_MAX_BYTES): T | null {
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (
        item === undefined ||
        typeof item === 'bigint' ||
        typeof item === 'function' ||
        typeof item === 'symbol' ||
        (typeof item === 'number' && !Number.isFinite(item))
      ) {
        throw new TypeError('MCP presentation is not JSON-safe');
      }
      return item;
    });
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
      return null;
    }
    return JSON.parse(serialized) as T;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseMcpAppResource(value: unknown): McpAppResourceSnapshot | null {
  const resource = record(value);
  if (!resource || !nonEmptyString(resource['uri']) || !isUiResourceUri(resource['uri'])) {
    return null;
  }
  if (resource['mimeType'] !== MCP_UI_MIME_TYPE || typeof resource['text'] !== 'string') {
    return null;
  }
  const meta = McpUiResourceMetaSchema.safeParse(resource['meta'] ?? {});
  if (!meta.success) return null;
  return {
    uri: resource['uri'],
    mimeType: resource['mimeType'],
    text: resource['text'],
    ...(Object.keys(meta.data).length > 0 ? { meta: meta.data as McpAppResourceSnapshotMeta } : {}),
  };
}

/** Validate and normalize an untrusted persisted MCP App presentation. */
export function parseMcpAppPresentation(value: unknown): McpAppPresentation | null {
  const source = record(value);
  if (!source) return null;
  const { connectionId, serverName, tool } = source;
  if (!nonEmptyString(connectionId) || !nonEmptyString(serverName) || !nonEmptyString(tool)) {
    return null;
  }
  const argumentsValue = record(source['arguments']);
  if (!argumentsValue) return null;
  const result = CallToolResultSchema.safeParse(source['result']);
  if (!result.success) return null;
  const resource = parseMcpAppResource(source['resource']);
  if (!resource) return null;
  const presentation: McpAppPresentation = {
    connectionId,
    serverName,
    tool,
    arguments: argumentsValue,
    result: result.data,
    resource,
  };
  if (containsCredential(presentation)) return null;
  return jsonSafeClone(presentation);
}

/** Maximum serialized size of one retained widget model-context update. */
export const MCP_APP_MODEL_CONTEXT_MAX_BYTES = 64 * 1024;

/**
 * A widget's retained `ui/update-model-context` payload, ready for the agent's next turn.
 *
 * @remarks
 * Overwrite semantics per the extension: each update from a view replaces the previous one, so a
 * store holds at most one of these per widget instance. The content is widget-authored and stays
 * untrusted data wherever it later meets a model.
 */
export interface McpAppModelContext {
  /** Plain-text context joined from the update's text content blocks. */
  readonly text: string;
  /** The update's machine-readable context, when it carried one. */
  readonly structuredContent?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Validate and normalize an untrusted `ui/update-model-context` payload.
 *
 * @remarks
 * Docket advertises the `{ text: {} }` modality only, so a content array holding anything but
 * text blocks is rejected outright rather than filtered — a widget that sends an image believed
 * it would be kept. The same credential scan and JSON-safety bounds as
 * {@link parseMcpAppPresentation} apply, with a far smaller size cap: this is a note to the
 * model, not a document store.
 *
 * @param value - The raw request params (`content`, `structuredContent`).
 * @returns the bounded context, or `null` when nothing safe and non-empty remains.
 */
export function parseMcpAppModelContext(value: unknown): McpAppModelContext | null {
  const source = record(value);
  if (!source) return null;
  const structured = record(source['structuredContent']);
  const lines: string[] = [];
  if (source['content'] !== undefined) {
    if (!Array.isArray(source['content'])) return null;
    for (const blockValue of source['content']) {
      const block = record(blockValue);
      if (block?.['type'] !== 'text' || typeof block['text'] !== 'string') return null;
      lines.push(block['text']);
    }
  }
  const text = lines.join('\n').trim();
  if (text.length === 0 && !structured) return null;
  const context: McpAppModelContext = {
    text,
    ...(structured ? { structuredContent: structured } : {}),
  };
  if (containsCredential(context)) return null;
  return jsonSafeClone(context, MCP_APP_MODEL_CONTEXT_MAX_BYTES);
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
