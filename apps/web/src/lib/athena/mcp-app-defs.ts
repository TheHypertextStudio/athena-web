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
  readonly prefersBorder?: boolean;
  readonly csp?: Readonly<Record<string, readonly string[]>>;
  readonly permissions?: Readonly<Record<string, Record<string, unknown>>>;
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
