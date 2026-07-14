/**
 * Remote MCP server connector contracts plus real and deterministic adapters.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { SUNSAMA_BACKLOG } from './fixtures';

/** A remote MCP endpoint plus its unsealed credential. */
export interface McpEndpoint {
  /** The server URL (Streamable HTTP). */
  readonly url: string;
  /** Bearer token sent on every request, when the server requires one. */
  readonly bearerToken?: string;
}

/** The gate-relevant annotation hints a remote tool may declare. */
export interface RemoteToolAnnotations {
  /** Whether the tool declares itself side-effect free. */
  readonly readOnlyHint?: boolean;
  /** Whether the tool declares destructive updates. */
  readonly destructiveHint?: boolean;
  /** Whether the tool reaches further external systems. */
  readonly openWorldHint?: boolean;
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
  readonly annotations?: RemoteToolAnnotations;
}

/** The serialized outcome of one remote tool call. */
export interface RemoteToolResult {
  /** The concatenated text content of the MCP result. */
  readonly content: string;
  /** Whether the tool reported failure. */
  readonly isError: boolean;
}

/** The human-facing identity an MCP server advertises during initialization. */
export interface RemoteMcpServerInfo {
  /** The server's product name. */
  readonly name: string;
  /** A more descriptive title when the server provides one. */
  readonly title?: string;
}

/** One open session against a remote MCP server. */
export interface RemoteMcpSession {
  /** Read the server identity captured during MCP initialization. */
  serverInfo(): RemoteMcpServerInfo;
  /** List the server's tools. */
  listTools(): Promise<readonly RemoteToolDescriptor[]>;
  /** Call one tool by its un-namespaced name. */
  callTool(name: string, input: unknown): Promise<RemoteToolResult>;
  /** Close the transport. */
  close(): Promise<void>;
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
  readonly serverInfo?: RemoteMcpServerInfo;
  /** The advertised tools. */
  readonly tools: readonly RemoteToolDescriptor[];
  /** Resolve one call by un-namespaced tool name. */
  call(name: string, input: unknown): RemoteToolResult;
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
};

/** Construction options for {@link MockMcpConnector}. */
export interface MockMcpConnectorOptions {
  /** Extra/override fixture servers keyed by host. */
  readonly servers?: Readonly<Record<string, FixtureMcpServer>>;
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
    return {
      serverInfo: () => server.serverInfo ?? { name: host },
      listTools: async () => server.tools,
      callTool: async (name, input) => server.call(name, input),
      close: async () => undefined,
    };
  }
}

/** Flatten an MCP result's text blocks into one payload. */
function flatten(result: CallToolResult): RemoteToolResult {
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
      ...(endpoint.bearerToken
        ? { requestInit: { headers: { authorization: `Bearer ${endpoint.bearerToken}` } } }
        : {}),
    });
    const client = new Client({ name: 'docket-athena', version: '1.0.0' });
    await client.connect(transport);
    const serverInfo = client.getServerVersion();
    return {
      serverInfo: (): RemoteMcpServerInfo => ({
        name: serverInfo?.name ?? new URL(endpoint.url).hostname,
        ...(serverInfo?.title ? { title: serverInfo.title } : {}),
      }),
      listTools: async (): Promise<readonly RemoteToolDescriptor[]> => {
        const listed = await client.listTools();
        return listed.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: tool.inputSchema,
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
      },
      callTool: async (name, input) => {
        const result = (await client.callTool({
          name,
          arguments: (input ?? {}) as Record<string, unknown>,
        })) as CallToolResult;
        return flatten(result);
      },
      close: async () => {
        await client.close();
      },
    };
  }
  /* v8 ignore stop */
}
