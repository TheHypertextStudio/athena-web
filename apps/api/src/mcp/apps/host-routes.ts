/**
 * `@docket/api` — the server half of Docket's MCP Apps **host**.
 *
 * @remarks
 * A widget is HTML that a connected MCP server owns. For Athena to render one, the browser needs
 * three things it cannot get for itself, because the remote server's credential never leaves this
 * process:
 *
 * 1. which connected servers offer widgets, and for which tools;
 * 2. the `ui://` document behind a tool, fetched with that server's credential;
 * 3. a way to run a tool the widget asks for — under the same authorization the conversation has,
 *    never wider.
 *
 * (3) is the security-critical one and is why these routes exist rather than a generic proxy. A
 * widget-initiated `tools/call` is checked against the tool list of the connection the widget
 * came from: a widget cannot reach a tool on a different connection, and cannot reach a tool its
 * own server does not advertise. Both refusals are explicit errors, never a quiet empty result.
 *
 * Personal connections only. These are owner-scoped by the authenticated Better Auth user and no
 * workspace participates in the decision, exactly as the rest of `/v1/me/athena` works.
 */
import {
  agentSession,
  db,
  personalMcpConnection,
  personalMcpCredential,
  sessionActivity,
} from '@docket/db';
import {
  isRenderableUiResource,
  isRemoteToolVisibleTo,
  parseMcpOAuthCredential,
  type RemoteMcpSession,
  type RemoteToolDescriptor,
  type RemoteUiResource,
} from '@docket/integrations';
import { MCP_UI_MIME_TYPE, parseMcpAppModelContext } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../context';
import { getContainer } from '../../container';
import { AuthError, ApiError, NotFoundError } from '../../error';
import { unsealCredential } from '../../lib/credentials';
import { ok } from '../../lib/ok';
import { apiDoc } from '../../lib/openapi-route';
import { zJson } from '../../lib/validate';

/** One widget-bearing tool on one connected server. */
export const McpAppWidgetOut = z.object({
  connectionId: z.string().describe('The personal MCP connection the tool belongs to.'),
  connectionName: z.string().describe('The visible name of the connected server.'),
  alias: z.string().describe('The namespace prefix Athena calls this server’s tools under.'),
  tool: z.string().describe('The tool name on that server, un-namespaced.'),
  description: z.string().describe('What the tool does.'),
  resourceUri: z.string().describe('The `ui://` document the tool renders its result through.'),
});

/** The rendered form of a widget-bearing tool call. */
export const McpAppRenderOut = z.object({
  connectionId: z.string(),
  tool: z.string(),
  resource: z
    .object({
      uri: z.string(),
      mimeType: z.string(),
      text: z.string().describe('The widget document, exactly as its server served it.'),
      prefersBorder: z.boolean().optional(),
      csp: z.record(z.string(), z.array(z.string())).optional(),
      permissions: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    })
    .describe('The `ui://` document to render, or absent when the tool declares none.')
    .nullable(),
  result: z
    .record(z.string(), z.unknown())
    .describe(
      'The tool’s `CallToolResult`, delivered to the view as `ui/notifications/tool-result`.',
    ),
  arguments: z
    .record(z.string(), z.unknown())
    .describe(
      'The arguments the tool was called with, delivered as `ui/notifications/tool-input`.',
    ),
});

