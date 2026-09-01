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
import type { TurnToolDef } from '@docket/athena/turn';
import {
  db,
  integration,
  integrationCredential,
  personalMcpConnection,
  personalMcpCredential,
} from '@docket/db';
import {
  mcpOAuthTokenNeedsRefresh,
  parseMcpOAuthCredential,
  refreshMcpOAuthCredential,
  isRemoteToolVisibleTo,
  type RemoteMcpSession,
} from '@docket/integrations';
import type { McpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import { and, eq } from 'drizzle-orm';

import { getContainer } from '../container';
import { sealCredential, unsealCredential } from '../lib/credentials';
import { internalAgentContext, internalUserContext } from '../mcp/internal-session';
import { buildServer } from '../mcp/server';
import type { ToolAnnotationHints, ToolAnnotationSource } from './approval-policy';

/** The toolbox connection key for Docket's own in-process tools. */
export const DOCKET_CONNECTION = 'docket';

/** The loop-owned elicitation tool name (never dispatched to the MCP server). */
export const ASK_USER_TOOL = 'ask_user';

/**
 * The `ask_user` definition surfaced to the model alongside the Docket tools.
 *
 * @remarks
 * The input is flat and JSON-Schema-describable because that is all a tool definition can carry;
 * `elicitationRequestFromToolInput` turns it into the recursive control spec the renderer and the
 * server-side validator share. Three fields are load-bearing rather than decorative:
 *
 * - `actionSummary` is required. An elicitation authorizes an action taken on someone's behalf, and
 *   a request that does not say what it will do is not consent.
 * - `responseType` is what makes the answer typed. Declaring `confirm` or `select` is also what
 *   lets the question be answered from a notification, since only a bounded option set fits on one.
 * - `timeoutPolicy` decides what a deadline may do. It defaults to `ambiguous`, which *parks* the
 *   work — a model that forgets to think about the timeout gets the safe behaviour, never a guess.
 */
export const ASK_USER_DEF: TurnToolDef = {
  name: ASK_USER_TOOL,
  description:
    'Ask the human principal for ONE piece of information you are blocked on, as typed, ' +
    'schema-validated data. Always state in `actionSummary` the concrete action their answer ' +
    'authorizes you to take on their behalf. Choose the narrowest `responseType` that fits: ' +
    'prefer `confirm` or `select` over `text`, because those can be answered from a notification. ' +
    "The session pauses until they answer; their answer is returned as this call's result. " +
    'Set `timeoutPolicy: "derivable"` and supply `autoResolveValue` + `autoResolveReason` ONLY ' +
    'when the context genuinely determines the answer and being wrong is recoverable; use ' +
    '"destructive" for anything that cannot be undone.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The single question to ask, in your own words.' },
      actionSummary: {
        type: 'string',
        description:
          'The concrete action this answer authorizes, as a sentence the person can audit — e.g. "Post the sprint update to the Acme project channel".',
      },
      responseType: {
        type: 'string',
        enum: ['text', 'confirm', 'select', 'datetime', 'file', 'form'],
        description: 'The shape of the answer you need.',
      },
      confirmLabel: { type: 'string', description: 'For `confirm`: the affirmative button label.' },
      declineLabel: { type: 'string', description: 'For `confirm`: the negative button label.' },
      options: {
        type: 'array',
        description: 'For `select`: the predefined options. Values are what you receive back.',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['value', 'label'],
        },
      },
      multiple: { type: 'boolean', description: 'For `select`/`file`: allow more than one.' },
      precision: {
        type: 'string',
        enum: ['date', 'time', 'datetime'],
        description: 'For `datetime`: how precise the answer must be.',
      },
      timeZone: { type: 'string', description: 'For `datetime`: the IANA zone to interpret in.' },
      accept: {
        type: 'array',
        items: { type: 'string' },
        description: 'For `file`: accepted MIME types. Omit to accept anything.',
      },
      fields: {
        type: 'array',
        description: 'For `form`: one entry per field.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
            required: { type: 'boolean' },
            type: {
              type: 'string',
              enum: ['text', 'confirm', 'select', 'datetime', 'file'],
            },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: { value: { type: 'string' }, label: { type: 'string' } },
                required: ['value', 'label'],
              },
            },
          },
          required: ['key', 'label', 'type'],
        },
      },
      timeoutPolicy: {
        type: 'string',
        enum: ['derivable', 'ambiguous', 'destructive'],
        description:
          'What may happen when nobody answers in time. `derivable` lets you record your own answer; the other two park the work and tell them.',
      },
      autoResolveValue: {
        description:
          'Required with `derivable`: the answer you would record, in the shape `responseType` declares.',
      },
      autoResolveReason: {
        type: 'string',
        description: 'Required with `derivable`: why that answer is defensible. Shown to them.',
      },
      timeSensitive: {
        type: 'boolean',
        description: 'True when waiting has a cost; sends them an actionable notification.',
      },
    },
    required: ['question', 'actionSummary', 'responseType'],
  },
};

