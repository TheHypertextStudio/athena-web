/**
 * `@docket/api` — the agent's toolbox: an in-process MCP client over the real server.
 *
 * @remarks
 * Athena eats through the front door. The toolbox connects an MCP SDK client over
 * `InMemoryTransport` to the SAME {@link buildServer} the `/mcp` endpoint serves —
 * one tool catalog, two transports, zero drift with third-party agents. The context
 * is the internal agent principal ({@link internalAgentContext}), so the scope layer
 * and the per-org grant cascade gate every call exactly as they would over HTTP.
 *
 * The toolbox also carries the loop-owned `ask_user` tool definition: elicitations are
 * a hosting-loop concern (persist an `elicitation` activity, pause the session), not a
 * Docket mutation, so the loop intercepts `ask_user` calls before dispatching here.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TurnToolDef } from '@docket/agent-runtime';

import { internalAgentContext } from '../mcp/internal-session';
import { buildServer } from '../mcp/server';
import type { ToolAnnotationHints } from './approval-policy';

/** The loop-owned elicitation tool name (never dispatched to the MCP server). */
export const ASK_USER_TOOL = 'ask_user';

/** The `ask_user` definition surfaced to the model alongside the Docket tools. */
export const ASK_USER_DEF: TurnToolDef = {
  name: ASK_USER_TOOL,
  description:
    'Ask the human principal ONE concise question and wait for their answer. Use this ' +
    'when you are blocked on a decision only they can make. The session pauses until ' +
    "they reply; their reply is returned as this tool call's result.",
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The single question to ask.' },
    },
    required: ['question'],
  },
};

/** The serialized outcome of one toolbox call. */
export interface ToolboxResult {
  /** The concatenated text content of the MCP result. */
  readonly content: string;
  /** Whether the tool reported failure (the model reacts instead of assuming success). */
  readonly isError: boolean;
}

/** One connected toolbox: cached defs + annotations and a call dispatcher. */
export interface Toolbox {
  /** The tool definitions to surface to the model (Docket tools + `ask_user`). */
  readonly tools: readonly TurnToolDef[];
  /** The declared annotations per tool name (the policy engine's classification input). */
  annotations(name: string): ToolAnnotationHints | undefined;
  /** Call a Docket tool as the agent principal. */
  callTool(name: string, input: unknown): Promise<ToolboxResult>;
  /** Close the in-process transport pair. */
  close(): Promise<void>;
}

/** Flatten an MCP result's content blocks into one text payload. */
function flattenContent(result: CallToolResult): string {
  const parts: string[] = [];
  for (const block of result.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Open a toolbox for one agent session run.
 *
 * @remarks
 * One linked in-memory transport pair per loop run (the `/mcp` server construction is
 * per-caller-identity, exactly like the HTTP path); close it in `finally`. `tools/list`
 * is fetched once and cached for the run — the same catalog+annotations any MCP client
 * sees.
 *
 * @param orgId - The organization the session runs in.
 * @param agentId - The agent registration to act as.
 * @returns the connected {@link Toolbox}.
 */
export async function openToolbox(orgId: string, agentId: string): Promise<Toolbox> {
  const ctx = await internalAgentContext(orgId, agentId);
  const server = buildServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'athena-loop', version: '1.0.0' });
  await client.connect(clientTransport);

  const listed = await client.listTools();
  const annotationsByName = new Map<string, ToolAnnotationHints>();
  const defs: TurnToolDef[] = [];
  for (const tool of listed.tools) {
    if (tool.annotations) {
      annotationsByName.set(tool.name, {
        ...(tool.annotations.readOnlyHint !== undefined
          ? { readOnlyHint: tool.annotations.readOnlyHint }
          : {}),
        ...(tool.annotations.destructiveHint !== undefined
          ? { destructiveHint: tool.annotations.destructiveHint }
          : {}),
        ...(tool.annotations.openWorldHint !== undefined
          ? { openWorldHint: tool.annotations.openWorldHint }
          : {}),
      });
    }
    defs.push({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema,
    });
  }
  defs.push(ASK_USER_DEF);

  return {
    tools: defs,
    annotations: (name) => annotationsByName.get(name),
    callTool: async (name, input) => {
      const result = (await client.callTool({
        name,
        arguments: (input ?? {}) as Record<string, unknown>,
      })) as CallToolResult;
      return { content: flattenContent(result), isError: result.isError === true };
    },
    close: async () => {
      await client.close();
    },
  };
}
