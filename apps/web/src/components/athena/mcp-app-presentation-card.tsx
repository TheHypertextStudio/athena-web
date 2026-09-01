'use client';

import type { JSX } from 'react';
import type { McpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import type { McpAppResource } from '@docket/integrations/mcp-apps';

import { McpAppView } from '@/components/athena/mcp-app-view';
import { callMcpAppViewTool, postWidgetModelContext } from '@/lib/athena/mcp-app-defs';

/** Props for {@link McpAppPresentationCard}. */
export interface McpAppPresentationCardProps {
  /** The durable presentation persisted with the tool result. */
  readonly presentation: McpAppPresentation;
  /** The activity the presentation belongs to, for a stable per-card view identity. */
  readonly activityId: string;
  /**
   * Where a widget-composed `ui/message` lands.
   *
   * @remarks
   * A prop rather than a fixed sink because the card renders on more than one thread: the
   * personal workbench posts to the canonical personal chat, while the org conversation posts
   * into its own org thread. The widget speaks AS the user either way — into whichever
   * conversation the person is actually looking at.
   */
  readonly onMessage?: (text: string) => Promise<boolean> | boolean;
}

/** Rebuild the view's resource shape from the persisted snapshot, dropping absent meta fields. */
function snapshotResource(presentation: McpAppPresentation): McpAppResource {
  const meta = presentation.resource.meta;
  return {
    uri: presentation.resource.uri,
    mimeType: presentation.resource.mimeType,
    text: presentation.resource.text,
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

/**
 * One persisted MCP app card: the {@link McpAppView} sandbox mounted over a stored
 * {@link McpAppPresentation}, with widget tool calls brokered through the API.
 *
 * @remarks
 * The single mounting point for durable cards, shared by every transcript surface (the workbench
 * work-log and the chat thread) so the snapshot→view translation and the brokered `onCallTool`
 * wiring exist exactly once.
 */
export function McpAppPresentationCard({
  presentation,
  activityId,
  onMessage,
}: McpAppPresentationCardProps): JSX.Element {
  return (
    <McpAppView
      instanceId={`${presentation.connectionId}:${activityId}`}
      resource={snapshotResource(presentation)}
      tool={{ name: presentation.tool, arguments: presentation.arguments }}
      result={presentation.result}
      serverName={presentation.serverName}
      onCallTool={(tool, args) =>
        callMcpAppViewTool({
          connectionId: presentation.connectionId,
          tool,
          arguments: args,
        })
      }
      onUpdateModelContext={(params) =>
        postWidgetModelContext({
          connectionId: presentation.connectionId,
          activityId,
          ...(params.content ? { content: params.content } : {}),
          ...(params.structuredContent ? { structuredContent: params.structuredContent } : {}),
        })
      }
      {...(onMessage ? { onMessage } : {})}
    />
  );
}
