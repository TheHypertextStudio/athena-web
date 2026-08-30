'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useEffect, useId, useState } from 'react';
import { Cable, RefreshCw } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Text,
} from '@docket/ui/primitives';

import { api } from '@/lib/api';
import {
  callMcpAppViewTool,
  mcpAppKeys,
  mcpAppWidgetsDef,
  postWidgetMessage,
  renderMcpAppWidget,
  type McpAppRender,
  type McpAppWidget,
} from '@/lib/athena/mcp-app-defs';
import { queryKeys, useApiQuery } from '@/lib/query';
import { deriveMcpConnectorDraft } from '@/components/settings/mcp-connector-draft';

import { McpAppView } from './mcp-app-view';

/**
 * The MCP surface inside the Athena conversation.
 *
 * @remarks
 * Two things live here for one reason: **you never have to leave Athena.** Connecting a server and
 * using what it gave you are the same activity, so splitting them across a settings tab and a
 * conversation made the second half of the job feel like configuration. The connect form is a
 * dialog over this surface — the route does not change, the conversation stays on screen behind
 * it, and the tools a new server brings appear in this same panel as soon as it connects.
 *
 * The widget itself is rendered by {@link McpAppView}, which owns the frames and the protocol.
 * This component owns only what a person sees: which servers are connected, what they can show
 * you, and what happened when something did not work.
 */
export interface AthenaMcpPanelProps {
  /** Extra classes for the panel's own container. */
  readonly className?: string;
}

/** What the panel is currently showing. */
interface RenderedWidget extends McpAppRender {
  readonly serverName: string;
}

