'use client';

/**
 * `settings` — the data layer for the Google Tasks multi-account section.
 *
 * @remarks
 * Google Tasks syncs several Google **accounts** (identities); each org connection binds one
 * identity chosen from those linked under **Connected accounts**. This hook owns the reads (the
 * user's linked identities), the writes (connect a picked identity, reconnect, sync, disconnect),
 * and every piece of transient state (which row is busy doing what, the picker, per-row error and
 * feedback, the pending disconnect). It returns an inert {@link GtasksController} so the section and
 * its rows stay pure. Health is ALWAYS the server's truth — a row reads "Connected" only after a
 * real `verify` validated the credential.
 */
import type {
  ConnectorConfig,
  IdentityOut,
  IntegrationDirectoryProvider,
  IntegrationOut,
  TeamOut,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiQuery } from '@/lib/query';

import type { ConfirmDisconnectModel } from './use-integrations-data';

/** Which action holds a given row busy — so only that button shows its in-flight label. */
type BusyAction = 'reconnect' | 'sync' | 'disconnect';
interface BusyState {
  id: string;
  action: BusyAction;
}

/** The display label for one connection — the bound identity's email. */
function accountLabel(account: IntegrationOut): string {
  return account.connection.account ?? account.externalAccountId ?? 'Google account';
}

/** A short summary of the resources a connection syncs (direction + task-list scope). */
function resourceSummary(account: IntegrationOut): string {
  const direction = account.writeBack ? 'Two-way' : 'Import only';
  const cfg = account.config as ConnectorConfig;
  const n = cfg.listIds?.length ?? 0;
  return `${direction} · ${n > 0 ? `${n} list${n === 1 ? '' : 's'}` : 'all lists'}`;
}

/** Per-row interaction state. */
export interface GtasksRowState {
  busyReconnect: boolean;
  busySync: boolean;
  busyDisconnect: boolean;
  /** Transient action error ('' = none). */
  error: string;
  /** Transient sync feedback ('' = none). */
  feedback: string;
  configOpen: boolean;
}

/** One Google Tasks connection row: its account, derived labels, state, and bound actions. */
export interface GtasksRowModel {
  account: IntegrationOut;
  label: string;
  summary: string;
  state: GtasksRowState;
  actions: {
    reconnect: () => void;
    sync: () => void;
    toggleConfig: () => void;
    requestDisconnect: () => void;
  };
}

/** The identity picker: choose an already-linked Google account to connect (or link one first). */
export interface GtasksPickerModel {
  open: boolean;
  toggle: () => void;
  available: readonly IdentityOut[];
  hasAnyIdentity: boolean;
  loading: boolean;
  busySub: string | null;
  pick: (accountId: string) => void;
}

/** The complete view model the Google Tasks section renders from. */
export interface GtasksController {
  orgId: string;
  canManage: boolean;
  teams: readonly TeamOut[];
  picker: GtasksPickerModel;
  addError: string | null;
  loading: boolean;
  rows: readonly GtasksRowModel[];
  confirm: ConfirmDisconnectModel;
}

/** Inputs for {@link useGtasksController}. */
export interface UseGtasksControllerArgs {
  orgId: string;
  canManage: boolean;
  directory: IntegrationDirectoryProvider;
  accounts: readonly IntegrationOut[];
  teams: readonly TeamOut[];
  loading: boolean;
}

