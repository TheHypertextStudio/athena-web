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
import { WriteError } from './write-error';
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
  Select,
  Skeleton,
  menuDestructiveItem,
} from '@docket/ui/primitives';
import { useAppSearchParams } from '@/lib/app-location';
import { type JSX, useEffect, useId, useState } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import {
  connectorReadinessLabel,
  deriveMcpConnectorDraft,
} from '@/components/settings/mcp-connector-draft';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { EmptyState } from '@docket/ui/components';
import { SettingsGroup } from './settings-group';
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
  const searchParams = useAppSearchParams();
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
    <SettingsGroup
      title="Tools for Athena"
      description="Connect services you use. Athena works through them under rules you set."
      action={
        // While nothing is connected the empty state carries the action, so the header does not
        // offer the same thing twice.
        canManage && (listQ.data?.length ?? 0) > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            Add connector
          </Button>
        ) : undefined
      }
    >
      {mcpReturn === 'connected' ? (
        <p role="status" className="text-success text-body-medium">
          Tool connected.
        </p>
      ) : mcpReturn === 'error' ? (
        <p role="alert" className="text-error text-body-medium">
          Connection was not approved.
        </p>
      ) : null}

      {/* placeholder: the MCP tools connected to this workspace — how many and what each one is.
          The group heading above renders from a static string. */}
      {listQ.isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : listQ.data && listQ.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {listQ.data.map((mcp) => (
            <McpConnectorRow key={mcp.id} orgId={orgId} mcp={mcp} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Cable}
          title="No tools connected yet"
          body={
            canManage
              ? 'Connect a tool so Athena can act through the services you already use.'
              : 'An admin can connect a tool so Athena can act through it.'
          }
          frame="none"
          {...(canManage
            ? {
                cta: {
                  label: 'Add connector',
                  onClick: () => {
                    setAddOpen(true);
                  },
                },
              }
            : {})}
        />
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a connector</DialogTitle>
            <DialogDescription>
              Give Athena access to a remote MCP (Model Context Protocol) server it can use as a
              tool.
            </DialogDescription>
          </DialogHeader>
          <AddMcpConnectorForm
            orgId={orgId}
            onConnected={() => {
              setAddOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </SettingsGroup>
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
  // Tool prefix (alias) autosaves on blur. Keep a local draft so we can sanitize keystrokes and
  // hold onto an invalid value the user is mid-fixing without clobbering the persisted alias.
  // Disconnecting removes Athena's access to this tool for the whole workspace, so it asks.
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(mcp.alias);
  const [aliasFocused, setAliasFocused] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  // Re-sync the draft with the persisted value whenever it changes externally and the field isn't
  // being actively edited (e.g. after a successful save invalidates + refetches the list).
  useEffect(() => {
    if (!aliasFocused) setAliasDraft(mcp.alias);
  }, [mcp.alias, aliasFocused]);

  const edit = useApiMutation({
    mutationFn: (vars: { label: string; alias: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.mcp[':id'].$patch({
            param: { orgId, id: mcp.id },
            json: { label: vars.label.trim(), alias: vars.alias.trim() },
          }),
        'Could not save this connector.',
      ),
    invalidateKeys: [queryKeys.mcpIntegrations(orgId)],
  });

  /** Persist a renamed label (from {@link EditableTitle}) alongside the persisted alias. */
  const saveLabel = (nextLabel: string): void => {
    edit.mutate({ label: nextLabel, alias: mcp.alias });
  };

  /** Autosave the tool prefix on blur — dirty-guarded and validated, never on mount or unchanged. */
  const commitAlias = (): void => {
    setAliasFocused(false);
    const next = aliasDraft.trim();
    if (next === mcp.alias) {
      setAliasError(null);
      return;
    }
    if (!/^[a-z][a-z0-9_]{1,20}$/.test(next)) {
      setAliasError('Use 2–21 lowercase letters, numbers, or underscores, starting with a letter.');
      return;
    }
    setAliasError(null);
    edit.mutate({ label: mcp.label, alias: next });
  };
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
    <li className="flex flex-col gap-4 px-4 py-3">
      <div className="flex flex-col gap-2">
        <div className="text-on-surface text-label-large flex items-center gap-2">
          <span className="max-w-xs min-w-0 flex-1">
            <EditableTitle
              value={mcp.label}
              onSave={saveLabel}
              canEdit={canManage}
              ariaLabel="Connector name"
              className="text-on-surface text-label-large"
              placeholder="Connector name"
            />
          </span>
          <Badge variant={badgeVariant} className="shrink-0">
            {connectorReadinessLabel(mcp.status)}
          </Badge>
          {edit.isSuccess ? (
            <span className="text-on-surface-variant text-body-small">Saved</span>
          ) : null}
        </div>
        {mcp.status === 'connected' && mcp.toolCount !== null ? (
          <span className="text-on-surface-variant text-body-small">
            {String(mcp.toolCount)} tool{mcp.toolCount === 1 ? '' : 's'} available
          </span>
        ) : null}
        {mcp.status === 'error' ? (
          <span role="alert" className="text-error text-body-small">
            This server could not be reached.
          </span>
        ) : null}
      </div>
      <details className="text-on-surface-variant text-body-small">
        <summary className="text-label-large cursor-pointer">Connection details</summary>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="text-label-large">Server</dt>
            <dd className="mt-0.5 font-mono break-all">{mcp.url}</dd>
          </div>
          <div>
            <dt className="text-label-large">Tool prefix</dt>
            <dd className="mt-0.5">
              {canManage ? (
                <>
                  <span className="flex items-center gap-1">
                    <Input
                      value={aliasDraft}
                      maxLength={21}
                      aria-label="Tool prefix"
                      className="h-8 max-w-[10rem] font-mono"
                      onFocus={() => {
                        setAliasFocused(true);
                      }}
                      onChange={(event) => {
                        setAliasDraft(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                      }}
                      onBlur={commitAlias}
                    />
                    <span className="font-mono">__*</span>
                  </span>
                  {aliasError ? (
                    <span role="alert" className="text-error text-body-small mt-1 block">
                      {aliasError}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-mono break-all">{mcp.alias}__*</span>
              )}
            </dd>
          </div>
          {mcp.authMode === 'oauth' && mcp.oauthScope ? (
            <div>
              <dt className="text-label-large">Granted scope</dt>
              <dd className="mt-0.5 font-mono break-all">{mcp.oauthScope}</dd>
            </div>
          ) : null}
        </dl>
      </details>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
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
            className={menuDestructiveItem()}
            disabled={busy}
            onClick={() => {
              setConfirmDisconnect(true);
            }}
          >
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
      ) : null}
      {authorize.isError || verify.isError ? (
        <p role="alert" className="text-error text-body-small">
          {authorize.isError
            ? userErrorMessage(authorize.error, 'Could not start authorization for this server.')
            : userErrorMessage(verify.error, 'Could not verify this server.')}
        </p>
      ) : null}
      {edit.error ? (
        <p role="alert" className="text-error text-body-small">
          {userErrorMessage(edit.error, 'Could not save this connector.')}
        </p>
      ) : null}

      <ConfirmDestructiveDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={`Disconnect ${mcp.label}?`}
        description="Athena loses access to this tool for everyone in the workspace. You can connect it again later."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        {...(disconnect.isError
          ? { error: userErrorMessage(disconnect.error, 'Could not disconnect this connector.') }
          : {})}
        onConfirm={() => {
          disconnect.mutate(undefined, {
            onSuccess: () => {
              setConfirmDisconnect(false);
            },
          });
        }}
      />
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
          <label htmlFor={urlId} className="text-on-surface text-label-large">
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
          <label htmlFor={labelId} className="text-on-surface text-label-large">
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
        <details className="bg-surface-container rounded-xl px-4 py-3">
          <summary className="text-on-surface text-label-large cursor-pointer">
            Advanced options
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={aliasId} className="text-on-surface text-label-large">
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

      {error ? <WriteError message={error} /> : null}

      <Button type="submit" disabled={!canSubmit} className="self-start">
        {connect.isPending ? 'Preparing…' : authMode === 'oauth' ? 'Continue' : 'Connect'}
      </Button>
    </form>
  );
}
