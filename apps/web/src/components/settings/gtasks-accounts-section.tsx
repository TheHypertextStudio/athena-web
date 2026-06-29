'use client';

/**
 * `settings` — the Google Tasks connections section (one connection per linked identity).
 *
 * @remarks
 * Google Tasks supports syncing several Google **accounts** (identities). This surface lists the
 * org's Google Tasks connections — each bound to one identity (shown by its email) — and lets you
 * **connect** another identity by *picking* one that's already linked under
 * **Connected accounts**. Linking/unlinking Google accounts happens there, not here: accounts are
 * user-level identities; a connection is an org-level choice of identity + resources (task lists).
 *
 * Health is ALWAYS the server's truth: a row reads "Connected" only after a real `connect()`
 * validated the credential, never optimistically.
 */
import type {
  ConnectorConfig,
  IdentityOut,
  IntegrationDirectoryProvider,
  IntegrationOut,
  TeamOut,
} from '@docket/types';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { Plus, TaskAlt } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import NextLink from 'next/link';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { readError } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiQuery } from '@/lib/query';

import { DisconnectConfirmDialog } from './disconnect-confirm-dialog';
import { IntegrationActionButton } from './integration-action-button';
import { IntegrationConfigPanel } from './integration-config-panel';
import { STATUS_LABEL } from './integrations-config';

/** Props for {@link GtasksAccountsSection}. */
export interface GtasksAccountsSectionProps {
  /** The active organization id. */
  orgId: string;
  /** Whether the caller can manage integrations. */
  canManage: boolean;
  /** The Google Tasks directory entry (for the default roles on create). */
  directory: IntegrationDirectoryProvider;
  /** The org's existing Google Tasks connections — one per bound identity. */
  accounts: readonly IntegrationOut[];
  /** Teams in the org (for each connection's target-team selector). */
  teams: readonly TeamOut[];
  /** Whether the integrations list is still loading (avoids a premature empty flash). */
  loading: boolean;
}

/** A pending disconnect, carrying the label for the confirm dialog. */
interface DisconnectTarget {
  readonly id: string;
  readonly label: string;
}

/** The display label for one connection — the bound identity's email. */
function accountLabel(account: IntegrationOut): string {
  return account.connection.account ?? account.externalAccountId ?? 'Google account';
}

/** The re-authorize button label for a not-yet-healthy connection. */
function reconnectLabel(status: IntegrationOut['status'], busy: boolean): string {
  if (busy) return 'Connecting…';
  return status === 'pending' ? 'Finish connecting' : 'Reconnect';
}

/** A short summary of the resources a connection syncs (direction + task-list scope). */
function resourceSummary(account: IntegrationOut): string {
  const direction = account.writeBack ? 'Two-way' : 'Import only';
  const cfg = account.config as ConnectorConfig;
  const n = cfg.listIds?.length ?? 0;
  return `${direction} · ${n > 0 ? `${n} list${n === 1 ? '' : 's'}` : 'all lists'}`;
}

