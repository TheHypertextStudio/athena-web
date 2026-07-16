/**
 * `@docket/api` — the agent's toolbox: an in-process MCP client over the real server.
 *
 * @remarks
 * Athena eats through the front door. The toolbox connects an MCP SDK client over
 * `InMemoryTransport` to the SAME {@link buildServer} the `/mcp` endpoint serves —
 * one tool catalog, two transports, zero drift with third-party agents. The context
 * is selected from the persisted session executor. Athena uses a user principal and
 * therefore resolves the owner's current human Actor and grants on every Docket call;
 * registered agents retain their org-scoped principal and grant path.
 *
 * The toolbox also carries the loop-owned `ask_user` tool definition: elicitations are
 * a hosting-loop concern (persist an `elicitation` activity, pause the session), not a
 * Docket mutation, so the loop intercepts `ask_user` calls before dispatching here.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TurnToolDef } from '@docket/agent-runtime';
import { db, integration, integrationCredential } from '@docket/db';
import {
  mcpOAuthTokenNeedsRefresh,
  parseMcpOAuthCredential,
  refreshMcpOAuthCredential,
  type RemoteMcpSession,
} from '@docket/integrations';
import { and, eq } from 'drizzle-orm';

import { getContainer } from '../container';
import { sealCredential, unsealCredential } from '../lib/credentials';
import { internalAgentContext, internalUserContext } from '../mcp/internal-session';
import { buildServer } from '../mcp/server';
import type { ToolAnnotationHints } from './approval-policy';

/** The toolbox connection key for Docket's own in-process tools. */
export const DOCKET_CONNECTION = 'docket';

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

/** Where one model-facing tool name routes: a connection key + the raw name there. */
export interface ResolvedTool {
  /** `docket`, or a remote integration's alias. */
  readonly connection: string;
  /** The un-namespaced name on that connection. */
  readonly rawName: string;
}

/** One connected toolbox: cached defs + annotations and a call dispatcher. */
export interface Toolbox {
  /** The tool definitions surfaced to the model (Docket + remote, + `ask_user`). */
  readonly tools: readonly TurnToolDef[];
  /** The declared annotations per model-facing tool name (the policy classifier input). */
  annotations(name: string): ToolAnnotationHints | undefined;
  /** Where a model-facing tool name routes (`docket` or a remote alias). */
  resolve(name: string): ResolvedTool;
  /** Call a tool by its model-facing (possibly namespaced) name. */
  callTool(name: string, input: unknown): Promise<ToolboxResult>;
  /** Close every underlying transport. */
  close(): Promise<void>;
}

/** The persisted executor identity used to open one loop toolbox. */
export type ToolboxExecutor =
  | {
      /** User-owned Athena; no workspace identity is provisioned. */
      readonly kind: 'athena';
      /** Better Auth user id persisted on the session. */
      readonly ownerUserId: string;
    }
  | {
      /** A separately registered, workspace-owned agent. */
      readonly kind: 'registered_agent';
      /** The agent's owning workspace. */
      readonly organizationId: string;
      /** The registered agent row id. */
      readonly agentId: string;
    };

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
 * @param executor - The persisted Athena owner or registered-agent identity.
 * @returns the connected {@link Toolbox}.
 */