const callInput = z.object({
  connectionId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

const modelContextInput = z.object({
  connectionId: z.string().min(1),
  activityId: z.string().min(1),
  content: z.array(z.record(z.string(), z.unknown())).optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
});

/** Acknowledgement that a context update was retained. */
export const McpAppModelContextOut = z.object({
  retained: z.literal(true).describe('The update replaced any previous context for this card.'),
});

/** Return the authenticated owner or fail closed. */
function requestOwner(c: { get(key: 'session'): AppEnv['Variables']['session'] }): string {
  const owner = c.get('session')?.user.id;
  if (!owner) throw new AuthError();
  return owner;
}

/** A connected personal MCP row plus its unsealed bearer token, when it has one. */
interface OpenableConnection {
  readonly id: string;
  readonly name: string;
  readonly alias: string;
  readonly url: string;
  readonly bearerToken?: string;
}

/** Load a connected personal MCP connection owned by `ownerUserId`. */
async function loadConnection(
  ownerUserId: string,
  connectionId: string,
): Promise<OpenableConnection> {
  const [row] = await db
    .select()
    .from(personalMcpConnection)
    .where(
      and(
        eq(personalMcpConnection.id, connectionId),
        eq(personalMcpConnection.ownerUserId, ownerUserId),
        eq(personalMcpConnection.status, 'connected'),
      ),
    )
    .limit(1);
  // A miss, not a denial: another user's connection id must not be confirmable.
  if (!row) throw new NotFoundError('Connection not found');
  const [credential] = await db
    .select({ ciphertext: personalMcpCredential.ciphertext })
    .from(personalMcpCredential)
    .where(
      and(
        eq(personalMcpCredential.connectionId, row.id),
        eq(personalMcpCredential.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  const stored = credential ? unsealCredential(credential.ciphertext) : undefined;
  const oauth = stored ? parseMcpOAuthCredential(stored) : null;
  const bearerToken =
    oauth?.kind === 'mcp_oauth' ? oauth.tokens.access_token : oauth ? undefined : stored;
  return {
    id: row.id,
    name: row.name,
    alias: row.alias,
    url: row.url,
    ...(bearerToken ? { bearerToken } : {}),
  };
}

/** Open a session, run `body`, and always close the transport. */
async function withSession<T>(
  connection: OpenableConnection,
  body: (session: RemoteMcpSession) => Promise<T>,
): Promise<T> {
  const session = await getContainer().mcpConnector.open({
    url: connection.url,
    ...(connection.bearerToken ? { bearerToken: connection.bearerToken } : {}),
  });
  try {
    return await body(session);
  } finally {
    await session.close();
  }
}

/**
 * Whether `tool` may be invoked from a view rendered by this connection.
 *
 * @remarks
 * The spec's visibility rule: a tool whose `_meta.ui.visibility` excludes `"app"` is callable by
 * the model but NOT by an embedded view. Absent visibility means both, per the spec's stated
 * default. This is the scope check a widget's `tools/call` is measured against.
 *
 * @param tool - The tool as the remote server advertised it.
 * @returns `true` when an embedded view may call it.
 */
export function isAppCallableTool(tool: RemoteToolDescriptor): boolean {
  return isRemoteToolVisibleTo(tool, 'app');
}

/** Whether a remote tool may appear in model-facing and manual-launch catalogs. */
export function isModelCallableTool(tool: RemoteToolDescriptor): boolean {
  return isRemoteToolVisibleTo(tool, 'model');
}

/** Serialize a UI resource for the browser host. */
function toResourceOut(
  resource: RemoteUiResource | null,
): z.input<typeof McpAppRenderOut>['resource'] {
  if (!resource || !isRenderableUiResource(resource)) {
    return null;
  }
  const csp = resource.meta?.csp;
  return {
    uri: resource.uri,
    mimeType: resource.mimeType,
    text: resource.text,
    ...(resource.meta?.prefersBorder === undefined
      ? {}
      : { prefersBorder: resource.meta.prefersBorder }),
    ...(csp
      ? {
          csp: {
            ...(csp.connectDomains ? { connectDomains: [...csp.connectDomains] } : {}),
            ...(csp.resourceDomains ? { resourceDomains: [...csp.resourceDomains] } : {}),
            ...(csp.frameDomains ? { frameDomains: [...csp.frameDomains] } : {}),
            ...(csp.baseUriDomains ? { baseUriDomains: [...csp.baseUriDomains] } : {}),
          },
        }
      : {}),
    ...(resource.meta?.permissions
      ? { permissions: resource.meta.permissions as Record<string, Record<string, unknown>> }
      : {}),
  };
}

/**
 * Run one tool on one connection and return everything a view needs to render it.
 *
 * @remarks
 * Shared by the two call routes so the model-initiated path and the widget-initiated path can
 * never diverge in what they authorize or what they return.
 *
 * @param ownerUserId - The authenticated owner.
 * @param connectionId - The personal connection to run against.
 * @param tool - The un-namespaced tool name.
 * @param args - The tool arguments.
 * @param requireAppVisible - Whether to enforce the view-callable visibility rule.
 * @returns the render payload.
 */
export async function runWidgetTool(
  ownerUserId: string,
  connectionId: string,
  tool: string,
  args: Record<string, unknown>,
  requireAppVisible: boolean,
): Promise<z.input<typeof McpAppRenderOut>> {
  const connection = await loadConnection(ownerUserId, connectionId);
  return withSession(connection, async (session) => {
    const tools = await session.listTools();
    const descriptor = tools.find((candidate) => candidate.name === tool);
    // Refusals are named. A widget must be able to tell "this server does not offer that" from
    // "the host would not let me", and an operator reading a log must be able to tell too.
    if (!descriptor) {
      throw new ApiError(
        404,
        'not_found',
        `${connection.name} does not offer a tool named ${tool}`,
      );
    }
    if (requireAppVisible && !isAppCallableTool(descriptor)) {
      throw new ApiError(
        403,
        'forbidden',
        `${tool} is not callable from an embedded view on ${connection.name}`,
      );
    }
    if (!requireAppVisible && !isModelCallableTool(descriptor)) {
      throw new ApiError(
        403,
        'forbidden',
        `${tool} is not available in the Connected Tools launcher on ${connection.name}`,
      );
    }
    const result = session.callToolRaw
      ? await session.callToolRaw(tool, args)
      : {
          content: [{ type: 'text', text: (await session.callTool(tool, args)).content }],
        };
    const resourceUri = descriptor.ui?.resourceUri;
    const resource =
      resourceUri && session.readUiResource
        ? await session.readUiResource(resourceUri).catch(() => null)
        : null;
    return {
      connectionId: connection.id,
      tool,
      resource: toResourceOut(resource),
      result,
      arguments: args,
    };
  });
}

/**
 * Retain one rendered card's `ui/update-model-context` for the conversation's next turn.
 *
 * @remarks
 * The same ownership ladder as a widget tool call, then the payload bounds: the connection must
 * be the caller's own (a miss, not a denial), the activity must be a card that exact connection
 * produced in a session the caller owns, and the payload must survive
 * {@link parseMcpAppModelContext}'s text-only, credential-scanned, size-capped normalization.
 * Each retention overwrites the card's previous context, per the extension.
 *
 * @param ownerUserId - The authenticated owner.
 * @param connectionId - The personal connection the card came from.
 * @param activityId - The activity row the card is persisted on.
 * @param params - The raw `ui/update-model-context` params.
 * @throws {NotFoundError} When the card cannot be located under this owner and connection.
 * @throws {ApiError} When the payload cannot be safely retained.
 */
export async function retainWidgetModelContext(
  ownerUserId: string,
  connectionId: string,
  activityId: string,
  params: { content?: Record<string, unknown>[]; structuredContent?: Record<string, unknown> },
): Promise<void> {
  await loadConnection(ownerUserId, connectionId);
  const context = parseMcpAppModelContext(params);
  if (!context) {
    throw new ApiError(422, 'validation_error', 'The context update could not be safely retained.');
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ activity: sessionActivity, ownerUserId: agentSession.ownerUserId })
      .from(sessionActivity)
      .innerJoin(agentSession, eq(sessionActivity.sessionId, agentSession.id))
      .where(eq(sessionActivity.id, activityId))
      .limit(1);
    if (row?.ownerUserId !== ownerUserId) {
      throw new NotFoundError('Widget instance not found');
    }
    const action = row.activity.body.action;
    const result = action?.result;
    if (!action || result?.presentation?.connectionId !== connectionId) {
      throw new NotFoundError('Widget instance not found');
    }
    await tx
      .update(sessionActivity)
      .set({
        body: {
          ...row.activity.body,
          action: {
            ...action,
            result: { ...result, modelContext: context, modelContextDelivered: false },
          },
        },
      })
      .where(eq(sessionActivity.id, row.activity.id));
  });
}

/**
 * The MCP Apps host routes, mounted under `/v1/me/athena/mcp-apps`.
 */
const mcpAppHostRoutes = new Hono<AppEnv>()
  .get(
    '/widgets',
    apiDoc({
      tag: 'Athena',
      summary: 'List widget-bearing tools on connected servers',
      response: z.array(McpAppWidgetOut),
      description:
        'Enumerate the tools of every connected personal MCP server that declare a `ui://` resource, so the conversation can offer them without the browser holding any server credential.',
    }),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const rows = await db
        .select()
        .from(personalMcpConnection)
        .where(
          and(
            eq(personalMcpConnection.ownerUserId, ownerUserId),
            eq(personalMcpConnection.status, 'connected'),
          ),
        )
        .orderBy(asc(personalMcpConnection.createdAt));

      const widgets: z.input<typeof McpAppWidgetOut>[] = [];
      for (const row of rows) {
        const connection = await loadConnection(ownerUserId, row.id);
        try {
          const tools = await withSession(connection, (session) => session.listTools());
          for (const tool of tools) {
            if (!isModelCallableTool(tool)) continue;
            const resourceUri = tool.ui?.resourceUri;
            if (!resourceUri) continue;
            widgets.push({
              connectionId: row.id,
              connectionName: row.name,
              alias: row.alias,
              tool: tool.name,
              description: tool.description,
              resourceUri,
            });
          }
          // A server that will not open is skipped rather than failing the whole list — one
          // unreachable connection must not hide the widgets of every other one. The connection
          // row keeps its own status, which is where that failure is already surfaced.
        } catch {
          continue;
        }
      }
      return ok(c, z.array(McpAppWidgetOut), widgets);
    },
  )
  .post(
    '/call',
    apiDoc({
      tag: 'Athena',
      summary: 'Run a widget-bearing tool',
      response: McpAppRenderOut,
      description:
        'Run one tool on one connected personal MCP server and return its result together with the `ui://` document it renders through, if any. Used for the initial render of a card in the conversation.',
    }),
    zJson(callInput),
    async (c) => {
      const body = c.req.valid('json');
      return ok(
        c,
        McpAppRenderOut,
        await runWidgetTool(
          requestOwner(c),
          body.connectionId,
          body.tool,
          body.arguments ?? {},
          false,
        ),
      );
    },
  )
  .post(
    '/view-call',
    apiDoc({
      tag: 'Athena',
      summary: 'Run a tool on behalf of an embedded view',
      response: McpAppRenderOut,
      description:
        'Execute a `tools/call` that a rendered widget issued through the host bridge. Scoped to the connection the widget came from and refused for tools that server does not advertise or does not make view-callable.',
    }),
    zJson(callInput),
    async (c) => {
      const body = c.req.valid('json');
      return ok(
        c,
        McpAppRenderOut,
        await runWidgetTool(
          requestOwner(c),
          body.connectionId,
          body.tool,
          body.arguments ?? {},
          true,
        ),
      );
    },
  )
  .post(
    '/model-context',
    apiDoc({
      tag: 'Athena',
      summary: 'Record a rendered widget’s context for future turns',
      response: McpAppModelContextOut,
      description:
        'Store the `ui/update-model-context` a rendered widget posted, replacing any previous context for that card. The stored context reaches the conversation on its next turn, attributed to the app rather than the person.',
    }),
    zJson(modelContextInput),
    async (c) => {
      const body = c.req.valid('json');
      await retainWidgetModelContext(requestOwner(c), body.connectionId, body.activityId, {
        ...(body.content ? { content: body.content } : {}),
        ...(body.structuredContent ? { structuredContent: body.structuredContent } : {}),
      });
      return ok(c, McpAppModelContextOut, { retained: true });
    },
  );

export default mcpAppHostRoutes;

/** The mimeType every widget document must carry, re-exported for the route tests. */
export { MCP_UI_MIME_TYPE };