/** One Google Tasks connection: its identity, health, manage actions, and inline config panel. */
function GtasksAccountRow(props: {
  account: IntegrationOut;
  orgId: string;
  teams: readonly TeamOut[];
  canManage: boolean;
  busy: boolean;
  /** Transient per-connection action error ('' = none). */
  error: string;
  /** Transient per-connection sync feedback ('' = none). */
  feedback: string;
  configOpen: boolean;
  onReconnect: (account: IntegrationOut) => void;
  onSync: (id: string) => void;
  onToggleConfig: (id: string) => void;
  onRequestDisconnect: (account: IntegrationOut) => void;
}): JSX.Element {
  const { account, canManage, busy, configOpen } = props;
  const isConnected = account.status === 'connected';
  const needsConnect =
    account.status === 'pending' || account.status === 'error' || account.status === 'disconnected';

  return (
    <li className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
      <div className="flex items-center gap-3 p-4">
        <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
          <TaskAlt aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-body truncate font-medium">
            {accountLabel(account)}
          </span>
          <span className="text-on-surface-variant text-xs">{resourceSummary(account)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={STATUS_LABEL[account.status].variant} className="font-normal">
            {STATUS_LABEL[account.status].label}
          </Badge>
          {canManage && needsConnect ? (
            <IntegrationActionButton
              tone="primary"
              disabled={busy}
              onClick={() => {
                props.onReconnect(account);
              }}
            >
              {reconnectLabel(account.status, busy)}
            </IntegrationActionButton>
          ) : null}
          {canManage && isConnected ? (
            <IntegrationActionButton
              tone="muted"
              disabled={busy}
              onClick={() => {
                props.onSync(account.id);
              }}
            >
              {busy ? 'Syncing…' : 'Sync'}
            </IntegrationActionButton>
          ) : null}
          {canManage ? (
            <IntegrationActionButton
              tone="primary"
              aria-expanded={configOpen}
              onClick={() => {
                props.onToggleConfig(account.id);
              }}
            >
              {configOpen ? 'Close' : 'Configure'}
            </IntegrationActionButton>
          ) : null}
          {canManage ? (
            <IntegrationActionButton
              tone="danger"
              disabled={busy}
              onClick={() => {
                props.onRequestDisconnect(account);
              }}
            >
              Disconnect
            </IntegrationActionButton>
          ) : null}
        </div>
      </div>

      {/* Persistent connection error from the server (survives reload). */}
      {account.status === 'error' && account.lastError ? (
        <div role="alert" className="border-outline-variant border-t px-4 py-2 text-xs">
          <p className="text-destructive">{account.lastError}</p>
          <p className="text-on-surface-variant mt-1">
            Use <span className="font-medium">Reconnect</span>, or re-link this account under
            Connected accounts.
          </p>
        </div>
      ) : null}

      {props.error ? (
        <p
          role="alert"
          className="text-destructive border-outline-variant border-t px-4 py-2 text-xs"
        >
          {props.error}
        </p>
      ) : null}

      {props.feedback ? (
        <p className="text-on-surface-variant border-outline-variant border-t px-4 py-2 text-xs">
          {props.feedback}
        </p>
      ) : null}

      {configOpen ? (
        <IntegrationConfigPanel orgId={props.orgId} integration={account} teams={props.teams} />
      ) : null}
    </li>
  );
}

/** The picker panel: choose an already-linked Google identity to connect (or link one first). */
function IdentityPicker(props: {
  orgId: string;
  available: readonly IdentityOut[];
  hasAnyIdentity: boolean;
  loading: boolean;
  busySub: string | null;
  onPick: (accountId: string) => void;
}): JSX.Element {
  if (props.loading) {
    return <Skeleton className="h-16 w-full rounded-xl" />;
  }
  if (props.available.length === 0) {
    return (
      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant text-body rounded-xl border border-dashed p-4">
        {props.hasAnyIdentity ? (
          'Every linked Google account is already connected here.'
        ) : (
          <span>
            Link a Google account under{' '}
            <NextLink
              href={`/orgs/${props.orgId}/settings/connected-accounts`}
              className="text-primary font-medium hover:underline"
            >
              Connected accounts
            </NextLink>{' '}
            first, then connect it here.
          </span>
        )}
      </div>
    );
  }
  return (
    <ul className="border-outline-variant bg-surface-container-low flex flex-col gap-1 rounded-xl border p-2">
      {props.available.map((identity) => {
        const label = identity.email ?? identity.name ?? 'Google account';
        const busy = props.busySub === identity.accountId;
        return (
          <li key={identity.accountId} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <TaskAlt aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
            <span className="text-on-surface text-body min-w-0 flex-1 truncate">{label}</span>
            <IntegrationActionButton
              tone="primary"
              disabled={busy}
              onClick={() => {
                props.onPick(identity.accountId);
              }}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </IntegrationActionButton>
          </li>
        );
      })}
    </ul>
  );
}

/** The Google Tasks connections section. */
export function GtasksAccountsSection({
  orgId,
  canManage,
  directory,
  accounts,
  teams,
  loading,
}: GtasksAccountsSectionProps): JSX.Element {
  const qc = useQueryClient();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectingSub, setConnectingSub] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openConfigId, setOpenConfigId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [confirmDisconnect, setConfirmDisconnect] = useState<DisconnectTarget | null>(null);

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: queryKeys.integrations(orgId) }),
    [qc, orgId],
  );
  const setAccountError = useCallback((id: string, message: string) => {
    setActionError((prev) => ({ ...prev, [id]: message }));
  }, []);

  // The user's linked Google identities; a connection picks one of these.
  const identitiesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.identities(),
      () => api.v1.me.identities.$get(),
      'Could not load your Google accounts.',
    ),
  );
  // Google Tasks can only sync a Google identity, so ignore other linked providers here.
  const googleIdentities = (identitiesQ.data?.items ?? []).filter((i) => i.provider === 'google');
  const bound = new Set(accounts.map((a) => a.externalAccountId).filter(Boolean));
  const available = googleIdentities.filter((i) => !bound.has(i.accountId));

  /** Create a connection bound to a chosen identity, then validate it. */
  const connectIdentity = useCallback(
    async (externalAccountId: string): Promise<void> => {
      setAddError(null);
      setConnectingSub(externalAccountId);
      try {
        const created = await unwrap(
          () =>
            api.v1.orgs[':orgId'].integrations.$post({
              param: { orgId },
              json: {
                provider: 'gtasks',
                pattern: 'connector',
                roles: [...directory.roles],
                syncMode: 'mirror',
                externalAccountId,
              },
            }),
          'Could not connect this account.',
        );
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].integrations[':id'].verify.$post({
              param: { orgId, id: created.id },
            }),
          'Could not validate this account.',
        );
        await refresh();
        setPickerOpen(false);
      } catch (err) {
        setAddError(readError(err, 'Could not connect this account.'));
      } finally {
        setConnectingSub(null);
      }
    },
    [orgId, directory.roles, refresh],
  );

  /** Re-validate one connection's credential (the identity grant must still be valid). */
  const onReconnect = useCallback(
    async (account: IntegrationOut): Promise<void> => {
      setAccountError(account.id, '');
      setBusyId(account.id);
      try {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].integrations[':id'].verify.$post({
              param: { orgId, id: account.id },
            }),
          'Could not reconnect this account.',
        );
        await refresh();
      } catch (err) {
        setAccountError(account.id, readError(err, 'Could not reconnect this account.'));
      } finally {
        setBusyId(null);
      }
    },
    [orgId, refresh, setAccountError],
  );

  const onSync = useCallback(
    async (id: string): Promise<void> => {
      setBusyId(id);
      setActionError((prev) => ({ ...prev, [id]: '' }));
      setFeedback((prev) => ({ ...prev, [id]: '' }));
      try {
        const run = await unwrap(
          () => api.v1.orgs[':orgId'].integrations[':id'].sync.$post({ param: { orgId, id } }),
          'Sync failed.',
        );
        await refresh();
        if (run.status !== 'failed') {
          const n = run.processed;
          setFeedback((prev) => ({
            ...prev,
            [id]: n === 0 ? 'Up to date.' : `Synced ${n} item${n === 1 ? '' : 's'}.`,
          }));
          setTimeout(() => {
            setFeedback((prev) => ({ ...prev, [id]: '' }));
          }, 5000);
        }
      } catch (err) {
        setAccountError(id, readError(err, 'Sync failed.'));
      } finally {
        setBusyId(null);
      }
    },
    [orgId, refresh, setAccountError],
  );

  const onDisconnect = useCallback(
    async (id: string): Promise<void> => {
      setBusyId(id);
      try {
        await unwrap(
          () => api.v1.orgs[':orgId'].integrations[':id'].$delete({ param: { orgId, id } }),
          'Could not disconnect this account.',
        );
        await refresh();
      } catch (err) {
        setAccountError(id, readError(err, 'Could not disconnect this account.'));
      } finally {
        setBusyId(null);
      }
    },
    [orgId, refresh, setAccountError],
  );

  return (
    <section aria-label="Google Tasks connections" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-on-surface-variant text-xs font-medium">Google Tasks</h2>
        {canManage ? (
          <IntegrationActionButton
            tone="primary"
            aria-expanded={pickerOpen}
            onClick={() => {
              setAddError(null);
              setPickerOpen((o) => !o);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            {pickerOpen ? 'Close' : 'Connect account'}
          </IntegrationActionButton>
        ) : null}
      </div>

      {pickerOpen ? (
        <IdentityPicker
          orgId={orgId}
          available={available}
          hasAnyIdentity={googleIdentities.length > 0}
          loading={identitiesQ.isPending}
          busySub={connectingSub}
          onPick={(sub) => {
            void connectIdentity(sub);
          }}
        />
      ) : null}

      {addError ? (
        <p role="alert" className="text-destructive text-body">
          {addError}
        </p>
      ) : null}

      {loading ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : accounts.length === 0 ? (
        <div className="border-outline-variant bg-surface-container-low text-on-surface-variant text-body flex items-center gap-3 rounded-xl border border-dashed p-4">
          <TaskAlt aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {canManage
              ? 'No Google Tasks connections yet. Connect a linked account to start syncing.'
              : 'No Google Tasks connections yet.'}
          </span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <GtasksAccountRow
              key={account.id}
              account={account}
              orgId={orgId}
              teams={teams}
              canManage={canManage}
              busy={busyId === account.id}
              error={actionError[account.id] ?? ''}
              feedback={feedback[account.id] ?? ''}
              configOpen={openConfigId === account.id}
              onReconnect={(acc) => {
                void onReconnect(acc);
              }}
              onSync={(id) => {
                void onSync(id);
              }}
              onToggleConfig={(id) => {
                setOpenConfigId((cur) => (cur === id ? null : id));
              }}
              onRequestDisconnect={(acc) => {
                setConfirmDisconnect({ id: acc.id, label: accountLabel(acc) });
              }}
            />
          ))}
        </ul>
      )}

      <DisconnectConfirmDialog
        providerName={confirmDisconnect?.label ?? null}
        onConfirm={() => {
          if (confirmDisconnect) {
            void onDisconnect(confirmDisconnect.id);
            setConfirmDisconnect(null);
          }
        }}
        onCancel={() => {
          setConfirmDisconnect(null);
        }}
      />
    </section>
  );
}