/** The serialized outcome of one toolbox call. */
export interface ToolboxResult {
  /** The concatenated text content of the MCP result. */
  readonly content: string;
  /** Whether the tool reported failure (the model reacts instead of assuming success). */
  readonly isError: boolean;
  /** A durable interactive presentation captured during this original remote call. */
  readonly presentation?: McpAppPresentation | undefined;
  /** A declared app could not be retained safely and should show the owned fallback. */
  readonly presentationUnavailable?: boolean | undefined;
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
  /**
   * Who authored a tool's annotations — Docket, or the remote server that serves the tool.
   *
   * @remarks
   * The gate needs this because it must not let a remote server's self-declared `readOnlyHint`
   * decide whether that same server's tool runs unreviewed. First-party means Docket's own
   * `tools/list` plus the loop-owned `ask_user`, matching what {@link Toolbox.resolve} treats as
   * Docket. An unknown name reports `remote` — the one place the two deliberately differ, since
   * an unregistered name has no annotation worth trusting even though `resolve` still has to send
   * it somewhere.
   */
  annotationSource(name: string): ToolAnnotationSource;
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
  const remoteSessions = new Map<
    string,
    { readonly id: string; readonly name: string; readonly session: RemoteMcpSession }
  >();
  const remoteRows: {
    readonly id: string;
    readonly url: string;
    readonly alias: string;
    readonly name: string;
  }[] =
    executor.kind === 'registered_agent'
      ? (
          await db
            .select({ id: integration.id, config: integration.config })
            .from(integration)
            .where(
              and(
                eq(integration.organizationId, executor.organizationId),
                eq(integration.provider, 'mcp'),
                eq(integration.status, 'connected'),
              ),
            )
        ).map((row) => {
          const config = row.config as unknown as { readonly url: string; readonly alias: string };
          return { id: row.id, url: config.url, alias: config.alias, name: config.alias };
        })
      : await db
          .select({
            id: personalMcpConnection.id,
            url: personalMcpConnection.url,
            alias: personalMcpConnection.alias,
            name: personalMcpConnection.name,
          })
          .from(personalMcpConnection)
          .where(
            and(
              eq(personalMcpConnection.ownerUserId, executor.ownerUserId),
              eq(personalMcpConnection.status, 'connected'),
            ),
          );
  for (const row of remoteRows) {
    const credRows =
      executor.kind === 'registered_agent'
        ? await db
            .select({ ciphertext: integrationCredential.ciphertext })
            .from(integrationCredential)
            .where(eq(integrationCredential.integrationId, row.id))
            .limit(1)
        : await db
            .select({ ciphertext: personalMcpCredential.ciphertext })
            .from(personalMcpCredential)
            .where(
              and(
                eq(personalMcpCredential.connectionId, row.id),
                eq(personalMcpCredential.ownerUserId, executor.ownerUserId),
              ),
            )
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
        if (executor.kind === 'registered_agent') {
          await db
            .update(integrationCredential)
            .set({ ciphertext: sealCredential(JSON.stringify(refreshed)) })
            .where(eq(integrationCredential.integrationId, row.id));
        } else {
          await db
            .update(personalMcpCredential)
            .set({ ciphertext: sealCredential(JSON.stringify(refreshed)) })
            .where(
              and(
                eq(personalMcpCredential.connectionId, row.id),
                eq(personalMcpCredential.ownerUserId, executor.ownerUserId),
              ),
            );
        }
        bearerToken = refreshed.tokens.access_token;
      }
      const session = await getContainer().mcpConnector.open({
        url: row.url,
        ...(bearerToken ? { bearerToken } : {}),
      });
      const tools = await session.listTools();
      remoteSessions.set(row.alias, { id: row.id, name: row.name, session });
      for (const tool of tools) {
        if (!isRemoteToolVisibleTo(tool, 'model')) continue;
        const namespaced = `${row.alias}__${tool.name}`;
        if (tool.annotations) annotationsByName.set(namespaced, tool.annotations);
        defs.push({
          name: namespaced,
          description: `[${row.alias}] ${tool.description}`,
          inputSchema: tool.inputSchema,
        });
      }
    } catch (cause) {
      const patch = {
        status: 'error' as const,
        lastError: cause instanceof Error ? cause.message : 'Connection failed',
        lastErrorAt: new Date(),
      };
      if (executor.kind === 'registered_agent') {
        await db.update(integration).set(patch).where(eq(integration.id, row.id));
      } else {
        await db
          .update(personalMcpConnection)
          .set(patch)
          .where(
            and(
              eq(personalMcpConnection.id, row.id),
              eq(personalMcpConnection.ownerUserId, executor.ownerUserId),
            ),
          );
      }
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
    // Deliberately the same test `resolve` applies, because the two must agree on what "Docket's
    // own" means: `ask_user` is loop-owned and appended straight to `defs`, so it is never in
    // `docketNames` and would otherwise be classified as though a remote server had described it.
    // An unknown name still reports `remote`, which differs from `resolve` sending it to Docket —
    // that asymmetry is intentional. `resolve` picks a destination and Docket answers with a clear
    // tool-not-found; this picks how much to trust a claim, and a name nobody registered has no
    // claim worth trusting.
    annotationSource: (name) =>
      docketNames.has(name) || name === ASK_USER_TOOL ? 'first_party' : 'remote',
    resolve,
    callTool: async (name, input) => {
      const target = resolve(name);
      if (target.connection !== DOCKET_CONNECTION) {
        const remote = remoteSessions.get(target.connection);
        /* v8 ignore next -- @preserve defensive: resolve only names live connections */
        if (!remote) return { content: `Unknown connection: ${target.connection}`, isError: true };
        return remote.session.callTool(
          target.rawName,
          input,
          executor.kind === 'athena'
            ? { connectionId: remote.id, serverName: remote.name }
            : undefined,
        );
      }
      const result = (await client.callTool({
        name: target.rawName,
        arguments: (input ?? {}) as Record<string, unknown>,
      })) as CallToolResult;
      return { content: flattenContent(result), isError: result.isError === true };
    },
    close: async () => {
      await client.close();
      for (const remote of remoteSessions.values()) {
        await remote.session.close();
      }
    },
  };
}