/** The Google Tasks section data layer: fetches identities, mutates connections, derives rows. */
export function useGtasksController({
  orgId,
  canManage,
  directory,
  accounts,
  teams,
  loading,
}: UseGtasksControllerArgs): GtasksController {
  const qc = useQueryClient();

  const [busy, setBusy] = useState<BusyState | null>(null);
  const [connectingSub, setConnectingSub] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openConfigId, setOpenConfigId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [confirmDisconnect, setConfirmDisconnect] = useState<{ id: string; label: string } | null>(
    null,
  );

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
  const googleIdentities = useMemo(
    () => (identitiesQ.data?.items ?? []).filter((i) => i.provider === 'google'),
    [identitiesQ.data],
  );
  const available = useMemo(() => {
    const bound = new Set(accounts.map((a) => a.externalAccountId).filter(Boolean));
    return googleIdentities.filter((i) => !bound.has(i.accountId));
  }, [googleIdentities, accounts]);

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
        setAddError(userErrorMessage(err, 'Could not connect this account.'));
      } finally {
        setConnectingSub(null);
      }
    },
    [orgId, directory.roles, refresh],
  );

  /** Re-validate one connection's credential (the identity grant must still be valid). */
  const runReconnect = useCallback(
    async (account: IntegrationOut): Promise<void> => {
      setAccountError(account.id, '');
      setBusy({ id: account.id, action: 'reconnect' });
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
        setAccountError(account.id, userErrorMessage(err, 'Could not reconnect this account.'));
      } finally {
        setBusy(null);
      }
    },
    [orgId, refresh, setAccountError],
  );

  const runSync = useCallback(
    async (id: string): Promise<void> => {
      setBusy({ id, action: 'sync' });
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
        setAccountError(id, userErrorMessage(err, 'Sync failed.'));
      } finally {
        setBusy(null);
      }
    },
    [orgId, refresh, setAccountError],
  );

  const runDisconnect = useCallback(
    async (id: string): Promise<void> => {
      setBusy({ id, action: 'disconnect' });
      try {
        await unwrap(
          () => api.v1.orgs[':orgId'].integrations[':id'].$delete({ param: { orgId, id } }),
          'Could not disconnect this account.',
        );
        await refresh();
      } catch (err) {
        setAccountError(id, userErrorMessage(err, 'Could not disconnect this account.'));
      } finally {
        setBusy(null);
      }
    },
    [orgId, refresh, setAccountError],
  );

  const rows = useMemo<readonly GtasksRowModel[]>(
    () =>
      accounts.map((account) => ({
        account,
        label: accountLabel(account),
        summary: resourceSummary(account),
        state: {
          busyReconnect: busy?.id === account.id && busy.action === 'reconnect',
          busySync: busy?.id === account.id && busy.action === 'sync',
          busyDisconnect: busy?.id === account.id && busy.action === 'disconnect',
          error: actionError[account.id] ?? '',
          feedback: feedback[account.id] ?? '',
          configOpen: openConfigId === account.id,
        },
        actions: {
          reconnect: () => void runReconnect(account),
          sync: () => void runSync(account.id),
          toggleConfig: () => {
            setOpenConfigId((cur) => (cur === account.id ? null : account.id));
          },
          requestDisconnect: () => {
            setConfirmDisconnect({ id: account.id, label: accountLabel(account) });
          },
        },
      })),
    [accounts, busy, actionError, feedback, openConfigId, runReconnect, runSync],
  );

  const picker = useMemo<GtasksPickerModel>(
    () => ({
      open: pickerOpen,
      toggle: () => {
        setAddError(null);
        setPickerOpen((o) => !o);
      },
      available,
      hasAnyIdentity: googleIdentities.length > 0,
      loading: identitiesQ.isPending,
      busySub: connectingSub,
      pick: (accountId) => void connectIdentity(accountId),
    }),
    [
      pickerOpen,
      available,
      googleIdentities.length,
      identitiesQ.isPending,
      connectingSub,
      connectIdentity,
    ],
  );

  const confirm = useMemo<ConfirmDisconnectModel>(
    () => ({
      target: confirmDisconnect
        ? { id: confirmDisconnect.id, providerName: confirmDisconnect.label }
        : null,
      request: (id, providerName) => {
        setConfirmDisconnect({ id, label: providerName });
      },
      confirm: () => {
        if (confirmDisconnect) {
          void runDisconnect(confirmDisconnect.id);
          setConfirmDisconnect(null);
        }
      },
      cancel: () => {
        setConfirmDisconnect(null);
      },
    }),
    [confirmDisconnect, runDisconnect],
  );

  return {
    orgId,
    canManage,
    teams,
    picker,
    addError,
    loading,
    rows,
    confirm,
  };
}