/** Extract meaningful text blocks from one successful raw MCP tool result. */
function textualResult(result: Readonly<Record<string, unknown>>): string | null {
  if (result['isError'] === true || !Array.isArray(result['content'])) return null;
  const text = result['content']
    .map((block) => {
      if (typeof block !== 'object' || block === null) return '';
      return Reflect.get(block, 'type') === 'text' && typeof Reflect.get(block, 'text') === 'string'
        ? String(Reflect.get(block, 'text'))
        : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || null;
}

/**
 * The inline connect form.
 *
 * @remarks
 * Personal Athena connections, not workspace integrations: this is the caller's own Athena, and
 * a server they connect here follows them across workspaces. It is the same endpoint the settings
 * surface uses, so a connection made from either place is the same connection.
 */
function ConnectForm({ onConnected }: { readonly onConnected: () => void }): JSX.Element {
  const aliasId = useId();
  const authId = useId();
  const tokenId = useId();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [aliasEdited, setAliasEdited] = useState(false);
  const [authMode, setAuthMode] = useState<'oauth' | 'bearer' | 'none'>('oauth');
  const [bearerToken, setBearerToken] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const preview = useMutation({
    mutationFn: async () => {
      const response = await api.v1.me.athena.connections.preview.$post({
        json: { url: url.trim() },
      });
      if (!response.ok) throw new Error('preview-failed');
      return response.json();
    },
    onSuccess: (server) => {
      if (!nameEdited) setName(server.name);
    },
  });

  const connect = useMutation({
    mutationFn: async () => {
      const response = await api.v1.me.athena.connections.$post({
        json: {
          url: url.trim(),
          name: name.trim(),
          alias: alias.trim(),
          authMode,
          ...(authMode === 'bearer' && bearerToken.trim()
            ? { bearerToken: bearerToken.trim() }
            : {}),
        },
      });
      if (!response.ok) throw new Error('connect-failed');
      return response.json();
    },
    onSuccess: async (connection) => {
      if (authMode === 'oauth') {
        try {
          const response = await api.v1.me.athena.connections[':id'].authorize.$post({
            param: { id: connection.id },
          });
          if (!response.ok) throw new Error('authorize-failed');
          const authorization = await response.json();
          window.location.assign(authorization.authorizationUrl);
          return;
        } catch {
          setFailure('Docket could not start secure approval for that server.');
          return;
        }
      }
      if (connection.status !== 'connected') {
        setFailure('Docket could not verify that server. Check its settings and try again.');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: mcpAppKeys.widgets() });
      onConnected();
    },
    onError: () => {
      // Application-owned copy. The server's own message is not shown: it is someone else's
      // prose and may be a raw stack trace.
      setFailure('Docket could not reach that server. Check the address and try again.');
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setFailure(null);
        connect.mutate();
      }}
    >
      <Field
        label="Server address"
        description="The MCP endpoint the tool publishes, usually ending in /mcp."
        {...(failure ? { error: failure } : {})}
      >
        <Input
          value={url}
          onChange={(event) => {
            const nextUrl = event.target.value;
            const draft = deriveMcpConnectorDraft(nextUrl, {
              ...(nameEdited ? { label: name } : {}),
              ...(aliasEdited ? { alias } : {}),
            });
            setUrl(nextUrl);
            if (!nameEdited) setName(draft.label);
            if (!aliasEdited) setAlias(draft.alias);
          }}
          onBlur={() => {
            if (url.trim()) preview.mutate();
          }}
          placeholder="https://mcp.example.com/mcp"
          controlSize="lg"
          required
        />
      </Field>
      <Field label="Name" description="What this server is called in Athena.">
        <Input
          value={name}
          onChange={(event) => {
            setNameEdited(true);
            setName(event.target.value);
          }}
          placeholder="Acme Release Tracker"
          controlSize="lg"
        />
      </Field>
      <details className="bg-surface-container rounded-xl px-4 py-3">
        <summary className="text-on-surface text-label-large cursor-pointer">
          Advanced options
        </summary>
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={aliasId} className="text-on-surface text-label-large">
            Tool prefix
          </label>
          <Input
            id={aliasId}
            required
            pattern="^[a-z][a-z0-9_]{1,20}$"
            value={alias}
            onChange={(event) => {
              setAliasEdited(true);
              setAlias(event.target.value.toLowerCase());
            }}
          />
        </div>
      </details>
      <details className="bg-surface-container rounded-xl px-4 py-3">
        <summary className="text-on-surface text-label-large cursor-pointer">
          Other connection methods
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={authId} className="text-on-surface text-label-large">
              Connection method
            </label>
            <Select
              id={authId}
              value={authMode}
              onChange={(event) => {
                setAuthMode(event.target.value as 'oauth' | 'bearer' | 'none');
              }}
            >
              <option value="oauth">Sign in and approve access</option>
              <option value="bearer">Bearer token</option>
              <option value="none">No authentication</option>
            </Select>
          </div>
          {authMode === 'bearer' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={tokenId} className="text-on-surface text-label-large">
                Bearer token
              </label>
              <Input
                id={tokenId}
                type="password"
                required
                value={bearerToken}
                onChange={(event) => {
                  setBearerToken(event.target.value);
                }}
              />
            </div>
          ) : null}
        </div>
      </details>
      <ControlGroup controlSize="lg" className="justify-end">
        <Button
          type="submit"
          disabled={
            connect.isPending ||
            url.trim() === '' ||
            name.trim() === '' ||
            !/^[a-z][a-z0-9_]{1,20}$/.test(alias.trim()) ||
            (authMode === 'bearer' && bearerToken.trim() === '')
          }
        >
          {connect.isPending ? 'Preparing…' : authMode === 'oauth' ? 'Continue' : 'Connect'}
        </Button>
      </ControlGroup>
    </form>
  );
}

/**
 * Render the Athena MCP panel.
 *
 * @param props - Optional container classes.
 * @returns the panel.
 */