export async function openToolbox(executor: ToolboxExecutor): Promise<Toolbox> {
  const ctx =
    executor.kind === 'athena'
      ? await internalUserContext(executor.ownerUserId)
      : await internalAgentContext(executor.organizationId, executor.agentId);
  const server = buildServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'athena-loop', version: '1.0.0' });
  await client.connect(clientTransport);

  const listed = await client.listTools();
  const annotationsByName = new Map<string, ToolAnnotationHints>();
  const defs: TurnToolDef[] = [];
  const docketNames = new Set<string>();
  for (const tool of listed.tools) {
    docketNames.add(tool.name);
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

  // ── Remote connections: every connected org MCP integration joins the union, its
  // tools namespaced `<alias>__<name>` (an alias can't contain `__`, so namespaced
  // names never collide with Docket's). A server that fails to open is demoted to
  // `error` on its row — never silently skipped as if healthy.
  const remoteSessions = new Map<string, RemoteMcpSession>();
  const remoteRows =
    executor.kind === 'registered_agent'
      ? await db
          .select()
          .from(integration)
          .where(
            and(
              eq(integration.organizationId, executor.organizationId),
              eq(integration.provider, 'mcp'),
              eq(integration.status, 'connected'),
            ),
          )
      : [];
  for (const row of remoteRows) {
    const config = row.config as unknown as { url: string; alias: string };
    const credRows = await db
      .select({ ciphertext: integrationCredential.ciphertext })
      .from(integrationCredential)
      .where(eq(integrationCredential.integrationId, row.id))
      .limit(1);
    try {
      const storedCredential = credRows[0] ? unsealCredential(credRows[0].ciphertext) : undefined;
      const oauthCredential = storedCredential ? parseMcpOAuthCredential(storedCredential) : null;
      let bearerToken =
        oauthCredential?.kind === 'mcp_oauth'
          ? oauthCredential.tokens.access_token
          : oauthCredential
            ? undefined
            : storedCredential;
      if (oauthCredential?.kind === 'mcp_oauth' && mcpOAuthTokenNeedsRefresh(oauthCredential)) {
        const refreshed = await refreshMcpOAuthCredential(oauthCredential);
        await db
          .update(integrationCredential)
          .set({ ciphertext: sealCredential(JSON.stringify(refreshed)) })
          .where(eq(integrationCredential.integrationId, row.id));
        bearerToken = refreshed.tokens.access_token;
      }
      const session = await getContainer().mcpConnector.open({
        url: config.url,
        ...(bearerToken ? { bearerToken } : {}),
      });
      const tools = await session.listTools();
      remoteSessions.set(config.alias, session);
      for (const tool of tools) {
        const namespaced = `${config.alias}__${tool.name}`;
        if (tool.annotations) annotationsByName.set(namespaced, tool.annotations);
        defs.push({
          name: namespaced,
          description: `[${config.alias}] ${tool.description}`,
          inputSchema: tool.inputSchema,
        });
      }
    } catch (cause) {
      await db
        .update(integration)
        .set({
          status: 'error',
          lastError: cause instanceof Error ? cause.message : 'Connection failed',
          lastErrorAt: new Date(),
        })
        .where(eq(integration.id, row.id));
    }
  }

  defs.push(ASK_USER_DEF);

  const resolve = (name: string): ResolvedTool => {
    if (docketNames.has(name) || name === ASK_USER_TOOL) {
      return { connection: DOCKET_CONNECTION, rawName: name };
    }
    const sep = name.indexOf('__');
    if (sep > 0) {
      const alias = name.slice(0, sep);
      if (remoteSessions.has(alias)) {
        return { connection: alias, rawName: name.slice(sep + 2) };
      }
    }
    // Unknown names route to Docket, whose server answers with a clear tool-not-found
    // error the model can react to.
    return { connection: DOCKET_CONNECTION, rawName: name };
  };

  return {
    tools: defs,
    annotations: (name) => annotationsByName.get(name),
    resolve,
    callTool: async (name, input) => {
      const target = resolve(name);
      if (target.connection !== DOCKET_CONNECTION) {
        const session = remoteSessions.get(target.connection);
        /* v8 ignore next -- @preserve defensive: resolve only names live connections */
        if (!session) return { content: `Unknown connection: ${target.connection}`, isError: true };
        return session.callTool(target.rawName, input);
      }
      const result = (await client.callTool({
        name: target.rawName,
        arguments: (input ?? {}) as Record<string, unknown>,
      })) as CallToolResult;
      return { content: flattenContent(result), isError: result.isError === true };
    },
    close: async () => {
      await client.close();
      for (const session of remoteSessions.values()) {
        await session.close();
      }
    },
  };
}
