'use client';

/**
 * `settings` — remote MCP server connections (Docket as an MCP client for Athena).
 *
 * @remarks
 * Lists the org's connected remote MCP servers (Streamable HTTP) and lets a manager add,
 * edit, re-verify, or disconnect one. A row only ever reads "Connected" after a live `tools/list`
 * round trip (`POST /integrations/mcp/:id/verify`) proved it — never assumed from having a
 * stored credential. Once connected, Athena's toolbox unions the server's tools in as
 * `<alias>__<name>`, alongside Docket's own tools — this is the enablement surface for Docket
 * being a first-class MCP client Athena consumes, supplementing the built-in toolset rather
 * than replacing it. The same add-a-server form is reused inline from the Athena chat surface
 * (see {@link AddMcpConnectorForm}), so a connector never has to be added from Settings alone.
 */
import type { McpIntegrationOut } from '@docket/types';
import { Cable } from '@docket/ui/icons';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
} from '@docket/ui/primitives';
import { useSearchParams } from 'next/navigation';
import { type JSX, useId, useState } from 'react';

import {
  connectorReadinessLabel,
  deriveMcpConnectorDraft,
} from '@/components/settings/mcp-connector-draft';
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
  const searchParams = useSearchParams();
  const mcpReturn = searchParams.get('mcp');
  const [addOpen, setAddOpen] = useState(false);
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
      <div className="flex flex-wrap items-start gap-4 sm:flex-nowrap sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-on-surface text-title-small">Tools for Athena</h3>
          <p className="text-on-surface-variant text-body-medium">
            Connect services you use. Athena works through them under rules you set.
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            className="shrink-0"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            Add connector
          </Button>
        ) : null}
      </div>

      {mcpReturn === 'connected' ? (
        <p role="status" className="text-success text-body-medium">
          Tool connected.
        </p>
      ) : mcpReturn === 'error' ? (
        <p role="alert" className="text-destructive text-body-medium">
          Connection was not approved.
        </p>
      ) : null}

      <h4 className="text-on-surface mt-3 text-sm font-semibold">Connected tools</h4>

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
        <div className="border-outline-variant bg-surface-container-low text-on-surface-variant text-body-medium flex items-center gap-3 rounded-xl border border-dashed p-4">
          <Cable aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {canManage
              ? 'No tools connected yet. Add a connector so Athena can act through the services you use.'
              : 'No tools connected yet. Ask an admin to add a connector.'}
          </span>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a connector</DialogTitle>
            <DialogDescription>Give Athena access to a service you use.</DialogDescription>
          </DialogHeader>
          <AddMcpConnectorForm
            orgId={orgId}
            onConnected={() => {
              setAddOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
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
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(mcp.label);
  const [alias, setAlias] = useState(mcp.alias);
  const edit = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.mcp[':id'].$patch({
            param: { orgId, id: mcp.id },
            json: { label: label.trim(), alias: alias.trim() },
          }),
        'Could not save this connector.',
      ),
    invalidateKeys: [queryKeys.mcpIntegrations(orgId)],
    onSuccess: () => {
      setEditing(false);
    },
  });
  const authorize = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.mcp[':id'].authorize.$post({
            param: { orgId, id: mcp.id },
          }),
        'Could not start secure approval for this server.',
      ),
    onSuccess: (authorization) => {
      window.location.assign(authorization.authorizationUrl);
    },
  });
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
  const busy = authorize.isPending || verify.isPending || disconnect.isPending || edit.isPending;

  return (
    <li className="border-outline-variant bg-surface-container-low flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-2">
        <span className="text-on-surface flex items-center gap-2 text-sm font-medium">
          {editing ? (
            <Input
              value={label}
              maxLength={80}
              aria-label="Connector name"
              className="h-8 max-w-xs"
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          ) : (
            mcp.label
          )}
          <Badge variant={badgeVariant} className="shrink-0">
            {connectorReadinessLabel(mcp.status)}
          </Badge>
        </span>
        {mcp.status === 'connected' && mcp.toolCount !== null ? (
          <span className="text-on-surface-variant text-xs">
            {String(mcp.toolCount)} tool{mcp.toolCount === 1 ? '' : 's'} available
          </span>
        ) : null}
        {mcp.status === 'error' ? (
          <span role="alert" className="text-destructive text-xs">
            This server could not be reached.
          </span>
        ) : null}
        {editing ? (
          <label className="text-on-surface flex max-w-xs flex-col gap-1 text-xs font-medium">
            Tool prefix
            <Input
              value={alias}
              maxLength={21}
              className="h-8 font-mono"
              onChange={(event) => {
                setAlias(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
              }}
            />
          </label>
        ) : null}
      </div>
      <details className="text-on-surface-variant text-xs">
        <summary className="cursor-pointer font-medium">Connection details</summary>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="font-medium">Server</dt>
            <dd className="mt-0.5 font-mono break-all">{mcp.url}</dd>
          </div>
          <div>
            <dt className="font-medium">Tool prefix</dt>
            <dd className="mt-0.5 font-mono">{mcp.alias}__*</dd>
          </div>
        </dl>
      </details>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                disabled={
                  busy ||
                  !label.trim() ||
                  !/^[a-z][a-z0-9_]{1,20}$/.test(alias.trim()) ||
                  (label.trim() === mcp.label && alias.trim() === mcp.alias)
                }
                onClick={() => {
                  edit.mutate(undefined);
                }}
              >
                {edit.isPending ? 'Saving…' : 'Save details'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setLabel(mcp.label);
                  setAlias(mcp.alias);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit details
            </Button>
          )}
          {mcp.authMode === 'oauth' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                authorize.mutate(undefined);
              }}
            >
              {authorize.isPending
                ? 'Preparing…'
                : mcp.status === 'connected'
                  ? 'Reconnect'
                  : 'Continue approval'}
            </Button>
          ) : (
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
          )}
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
        </div>
      ) : null}
      {edit.error ? (
        <p role="alert" className="text-destructive text-xs">
          {userErrorMessage(edit.error, 'Could not save this connector.')}
        </p>
      ) : null}
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
 * The add-a-server form: URL, display label, alias, and browser-first OAuth approval.
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
  const authId = useId();
  const tokenId = useId();

  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [alias, setAlias] = useState('');
  const [labelEdited, setLabelEdited] = useState(false);
  const [aliasEdited, setAliasEdited] = useState(false);
  const [bearerToken, setBearerToken] = useState('');
  const [authMode, setAuthMode] = useState<'oauth' | 'bearer' | 'none'>('oauth');
  const [error, setError] = useState<string | null>(null);

  const preview = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.mcp.preview.$post({
            param: { orgId },
            json: { url: url.trim() },
          }),
        'Could not read that server.',
      ),
    onSuccess: (server) => {
      if (!labelEdited) setLabel(server.name);
    },
  });

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
              authMode,
              ...(authMode === 'bearer' && bearerToken.trim()
                ? { bearerToken: bearerToken.trim() }
                : {}),
            },
          }),
        'Could not connect that server.',
      ),
    invalidateKeys: [queryKeys.mcpIntegrations(orgId)],
    onSuccess: async (mcp) => {
      if (authMode === 'oauth') {
        try {
          const authorization = await unwrap(
            () =>
              api.v1.orgs[':orgId'].integrations.mcp[':id'].authorize.$post({
                param: { orgId, id: mcp.id },
              }),
            'Could not start secure approval for that server.',
          );
          window.location.assign(authorization.authorizationUrl);
          return;
        } catch (cause) {
          setError(userErrorMessage(cause, 'Could not start secure approval for that server.'));
          return;
        }
      }
      // The row is created either way (so it can be retried via "Verify" without re-entering the
      // form) — but the connector only counts as done here when the live health check actually
      // passed. A failed check keeps the dialog open with safe recovery guidance, not a false
      // "connected".
      if (mcp.status !== 'connected') {
        setError('Could not verify that server. Check its settings.');
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
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-5">
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
              const nextUrl = event.target.value;
              const nextDraft = deriveMcpConnectorDraft(nextUrl, {
                ...(labelEdited ? { label } : {}),
                ...(aliasEdited ? { alias } : {}),
              });
              setUrl(nextUrl);
              if (!labelEdited) setLabel(nextDraft.label);
              if (!aliasEdited) setAlias(nextDraft.alias);
            }}
            onBlur={() => {
              if (url.trim().length > 0) preview.mutate(undefined);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={labelId} className="text-on-surface text-sm font-medium">
            Name
          </label>
          <Input
            id={labelId}
            required
            placeholder="Sunsama"
            value={label}
            onChange={(event) => {
              setLabelEdited(true);
              setLabel(event.target.value);
            }}
          />
        </div>
        <details className="border-outline-variant rounded-lg border px-3 py-2">
          <summary className="text-on-surface cursor-pointer text-sm font-medium">
            Advanced options
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={aliasId} className="text-on-surface text-sm font-medium">
                Tool prefix
              </label>
              <Input
                id={aliasId}
                required
                placeholder="sunsama"
                pattern="^[a-z][a-z0-9_]{1,20}$"
                value={alias}
                onChange={(event) => {
                  setAliasEdited(true);
                  setAlias(event.target.value.toLowerCase());
                }}
              />
            </div>
          </div>
        </details>
        <details className="border-outline-variant rounded-lg border px-3 py-2">
          <summary className="text-on-surface cursor-pointer text-sm font-medium">
            Other connection methods
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={authId} className="text-on-surface text-sm font-medium">
                Connection method
              </label>
              <select
                id={authId}
                value={authMode}
                onChange={(event) => {
                  setAuthMode(event.target.value as 'oauth' | 'bearer' | 'none');
                }}
                className="border-outline-variant bg-surface text-on-surface h-10 rounded-md border px-3 text-sm"
              >
                <option value="oauth">Sign in and approve access</option>
                <option value="bearer">Bearer token</option>
                <option value="none">No authentication</option>
              </select>
            </div>
            {authMode === 'bearer' ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={tokenId} className="text-on-surface text-sm font-medium">
                  Bearer token
                </label>
                <Input
                  id={tokenId}
                  type="password"
                  required
                  placeholder="Credential for this connector"
                  value={bearerToken}
                  onChange={(event) => {
                    setBearerToken(event.target.value);
                  }}
                />
              </div>
            ) : null}
          </div>
        </details>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={!canSubmit} className="self-start">
        {connect.isPending ? 'Preparing…' : authMode === 'oauth' ? 'Continue' : 'Connect'}
      </Button>
    </form>
  );
}