export function AthenaMcpPanel({ className }: AthenaMcpPanelProps): JSX.Element {
  const [connectOpen, setConnectOpen] = useState(false);
  const [rendered, setRendered] = useState<RenderedWidget | null>(null);
  const [widgetSaid, setWidgetSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const widgets = useApiQuery(mcpAppWidgetsDef);
  const queryClient = useQueryClient();

  // This handler posts into the caller's canonical Athena chat rather than only updating
  // this panel's own display state. The queue is
  // invalidated afterward so the workbench beside this panel picks up Athena's reply promptly
  // instead of waiting for its own poll interval.
  const sayToConversation = useCallback(
    async (text: string): Promise<boolean> => {
      const posted = await postWidgetMessage(text);
      if (!posted) {
        setFailure(
          `${rendered?.serverName ?? 'This card'} could not post that to the conversation.`,
        );
        return false;
      }
      setWidgetSaid(text);
      await queryClient.invalidateQueries({ queryKey: queryKeys.athena() });
      return true;
    },
    [queryClient, rendered?.serverName],
  );

  const show = useCallback(async (widget: McpAppWidget) => {
    setFailure(null);
    try {
      const render = await renderMcpAppWidget({
        connectionId: widget.connectionId,
        tool: widget.tool,
      });
      setRendered({ ...render, serverName: widget.connectionName });
    } catch {
      setFailure(`${widget.connectionName} did not return that card.`);
    }
  }, []);

  const callTool = useCallback(
    async (name: string, args: Readonly<Record<string, unknown>>) => {
      if (!rendered) throw new Error('no-widget');
      return await callMcpAppViewTool({
        connectionId: rendered.connectionId,
        tool: name,
        arguments: args,
      });
    },
    [rendered],
  );

  // When a widget's own tool call changes the underlying state, re-render the card from the
  // fresh result rather than leaving the user looking at what used to be true.
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    if (refreshToken === 0 || !rendered) return;
    let cancelled = false;
    void renderMcpAppWidget({ connectionId: rendered.connectionId, tool: rendered.tool })
      .then((render) => {
        if (!cancelled) setRendered((current) => (current ? { ...current, ...render } : current));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshToken, rendered?.connectionId, rendered?.tool]);

  const items = widgets.data ?? [];
  const renderedText = rendered ? textualResult(rendered.result) : null;

  return (
    <section
      aria-label="Connected tools"
      data-athena-mcp-panel
      className={className ?? 'flex flex-col gap-3 p-3'}
    >
      <div className="flex w-full min-w-0 items-center justify-between">
        <Text as="h2" token="title-small">
          Connected tools
        </Text>
        <ControlGroup controlSize="sm">
          <Button
            type="button"
            variant="ghost"
            iconOnly={false}
            className="min-h-10"
            onClick={() => {
              setConnectOpen(true);
            }}
          >
            <Cable aria-hidden="true" />
            Connect a tool
          </Button>
        </ControlGroup>
      </div>

      {failure ? (
        <Text as="p" token="body-small" tone="error" role="alert">
          {failure}
        </Text>
      ) : null}

      {widgets.isPending ? (
        <Text token="body-small" tone="muted">
          Checking what your connected servers can show.
        </Text>
      ) : items.length === 0 ? (
        <Text token="body-small" tone="muted">
          Nothing connected yet. Add a server and its cards appear here, in this conversation.
        </Text>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((widget) => (
            <li key={`${widget.connectionId}:${widget.tool}`}>
              <button
                type="button"
                onClick={() => {
                  void show(widget);
                }}
                className="hover:bg-surface-container-high focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <Cable aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <Text as="span" token="body-medium" truncate>
                    {widget.description}
                  </Text>
                  <Text as="span" token="label-small" tone="muted" className="block">
                    {widget.connectionName}
                  </Text>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {rendered ? (
        <div className="flex flex-col gap-2">
          {rendered.resource ? (
            <McpAppView
              instanceId={rendered.connectionId}
              resource={{
                uri: rendered.resource.uri,
                mimeType: rendered.resource.mimeType,
                text: rendered.resource.text,
                meta: {
                  ...(rendered.resource.csp ? { csp: rendered.resource.csp } : {}),
                  ...(rendered.resource.permissions
                    ? { permissions: rendered.resource.permissions }
                    : {}),
                  ...(rendered.resource.prefersBorder === undefined
                    ? {}
                    : { prefersBorder: rendered.resource.prefersBorder }),
                },
              }}
              tool={{ name: rendered.tool, arguments: rendered.arguments }}
              result={rendered.result}
              serverName={rendered.serverName}
              onCallTool={async (name, args) => {
                const result = await callTool(name, args);
                setRefreshToken((token) => token + 1);
                return result;
              }}
              onMessage={sayToConversation}
            />
          ) : (
            <Text token="body-small" tone="muted">
              Interactive view unavailable.
            </Text>
          )}
          {renderedText ? (
            <Text as="p" token="body-small" className="whitespace-pre-wrap">
              {renderedText}
            </Text>
          ) : null}
          {widgetSaid ? (
            <Text as="p" token="body-small">
              {widgetSaid}
            </Text>
          ) : null}
          <ControlGroup controlSize="sm">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRefreshToken((token) => token + 1);
              }}
            >
              <RefreshCw aria-hidden="true" />
              Refresh card
            </Button>
          </ControlGroup>
        </div>
      ) : null}

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a tool</DialogTitle>
            <DialogDescription>
              Add a remote MCP server so Athena can use its tools — and show its cards — in this
              conversation. You stay right here.
            </DialogDescription>
          </DialogHeader>
          <ConnectForm
            onConnected={() => {
              setConnectOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
