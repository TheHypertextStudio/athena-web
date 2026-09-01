/**
 * Remote MCP server connector contracts plus real and deterministic adapters.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  McpUiResourceMetaSchema,
  McpUiToolMetaSchema,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import {
  MCP_UI_EXTENSION,
  MCP_UI_META_KEY,
  MCP_UI_MIME_TYPE,
  parseMcpAppPresentation,
  type McpAppPresentation,
  type McpAppResourceSnapshot,
  type McpUiClientCapability,
  type McpUiResourceMeta,
  type McpUiToolMeta,
} from './contracts/mcp-apps';

import { SUNSAMA_BACKLOG } from './fixtures';
import { decodeUiResourceHtml, isRenderableUiResource } from './mcp-apps-host';
import { mcpSafeFetch } from './mcp-network';

/**
 * The MCP Apps capability Docket declares when it opens a remote session.
 *
 * @remarks
 * Servers are told to check this before registering UI-enabled tools: a server that does not see
 * it registers text-only variants. Declaring it is therefore the difference between a connected
 * server offering Docket a widget and offering it JSON, and it costs nothing when the server does
 * not implement the extension.
 */
export const MCP_UI_CLIENT_CAPABILITY: McpUiClientCapability = {
  mimeTypes: [MCP_UI_MIME_TYPE],
};

/**
 * Read a tool's UI metadata from its `_meta`.
 *
 * @remarks
 * The stable specification puts this under `_meta.ui`. Hosts written against the pre-stable
 * drafts looked under the full extension identifier instead, and some servers still emit only
 * that, so both are read — `_meta.ui` first, because it is the spelling the published text uses.
 *
 * @param meta - A tool's or resource's `_meta`, as the server sent it.
 * @returns the UI metadata, or `null` when the tool declares none.
 */
export function readUiToolMeta(meta: unknown): McpUiToolMeta | null {
  if (typeof meta !== 'object' || meta === null) return null;
  for (const key of [MCP_UI_META_KEY, MCP_UI_EXTENSION]) {
    const candidate: unknown = Reflect.get(meta, key);
    const parsed = McpUiToolMetaSchema.safeParse(candidate);
    if (parsed.success) return parsed.data as McpUiToolMeta;
  }
  return null;
}

/**
 * Spread a tool's UI metadata into a descriptor, or nothing when it declares none.
 *
 * @param meta - A tool's `_meta`, as the server sent it.
 * @returns `{ ui }` or an empty object, so `exactOptionalPropertyTypes` stays satisfied.
 */
export function uiMetaSpread(meta: unknown): { ui?: McpUiToolMeta | undefined } {
  const ui = readUiToolMeta(meta);
  return ui ? { ui } : {};
}

/**
 * Read a UI resource's `_meta.ui`, which carries its CSP and permission declarations.
 *
 * @param meta - The `_meta` on a `resources/read` content item.
 * @returns the resource metadata, or `null` when it declares none.
 */
export function readUiResourceMeta(meta: unknown): McpUiResourceMeta | null {
  if (typeof meta !== 'object' || meta === null) return null;
  for (const key of [MCP_UI_META_KEY, MCP_UI_EXTENSION]) {
    if (!Object.hasOwn(meta, key)) continue;
    const parsed = McpUiResourceMetaSchema.safeParse(Reflect.get(meta, key));
    if (parsed.success) return parsed.data as McpUiResourceMeta;
    return null;
  }
  return null;
}

function declaresUiResourceMeta(meta: unknown): boolean {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    [MCP_UI_META_KEY, MCP_UI_EXTENSION].some((key) => Object.hasOwn(meta, key))
  );
}

/** A remote MCP endpoint plus its unsealed credential. */
export interface McpEndpoint {
  /** The server URL (Streamable HTTP). */
  readonly url: string;
  /** Bearer token sent on every request, when the server requires one. */
  readonly bearerToken?: string | undefined;
}

