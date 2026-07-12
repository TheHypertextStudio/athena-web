'use client';

/**
 * `settings` — remote MCP server connections (Docket as an MCP client for Athena).
 *
 * @remarks
 * Lists the org's connected remote MCP servers (Streamable HTTP) and lets a manager add,
 * re-verify, or disconnect one. A row only ever reads "Connected" after a live `tools/list`
 * round trip (`POST /integrations/mcp/:id/verify`) proved it — never assumed from having a
 * stored credential. Once connected, Athena's toolbox unions the server's tools in as
 * `<alias>__<name>`, alongside Docket's own tools — this is the enablement surface for Docket
 * being a first-class MCP client Athena consumes, supplementing the built-in toolset rather
 * than replacing it. The same add-a-server form is reused inline from the Athena chat surface
 * (see {@link AddMcpConnectorForm}), so a connector never has to be added from Settings alone.
 */
import type { McpIntegrationOut } from '@docket/types';
import { Badge, Button, Input, Skeleton } from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

/** Props for {@link McpConnectorsSection}. */
export interface McpConnectorsSectionProps {
  /** The active org. */
  orgId: string;
  /** Whether the caller may add/verify/disconnect (org `manage` capability). */
  canManage: boolean;
}

/** The MCP connectors settings section: list + add-a-server form. */
export function McpConnectorsSection({ orgId, canManage }: McpConnectorsSectionProps): JSX.Element {
  const listQ = useApiQuery(
    apiQueryOptions(
      queryKeys.mcpIntegrations(orgId),
      () => api.v1.orgs[':orgId'].integrations.mcp.$get({ param: { orgId } }),
      'Could not load your MCP connectors.',
      { staleTime: STALE.volatile },
    ),
  );

  return (
    <section className="flex flex-col gap-3" aria-label="MCP connectors">
      <div className="flex flex-col gap-1">
        <h3 className="text-on-surface text-h3">MCP connectors</h3>
        <p className="text-on-surface-variant text-body max-w-prose">
          Connect a remote MCP server so Athena can use its tools alongside Docket&apos;s own. Each
          server gets its own namespace (e.g. <code className="font-mono">sunsama__get_tasks</code>
          ), so nothing collides with Docket&apos;s built-in tools.
        </p>
      </div>

      {listQ.isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : listQ.data && listQ.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {listQ.data.map((mcp) => (
            <McpConnectorRow key={mcp.id} orgId={orgId} mcp={mcp} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <p className="text-on-surface-variant text-body">
          No MCP servers connected yet — Athena is working with Docket&apos;s own tools only.
        </p>
      )}

      {canManage ? <AddMcpConnectorForm orgId={orgId} /> : null}
    </section>
  );
}

/** Props for {@link McpConnectorRow}. */
interface McpConnectorRowProps {
  orgId: string;
  mcp: McpIntegrationOut;
  canManage: boolean;
}

/** One connected (or errored) MCP server, with verify/disconnect actions. */
function McpConnectorRow({ orgId, mcp, canManage }: McpConnectorRowProps): JSX.Element {
  const verify = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.mcp[':id'].verify.$post({
            param: { orgId, id: mcp.id },
          }),
        'Could not verify this server.',
      ),
    invalidateKeys: [queryKeys.mcpIntegrations(orgId)],
  });

  const disconnect = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.mcp[':id'].$delete({ param: { orgId, id: mcp.id } }),
        'Could not disconnect this server.',
      ),
    invalidateKeys: [queryKeys.mcpIntegrations(orgId)],
  });

  const badgeVariant =
    mcp.status === 'connected' ? 'default' : mcp.status === 'error' ? 'destructive' : 'outline';
  const busy = verify.isPending || disconnect.isPending;

  return (
    <li className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-on-surface flex items-center gap-2 truncate text-sm font-medium">
            {mcp.label}
            <Badge variant={badgeVariant} className="shrink-0">
              {mcp.status}
            </Badge>
          </span>
          <span className="text-on-surface-variant block truncate text-xs">
            <code className="font-mono">{mcp.alias}__*</code> · {mcp.url}
            {mcp.status === 'connected' && mcp.toolCount !== null
              ? ` · ${String(mcp.toolCount)} tool${mcp.toolCount === 1 ? '' : 's'}`
              : null}
          </span>
          {mcp.status === 'error' ? (
            <span role="alert" className="text-destructive block text-xs">
              This server could not be reached. Verify its settings and try again.
            </span>
          ) : null}
        </span>
        {canManage ? (
          <span className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                verify.mutate(undefined);
              }}
            >
              {verify.isPending ? 'Verifying…' : 'Verify'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                disconnect.mutate(undefined);
              }}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Props for {@link AddMcpConnectorForm}. */
