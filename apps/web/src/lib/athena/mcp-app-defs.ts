import { api } from '@/lib/api';
import { apiQueryOptions, STALE } from '@/lib/query-core';

/**
 * Query and mutation definitions for Docket's MCP Apps host.
 *
 * @remarks
 * Everything the browser needs about a connected server goes through the API, because the
 * browser holds no credential for it. That is not a layering nicety: a widget's `tools/call` is
 * authorized server-side against the tool list of the connection the widget came from, and a
 * browser-held token would put that decision in the least trustworthy place in the system.
 */

/** One widget-bearing tool on one connected personal MCP server. */
export interface McpAppWidget {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly alias: string;
  readonly tool: string;
  readonly description: string;
  readonly resourceUri: string;
}

/** The `ui://` document a tool renders through, with the policy its server declared. */
export interface McpAppRenderResource {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
  readonly prefersBorder?: boolean | undefined;
  readonly csp?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly permissions?: Readonly<Record<string, Record<string, unknown>>> | undefined;
}

/** Everything needed to render one widget: the document, the result, and the input. */
export interface McpAppRender {
  readonly connectionId: string;
  readonly tool: string;
  readonly resource: McpAppRenderResource | null;
  readonly result: Readonly<Record<string, unknown>>;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** Query key namespace for the MCP Apps host. */
export const mcpAppKeys = {
  /** Every widget-bearing tool across the caller's connected servers. */
  widgets: (): readonly string[] => ['me', 'athena', 'mcp-apps', 'widgets'],
} as const;

/** Definition for `GET /v1/me/athena/mcp-apps/widgets`. */
export const mcpAppWidgetsDef = apiQueryOptions<readonly McpAppWidget[]>(
  mcpAppKeys.widgets(),
  () => api.v1.me.athena['mcp-apps'].widgets.$get(),
  'Connected tools are temporarily unavailable.',
  { staleTime: STALE.standard },
);

/**
 * Run a widget-bearing tool for the initial render of a card.
 *
 * @param input - The connection, tool, and arguments.
 * @returns the document, the result, and the arguments the view is told about.
 */
export async function renderMcpAppWidget(input: {
  readonly connectionId: string;
  readonly tool: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}): Promise<McpAppRender> {
  const response = await api.v1.me.athena['mcp-apps'].call.$post({ json: input });
  if (!response.ok) throw new Error('render-failed');
  return await response.json();
}

/**
 * Run a tool a rendered widget asked for.
 *
 * @remarks
 * A separate endpoint from {@link renderMcpAppWidget} on purpose: this one additionally enforces
 * the spec's `visibility` rule, so a tool its server marks model-only is refused when a view asks
 * for it even though the model may call it.
 *
 * @param input - The connection, tool, and arguments the widget supplied.
 * @returns the tool's `CallToolResult`.
 */
export async function callMcpAppViewTool(input: {
  readonly connectionId: string;
  readonly tool: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}): Promise<Readonly<Record<string, unknown>>> {
  const response = await api.v1.me.athena['mcp-apps']['view-call'].$post({ json: input });
  if (!response.ok) throw new Error('view-call-failed');
  const body = (await response.json()) as unknown as McpAppRender;
  return body.result;
}

/**
 * Append one entry to the caller's canonical Athena chat and drive a fresh turn over it.
 *
 * @remarks
 * The same endpoint the conversation's own composer uses (`POST /v1/me/athena/chat/messages`).
 * Reusing it — rather than inventing a widget-only ingress — is what makes "Athena responds to
 * it" true for free: this is the one call in the whole app that appends to the transcript AND
 * drives generation, so a widget-originated entry gets exactly the same treatment a typed one
 * does, with no second, less-tested code path to keep in sync.
 *
 * @param text - The content to append, attributed to the caller.
 * @returns whether the host accepted it.
 */
async function postToCanonicalChat(text: string): Promise<boolean> {
  const response = await api.v1.me.athena.chat.messages.$post({ json: { body: text } });
  return response.ok;
}

/**
 * Record a rendered widget's `ui/update-model-context` for the conversation's next turn.
 *
 * @remarks
 * The context is stored server-side on the activity row the card lives on — replacing any
 * previous update from the same card, per the extension's overwrite semantics — and reaches the
 * model on the thread's next turn, enveloped as app-authored text rather than the person's own.
 *
 * @param input - The card's connection and activity, plus the update's payload.
 * @returns whether the host retained the update.
 */
export async function postWidgetModelContext(input: {
  readonly connectionId: string;
  readonly activityId: string;
  readonly content?: readonly Record<string, unknown>[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
}): Promise<boolean> {
  const response = await api.v1.me.athena['mcp-apps']['model-context'].$post({
    json: {
      connectionId: input.connectionId,
      activityId: input.activityId,
      ...(input.content ? { content: [...input.content] } : {}),
      ...(input.structuredContent ? { structuredContent: input.structuredContent } : {}),
    },
  });
  return response.ok;
}

/**
 * Post a widget-composed `ui/message` into the Athena conversation.
 *
 * @remarks
 * The MCP Apps extension restricts `ui/message` to the `user` role — a widget is speaking AS the
 * user, not narrating to them — so the text is posted verbatim, exactly as if the person had typed
 * it into the composer themselves.
 *
 * @param text - The message content the widget composed.
 * @returns whether the host posted it and, if so, that Athena's reply can be expected shortly.
 */
export async function postWidgetMessage(text: string): Promise<boolean> {
  return postToCanonicalChat(text);
}