/** The gate-relevant annotation hints a remote tool may declare. */
export interface RemoteToolAnnotations {
  /** Whether the tool declares itself side-effect free. */
  readonly readOnlyHint?: boolean | undefined;
  /** Whether the tool declares destructive updates. */
  readonly destructiveHint?: boolean | undefined;
  /** Whether the tool reaches further external systems. */
  readonly openWorldHint?: boolean | undefined;
}

/** One tool a remote server advertises. */
export interface RemoteToolDescriptor {
  /** The tool name on that server (un-namespaced). */
  readonly name: string;
  /** What the tool does. */
  readonly description: string;
  /** The JSON Schema for the tool's input. */
  readonly inputSchema: Record<string, unknown>;
  /** Declared annotations; absent hints classify as writes. */
  readonly annotations?: RemoteToolAnnotations | undefined;
  /**
   * The tool's MCP Apps metadata, when it declares a widget.
   *
   * @remarks
   * Present means the server offers a `ui://` document to render this tool's result through. The
   * agent path ignores it; the Athena UI reads `resourceUri` and asks for that resource.
   */
  readonly ui?: McpUiToolMeta | undefined;
}

/** The caller-owned identity needed to retain a model-invoked app presentation. */
export interface RemoteToolPresentationContext {
  /** The personal MCP connection id; never a credential. */
  readonly connectionId: string;
  /** The application-owned visible server name. */
  readonly serverName: string;
}

/** One `ui://` document read from a remote server. */
export interface RemoteUiResource {
  /** The `ui://` uri. */
  readonly uri: string;
  /** The mimeType the server served it as. */
  readonly mimeType: string;
  /** The HTML document. */
  readonly text: string;
  /** The resource's `_meta.ui`, carrying its declared CSP and permissions. */
  readonly meta?: McpUiResourceMeta | undefined;
}

/** The serialized outcome of one remote tool call. */
export interface RemoteToolResult {
  /** The concatenated text content of the MCP result. */
  readonly content: string;
  /** Whether the tool reported failure. */
  readonly isError: boolean;
  /** A bounded app presentation captured during this call, when the tool declares valid UI. */
  readonly presentation?: McpAppPresentation | undefined;
  /** A declared app could not be retained safely; render application-owned fallback copy. */
  readonly presentationUnavailable?: boolean | undefined;
}

/** The human-facing identity an MCP server advertises during initialization. */
export interface RemoteMcpServerInfo {
  /** The server's product name. */
  readonly name: string;
  /** A more descriptive title when the server provides one. */
  readonly title?: string | undefined;
}

/** One open session against a remote MCP server. */
export interface RemoteMcpSession {
  /** Read the server identity captured during MCP initialization. */
  serverInfo(): RemoteMcpServerInfo;
  /** List the server's tools. */
  listTools(): Promise<readonly RemoteToolDescriptor[]>;
  /** Call one tool by its un-namespaced name. */
  callTool(
    name: string,
    input: unknown,
    presentationContext?: RemoteToolPresentationContext,
  ): Promise<RemoteToolResult>;
  /**
   * Call one tool and keep the whole `CallToolResult`.
   *
   * @remarks
   * {@link RemoteMcpSession.callTool} flattens to text because that is what the agent loop reads.
   * A widget needs the structure — `structuredContent`, image blocks, `isError` — so the MCP Apps
   * host path uses this instead of re-parsing flattened text.
   */
  callToolRaw?(name: string, input: unknown): Promise<Record<string, unknown>>;
  /**
   * Read a `ui://` document the server advertised.
   *
   * @remarks
   * Optional because a connector that serves no widgets need not implement it; the host treats an
   * absent implementation as "this server offers no renderable UI".
   */
  readUiResource?(uri: string): Promise<RemoteUiResource | null>;
  /** Close the transport. */
  close(): Promise<void>;
}

export { MCP_APP_PRESENTATION_MAX_BYTES } from './contracts/mcp-apps';

/** Whether a remote tool may cross the requested stable MCP Apps visibility boundary. */
export function isRemoteToolVisibleTo(
  tool: RemoteToolDescriptor,
  audience: 'model' | 'app',
): boolean {
  const visibility = tool.ui?.visibility;
  return visibility === undefined || visibility.includes(audience);
}