export interface AddMcpConnectorFormProps {
  orgId: string;
  /** Called after a successful connect (e.g. to close a hosting dialog). */
  onConnected?: (mcp: McpIntegrationOut) => void;
}

/**
 * The add-a-server form: URL, display label, alias, and an optional bearer token.
 *
 * @remarks
 * Shared by the Settings section above and the Athena chat surface's inline "Connect a tool"
 * affordance, so adding a connector never requires two different implementations to stay in
 * sync. Connecting runs a live health check server-side; the result (connected + tool count, or
 * error + reason) is never assumed.
 */
export function AddMcpConnectorForm({ orgId, onConnected }: AddMcpConnectorFormProps): JSX.Element {
  const urlId = useId();
  const labelId = useId();
  const aliasId = useId();
  const tokenId = useId();

  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [alias, setAlias] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const connect = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.mcp.$post({
            param: { orgId },
            json: {
              url: url.trim(),
              label: label.trim(),
              alias: alias.trim(),
              ...(bearerToken.trim() ? { bearerToken: bearerToken.trim() } : {}),
            },
          }),
        'Could not connect that server.',
      ),
    invalidateKeys: [queryKeys.mcpIntegrations(orgId)],
    onSuccess: (mcp) => {
      // The row is created either way (so it can be retried via "Verify" without re-entering the
      // form) — but the connector only counts as done here when the live health check actually
      // passed. A failed check keeps the dialog open with safe recovery guidance, not a false
      // "connected".
      if (mcp.status !== 'connected') {
        setError('Could not verify that server. Check its settings and try again.');
        return;
      }
      setError(null);
      setUrl('');
      setLabel('');
      setAlias('');
      setBearerToken('');
      onConnected?.(mcp);
    },
    onError: (e: Error) => {
      setError(userErrorMessage(e, 'Could not connect that server.'));
    },
  });

  const canSubmit =
    url.trim().length > 0 &&
    label.trim().length > 0 &&
    /^[a-z][a-z0-9_]{1,20}$/.test(alias.trim()) &&
    !connect.isPending;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) connect.mutate(undefined);
      }}
      className="bg-surface-container-low flex flex-col gap-3 rounded-xl p-4"
    >
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={urlId} className="text-on-surface text-sm font-medium">
            Server URL
          </label>
          <Input
            id={urlId}
            type="url"
            required
            placeholder="https://mcp.example.com"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={labelId} className="text-on-surface text-sm font-medium">
            Display name
          </label>
          <Input
            id={labelId}
            required
            placeholder="Sunsama"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={aliasId} className="text-on-surface text-sm font-medium">
            Alias
          </label>
          <Input
            id={aliasId}
            required
            placeholder="sunsama"
            pattern="^[a-z][a-z0-9_]{1,20}$"
            value={alias}
            onChange={(event) => {
              setAlias(event.target.value.toLowerCase());
            }}
          />
          <p className="text-on-surface-variant text-xs">
            Lowercase, letters/numbers/underscore — Athena will see its tools as{' '}
            <code className="font-mono">{alias || 'alias'}__*</code>.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={tokenId} className="text-on-surface text-sm font-medium">
            Bearer token (optional)
          </label>
          <Input
            id={tokenId}
            type="password"
            placeholder="Leave blank if the server needs none"
            value={bearerToken}
            onChange={(event) => {
              setBearerToken(event.target.value);
            }}
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={!canSubmit} className="self-start">
        {connect.isPending ? 'Connecting…' : 'Connect server'}
      </Button>
    </form>
  );
}
