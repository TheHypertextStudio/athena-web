'use client';

import { useSyncExternalStore, type JSX } from 'react';
import { Button, Surface, Text } from '@docket/ui/primitives';
import type { McpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import type { McpAppResource } from '@docket/integrations/mcp-apps';

import { usePublicConfig } from '@/lib/public-config';

import { workerSandboxOrigin } from './mcp-app-sandbox-origin';
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
function PresentationCardContent({
  presentation,
  activityId,
  onMessage,
  sandboxOrigin,
}: McpAppPresentationCardProps & { readonly sandboxOrigin?: string }): JSX.Element {
  return (
    <McpAppView
      key={sandboxOrigin}
      {...(sandboxOrigin === undefined ? {} : { sandboxOrigin })}
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

/** This origin cannot change within a mounted document; hydration must first match SSR. */
function subscribeBrowserOrigin(): () => void {
  return () => undefined;
}
function browserOriginSnapshot(): string {
  return window.location.origin;
}
function serverOriginSnapshot(): undefined {
  return undefined;
}

/** Keep query and browser-only metadata outside the legacy pure mounting path. */
function WorkerPresentationCard(props: McpAppPresentationCardProps): JSX.Element {
  const config = usePublicConfig();
  const browserOrigin = useSyncExternalStore(
    subscribeBrowserOrigin,
    browserOriginSnapshot,
    serverOriginSnapshot,
  );
  const origin =
    browserOrigin === undefined
      ? undefined
      : workerSandboxOrigin(config.data?.sandboxOrigin, browserOrigin);
  if (config.isPending || browserOrigin === undefined) {
    return (
      <Surface tone="canvas" shape="medium" pad="roomy">
        <Text token="body-small" tone="muted">
          Loading interactive view…
        </Text>
      </Surface>
    );
  }
  if (config.isError || origin === undefined) {
    return (
      <Surface tone="canvas" shape="medium" pad="roomy">
        <Text token="body-small" tone="muted">
          Interactive view unavailable.
        </Text>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void config.refetch();
          }}
        >
          Try again
        </Button>
      </Surface>
    );
  }
  return <PresentationCardContent key={origin} {...props} sandboxOrigin={origin} />;
}

/** Render a persisted MCP card using its deployment's sandbox boundary. */
export function McpAppPresentationCard(props: McpAppPresentationCardProps): JSX.Element {
  return process.env.DOCKET_RUNTIME_TARGET === 'workers' ? (
    <WorkerPresentationCard {...props} />
  ) : (
    <PresentationCardContent {...props} />
  );
}