function resourceSnapshot(resource: RemoteUiResource | null): McpAppResourceSnapshot | null {
  if (!resource || !isRenderableUiResource(resource)) return null;
  const meta = resource.meta;
  return {
    uri: resource.uri,
    mimeType: resource.mimeType,
    text: resource.text,
    ...(meta
      ? {
          meta: {
            ...(meta.csp ? { csp: meta.csp } : {}),
            ...(meta.permissions ? { permissions: meta.permissions } : {}),
            ...(meta.domain ? { domain: meta.domain } : {}),
            ...(meta.prefersBorder === undefined ? {} : { prefersBorder: meta.prefersBorder }),
          },
        }
      : {}),
  };
}

/** Build a bounded, credential-free presentation or omit it without disturbing text fallback. */
export function normalizeMcpAppPresentation(input: {
  readonly context: RemoteToolPresentationContext;
  readonly tool: RemoteToolDescriptor;
  readonly arguments: unknown;
  readonly result: unknown;
  readonly resource: RemoteUiResource | null;
}): McpAppPresentation | undefined {
  const result = CallToolResultSchema.safeParse(input.result);
  const resource = resourceSnapshot(input.resource);
  if (!result.success || !resource) return undefined;
  if (
    input.arguments === null ||
    typeof input.arguments !== 'object' ||
    Array.isArray(input.arguments)
  ) {
    return undefined;
  }
  const candidate: McpAppPresentation = {
    connectionId: input.context.connectionId,
    serverName: input.context.serverName,
    tool: input.tool.name,
    arguments: input.arguments as Readonly<Record<string, unknown>>,
    result: result.data,
    resource,
  };
  return parseMcpAppPresentation(candidate) ?? undefined;
}

/** The remote-MCP port: open a session against an endpoint. */
export interface McpConnector {
  /**
   * Open a session against `endpoint`.
   *
   * @param endpoint - The server URL plus optional credential.
   */
  open(endpoint: McpEndpoint): Promise<RemoteMcpSession>;
}

/** One scripted fixture server. */
export interface FixtureMcpServer {
  /** The server identity returned during initialization. */
  readonly serverInfo?: RemoteMcpServerInfo | undefined;
  /** The advertised tools. */
  readonly tools: readonly RemoteToolDescriptor[];
  /** Resolve one call by un-namespaced tool name. */
  call(name: string, input: unknown): RemoteToolResult;
  /** The `ui://` documents this server serves, by uri. */
  readonly uiResources?: Readonly<Record<string, RemoteUiResource>> | undefined;
  /** The structured result for a call, when the fixture models one. */
  callRaw?(name: string, input: unknown): Record<string, unknown>;
}

/**
 * A widget-bearing fixture server, standing in for a third-party MCP Apps server.
 *
 * @remarks
 * Exists so the MCP Apps host path can be exercised end to end — connect, list, call, render,
 * click — without depending on someone else's uptime. It is deliberately NOT Docket: the document
 * is its own HTML with its own styling hooks, it declares its own CSP (nothing, i.e. deny-all),
 * and its tool is one Docket has no equivalent of.
 *
 * The document speaks the extension by hand rather than importing an SDK, because it runs under a
 * policy with no network. It sends `ui/initialize`, waits for the result, announces
 * `ui/notifications/initialized`, renders from `ui/notifications/tool-result`, and on a click
 * calls its own server tool and refreshes from the returned server state.
 */
export const WIDGET_FIXTURE_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Release checklist</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 14px 16px;
    font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
    color: var(--color-text-primary, #1a1a1a);
    background: var(--color-background-primary, #fff);
  }
  h1 { font-size: 14px; margin: 0 0 2px; }
  p.sub { margin: 0 0 12px; font-size: 12px; color: var(--color-text-secondary, #6b6b6b); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li {
    display: flex; align-items: center; gap: 8px; font-size: 13px;
    padding: 7px 10px; border-radius: 8px;
    background: var(--color-background-secondary, #f4f4f5);
  }
  li[data-done="true"] .label { text-decoration: line-through; color: var(--color-text-secondary, #6b6b6b); }
  .count { margin-left: auto; font-size: 12px; color: var(--color-text-secondary, #6b6b6b); }
  button {
    font: inherit; font-size: 12px; cursor: pointer;
    padding: 4px 10px; border-radius: 6px;
    border: 1px solid var(--color-border-primary, #e4e4e7);
    background: var(--color-background-primary, #fff);
    color: var(--color-text-primary, #1a1a1a);
  }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  a { color: var(--color-text-info, #2563eb); font-size: 12px; }
</style>
</head>
<body>
<h1 id="title">Release checklist</h1>
<p class="sub" id="sub">Waiting for data…</p>
<ul id="items"></ul>
<div class="row">
  <button id="advance" type="button">Mark next step done</button>
  <a id="open" href="#">Open in Acme</a>
</div>
<script>
(() => {
  const pending = new Map();
  let next = 1;
  const post = (m) => window.parent.postMessage(m, '*');
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = 'w' + String(next++);
      pending.set(id, { resolve, reject });
      post({ jsonrpc: '2.0', id, method, params });
    });
  const notify = (method, params) => post({ jsonrpc: '2.0', method, params });

  const applyStyles = (context) => {
    const variables = (context && context.styles && context.styles.variables) || {};
    for (const key of Object.keys(variables)) {
      if (key.indexOf('--') === 0 && variables[key]) {
        document.documentElement.style.setProperty(key, String(variables[key]));
      }
    }
  };

  const render = (result) => {
    const data = (result && result.structuredContent) || {};
    const steps = data.steps || [];
    document.getElementById('title').textContent = data.title || 'Release checklist';
    const done = steps.filter((s) => s.done).length;
    document.getElementById('sub').textContent = done + ' of ' + steps.length + ' done';
    const list = document.getElementById('items');
    list.textContent = '';
    for (const step of steps) {
      const li = document.createElement('li');
      li.setAttribute('data-done', String(Boolean(step.done)));
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = (step.done ? '✓ ' : '○ ') + step.name;
      li.appendChild(label);
      const owner = document.createElement('span');
      owner.className = 'count';
      owner.textContent = step.owner || '';
      li.appendChild(owner);
      list.appendChild(li);
    }
    const sizeTarget = document.body;
    notify('ui/notifications/size-changed', {
      width: sizeTarget.scrollWidth,
      height: sizeTarget.scrollHeight,
    });
  };

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error('refused'));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-result') { render(message.params); return; }
    if (message.method === 'ui/notifications/host-context-changed') { applyStyles(message.params); return; }
    if (message.method === 'ui/resource-teardown') { post({ jsonrpc: '2.0', id: message.id, result: {} }); return; }
  });

  document.getElementById('advance').addEventListener('click', () => {
    request('tools/call', { name: 'advance_release', arguments: {} })
      .catch(() => {
        document.getElementById('sub').textContent = 'Acme would not accept that change.';
      });
  });
  document.getElementById('open').addEventListener('click', (event) => {
    event.preventDefault();
    request('ui/open-link', { url: 'https://acme.example/releases/4-2' }).catch(() => undefined);
  });

  request('ui/initialize', {
    appInfo: { name: 'acme-release-view', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: '2026-01-26',
  })
    .then((result) => {
      applyStyles(result && result.hostContext);
      notify('ui/notifications/initialized', {});
    })
    .catch(() => {
      document.getElementById('sub').textContent = 'This card could not reach its host.';
    });
})();
</script>
</body>
</html>`;

/** The `ui://` uri the widget fixture serves its card under. */
export const WIDGET_FIXTURE_URI = 'ui://acme-release/checklist';

const RELEASE_STEPS = [
  { name: 'Cut the release branch', owner: 'Priya', done: true },
  { name: 'Run the migration rehearsal', owner: 'Sam', done: true },
  { name: 'Sign the build', owner: 'Priya', done: false },
  { name: 'Publish the changelog', owner: 'Wren', done: false },
];

/**
 * A third-party fixture server that returns an MCP Apps widget.
 *
 * @remarks
 * Stateful on purpose: `advance_release` really does flip the next step, so a click inside the
 * card produces a different render rather than a no-op that looks like one.
 */
export function createWidgetFixtureServer(): FixtureMcpServer {
  const steps = RELEASE_STEPS.map((step) => ({ ...step }));
  const snapshot = (): Record<string, unknown> => ({
    title: 'Release 4.2 checklist',
    steps: steps.map((step) => ({ ...step })),
  });
  const result = (): Record<string, unknown> => {
    const remaining = steps.filter((step) => !step.done).length;
    return {
      content: [
        {
          type: 'text',
          text: `Release 4.2 checklist: ${String(steps.length - remaining)} of ${String(steps.length)} steps done.`,
        },
      ],
      structuredContent: snapshot(),
      isError: false,
    };
  };

  return {
    serverInfo: { name: 'acme-release', title: 'Acme Release Tracker' },
    tools: [
      {
        name: 'release_checklist',
        description: 'Show the current release checklist as an interactive card.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        ui: { resourceUri: WIDGET_FIXTURE_URI },
      },
      {
        name: 'advance_release',
        description: 'Mark the next incomplete release step as done.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false, destructiveHint: false },
        ui: { resourceUri: WIDGET_FIXTURE_URI, visibility: ['model', 'app'] },
      },
      {
        // Model-only on purpose: the fixture exercises the spec's visibility rule, which is the
        // one thing a host must enforce that a widget cannot be trusted to respect.
        name: 'abandon_release',
        description: 'Abandon the release. The agent may do this; a card may not.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false, destructiveHint: true },
        ui: { resourceUri: WIDGET_FIXTURE_URI, visibility: ['model'] },
      },
      {
        // App-only helper: views may refresh through it, but model/manual launchers must not list
        // or invoke it directly.
        name: 'refresh_release_internal',
        description: 'Refresh the release card from its own embedded view.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        ui: { resourceUri: WIDGET_FIXTURE_URI, visibility: ['app'] },
      },
    ],
    uiResources: {
      [WIDGET_FIXTURE_URI]: {
        uri: WIDGET_FIXTURE_URI,
        mimeType: MCP_UI_MIME_TYPE,
        text: WIDGET_FIXTURE_HTML,
        // Declares no origins at all, so the host builds a deny-all policy for it.
        meta: { csp: {}, prefersBorder: true },
      },
    },
    call(name) {
      if (name === 'abandon_release') {
        for (const step of steps) step.done = false;
        return { content: JSON.stringify(snapshot()), isError: false };
      }
      if (
        name === 'release_checklist' ||
        name === 'advance_release' ||
        name === 'refresh_release_internal'
      ) {
        if (name === 'advance_release') {
          const next = steps.find((step) => !step.done);
          if (next) next.done = true;
        }
        const raw = result();
        return { content: JSON.stringify(raw['structuredContent']), isError: false };
      }
      return { content: `Unknown tool: ${name}`, isError: true };
    },
    callRaw(name) {
      if (name === 'abandon_release') {
        for (const step of steps) step.done = false;
        return result();
      }
      if (name === 'advance_release') {
        const next = steps.find((step) => !step.done);
        if (next) next.done = true;
      }
      if (
        name === 'release_checklist' ||
        name === 'advance_release' ||
        name === 'refresh_release_internal'
      )
        return result();
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    },
  };
}

/** The Sunsama fixture server: a read-only backlog source for the import flow. */
export const SUNSAMA_FIXTURE_SERVER: FixtureMcpServer = {
  serverInfo: { name: 'Sunsama', title: 'Sunsama' },
  tools: [
    {
      name: 'get_backlog_tasks',
      description: 'List the backlog tasks of the connected Sunsama account.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get_task_by_id',
      description: 'Fetch one Sunsama task by id.',
      inputSchema: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
      annotations: { readOnlyHint: true },
    },
  ],
  call(name, input) {
    if (name === 'get_backlog_tasks') {
      return { content: JSON.stringify(SUNSAMA_BACKLOG), isError: false };
    }
    if (name === 'get_task_by_id') {
      const id =
        input && typeof input === 'object' && 'taskId' in input
          ? String((input as Record<string, unknown>)['taskId'])
          : '';
      const task = SUNSAMA_BACKLOG.find((t) => t.id === id);
      return task
        ? { content: JSON.stringify(task), isError: false }
        : { content: `Task not found: ${id}`, isError: true };
    }
    return { content: `Unknown tool: ${name}`, isError: true };
  },
};

const FIXTURE_SERVERS: Readonly<Record<string, FixtureMcpServer>> = {
  'mcp.sunsama.com': SUNSAMA_FIXTURE_SERVER,
  'mcp.acme-release.example': createWidgetFixtureServer(),
};

/** Construction options for {@link MockMcpConnector}. */
export interface MockMcpConnectorOptions {
  /** Extra/override fixture servers keyed by host. */
  readonly servers?: Readonly<Record<string, FixtureMcpServer>> | undefined;
}

/** A mock remote-MCP connector serving deterministic fixture servers by host. */
export class MockMcpConnector implements McpConnector {
  private readonly servers: Readonly<Record<string, FixtureMcpServer>>;

  /**
   * @param options - Optional extra fixture servers.
   */
  constructor(options: MockMcpConnectorOptions = {}) {
    this.servers = { ...FIXTURE_SERVERS, ...options.servers };
  }

  /** {@inheritDoc McpConnector.open} */
  async open(endpoint: McpEndpoint): Promise<RemoteMcpSession> {
    let host: string;
    try {
      host = new URL(endpoint.url).host;
    } catch {
      throw new Error(`Invalid MCP endpoint URL: ${endpoint.url}`);
    }
    const server = this.servers[host];
    if (!server) throw new Error(`No MCP server reachable at ${endpoint.url}`);
    const listTools = async (): Promise<readonly RemoteToolDescriptor[]> => server.tools;
    return {
      serverInfo: () => server.serverInfo ?? { name: host },
      listTools,
      callTool: async (name, input, presentationContext) => {
        if (!presentationContext) return server.call(name, input);
        const raw = server.callRaw
          ? server.callRaw(name, input)
          : (() => {
              const flat = server.call(name, input);
              return {
                content: [{ type: 'text', text: flat.content }],
                isError: flat.isError,
              };
            })();
        const flattened = flatten(raw as CallToolResult);
        const tool = server.tools.find((candidate) => candidate.name === name);
        const resourceUri = tool?.ui?.resourceUri;
        const resource = resourceUri ? (server.uiResources?.[resourceUri] ?? null) : null;
        const presentation = tool
          ? normalizeMcpAppPresentation({
              context: presentationContext,
              tool,
              arguments: input ?? {},
              result: raw,
              resource,
            })
          : undefined;
        return {
          ...flattened,
          ...(presentation ? { presentation } : {}),
          ...(resourceUri && !presentation ? { presentationUnavailable: true } : {}),
        };
      },
      callToolRaw: async (name, input) =>
        server.callRaw
          ? server.callRaw(name, input)
          : { content: [{ type: 'text', text: server.call(name, input).content }] },
      readUiResource: async (uri) => server.uiResources?.[uri] ?? null,
      close: async () => undefined,
    };
  }
}

/** Flatten an MCP result's text blocks into one payload. */
export function flatten(result: CallToolResult): RemoteToolResult {
  const parts: string[] = [];
  for (const block of result.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return { content: parts.join('\n'), isError: result.isError === true };
}

/** A real remote-MCP connector backed by the MCP SDK's Streamable HTTP client. */
export class RealMcpConnector implements McpConnector {
  /** {@inheritDoc McpConnector.open} */
  /* v8 ignore start -- live network edge */
  async open(endpoint: McpEndpoint): Promise<RemoteMcpSession> {
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      fetch: mcpSafeFetch,
      ...(endpoint.bearerToken
        ? { requestInit: { headers: { authorization: `Bearer ${endpoint.bearerToken}` } } }
        : {}),
    });
    const client = new Client(
      { name: 'docket-athena', version: '1.0.0' },
      // Declaring the MCP Apps extension is what makes a server register its UI-enabled tools
      // rather than their text-only fallbacks.
      { capabilities: { extensions: { [MCP_UI_EXTENSION]: MCP_UI_CLIENT_CAPABILITY } } },
    );
    // The SDK's own `sessionId?: string` on `Transport` and `get sessionId(): string | undefined`
    // on `StreamableHTTPClientTransport` are incompatible under exactOptionalPropertyTypes; both
    // types come from the vendor package, so the mismatch is cast away here rather than by
    // touching SDK types.
    await client.connect(transport as Transport);
    const serverInfo = client.getServerVersion();
    let listedTools: readonly RemoteToolDescriptor[] | null = null;
    const listTools = async (): Promise<readonly RemoteToolDescriptor[]> => {
      if (listedTools) return listedTools;
      const listed = await client.listTools();
      listedTools = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema,
        ...uiMetaSpread(tool._meta),
        ...(tool.annotations
          ? {
              annotations: {
                ...(tool.annotations.readOnlyHint !== undefined
                  ? { readOnlyHint: tool.annotations.readOnlyHint }
                  : {}),
                ...(tool.annotations.destructiveHint !== undefined
                  ? { destructiveHint: tool.annotations.destructiveHint }
                  : {}),
                ...(tool.annotations.openWorldHint !== undefined
                  ? { openWorldHint: tool.annotations.openWorldHint }
                  : {}),
              },
            }
          : {}),
      }));
      return listedTools;
    };
    const readUiResource = async (uri: string): Promise<RemoteUiResource | null> => {
      const read = await client.readResource({ uri });
      for (const item of read.contents) {
        const text = decodeUiResourceHtml(item);
        if (text === null) continue;
        const mimeType = typeof item.mimeType === 'string' ? item.mimeType : '';
        const meta = readUiResourceMeta(item._meta);
        if (declaresUiResourceMeta(item._meta) && meta === null) continue;
        if (
          !isRenderableUiResource({
            uri: typeof item.uri === 'string' ? item.uri : uri,
            mimeType,
            text,
            ...(meta ? { meta } : {}),
          })
        )
          continue;
        return {
          uri: typeof item.uri === 'string' ? item.uri : uri,
          mimeType,
          text,
          ...(meta ? { meta } : {}),
        };
      }
      return null;
    };
    return {
      serverInfo: (): RemoteMcpServerInfo => ({
        name: serverInfo?.name ?? new URL(endpoint.url).hostname,
        ...(serverInfo?.title ? { title: serverInfo.title } : {}),
      }),
      listTools,
      callTool: async (name, input, presentationContext) => {
        const result = (await client.callTool({
          name,
          arguments: (input ?? {}) as Record<string, unknown>,
        })) as CallToolResult;
        const flattened = flatten(result);
        if (!presentationContext) return flattened;
        const tool = (await listTools()).find((candidate) => candidate.name === name);
        const resourceUri = tool?.ui?.resourceUri;
        const resource = resourceUri ? await readUiResource(resourceUri).catch(() => null) : null;
        const presentation = tool
          ? normalizeMcpAppPresentation({
              context: presentationContext,
              tool,
              arguments: input ?? {},
              result,
              resource,
            })
          : undefined;
        return {
          ...flattened,
          ...(presentation ? { presentation } : {}),
          ...(resourceUri && !presentation ? { presentationUnavailable: true } : {}),
        };
      },
      callToolRaw: async (name, input): Promise<Record<string, unknown>> =>
        await client.callTool({
          name,
          arguments: (input ?? {}) as Record<string, unknown>,
        }),
      readUiResource,
      close: async () => {
        await client.close();
      },
    };
  }
  /* v8 ignore stop */
}
