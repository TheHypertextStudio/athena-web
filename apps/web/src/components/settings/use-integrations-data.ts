'use client';

/**
 * `settings` — the concern-agnostic data layer shared by Connections and Import.
 *
 * @remarks
 * Both features read the same integration directory and connection list and drive the same
 * connect / reconnect / sync / disconnect ceremonies against the same API — but they are otherwise
 * different products (live sync vs. one-time migration) with different copy and layout. This hook
 * owns *only* what they truly share: the four reads, the write ceremonies, the OAuth-return
 * handling, and the per-row transient state. It takes no `surface` and makes no layout or copy
 * decisions — the connect *pattern* is supplied per call by the feature. Everything user-facing
 * (scope, categories, effect copy) is assembled by {@link useConnectionsController} /
 * {@link useImportController} on top of this. Every state exposed is the server's truth.
 */
import type {
  ConnectorProviderId,
  IdentityOut,
  IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationPattern,
  IntegrationRole,
  SyncMode,
  SyncRunOut,
  TeamOut,
} from '@docket/types';
import { googleScopesForConnector } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { useAuthenticationRecovery } from '@/components/authentication-interlock';
import { userErrorMessage } from '@/lib/problem';
import { connectorAvailable, connectorOAuthConfigured, usePublicConfig } from '@/lib/public-config';
import {
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiMutation,
  useApiQuery,
  useLiveApiQuery,
} from '@/lib/query';

import { socialProviderForConnector } from './integrations-config';

/** How a feature wants a new connection created (the fundamental Connections↔Import difference). */
export interface ConnectPattern {
  pattern: IntegrationPattern;
  syncMode: SyncMode;
}

/** Transient, per-row interaction state — all server- or user-driven, none derived by the view. */
export interface ProviderRowState {
  busy: boolean;
  syncing: boolean;
  disconnecting: boolean;
  syncFeedback: string | null;
  actionError: string | null;
  configOpen: boolean;
}

/** Already-bound callbacks for one provider row; the content layer just wires them to controls. */
export interface ProviderRowActions {
  connect: () => void;
  /** Returns the in-flight promise so the inline config panel can await re-authorization. */
  reconnect: () => Promise<void>;
  sync: () => void;
  disconnect: () => void;
  toggleConfig: () => void;
}

/** The pending-disconnect confirmation, lifted here because it drives a write. */
export interface ConfirmDisconnectModel {
  target: { id: string; providerName: string } | null;
  request: (id: string, providerName: string) => void;
  confirm: () => void;
  cancel: () => void;
}

/** The shared data + actions both features build their view models from. */
export interface IntegrationsData {
  orgId: string;
  loading: boolean;
  loadError: string | null;
  directory: readonly IntegrationDirectoryProvider[];
  byProvider: ReadonlyMap<string, IntegrationOut[]>;
  teams: readonly TeamOut[];
  identities: readonly IdentityOut[];
  availableLinearIdentities: readonly IdentityOut[];
  /** Whether a provider can be connected now (per the server config), independent of existing rows. */
  isAvailable: (provider: string) => boolean;
  /** Whether a provider should appear at all: connectable now, or already has a connection. */
  isVisible: (provider: string) => boolean;
  rowState: (provider: string, existing: IntegrationOut | undefined) => ProviderRowState;
  rowActions: (
    provider: IntegrationDirectoryProvider,
    existing: IntegrationOut | undefined,
    connect: ConnectPattern,
  ) => ProviderRowActions;
  /** Connect a specific linked account to a provider (Linear multi-account), then validate. */
  connectAccount: (
    provider: ConnectorProviderId,
    roles: readonly IntegrationRole[],
    externalAccountId: string,
    connect: ConnectPattern,
  ) => Promise<void>;
  /** Whether a connect ceremony is in flight for the given provider (drives the add-row button). */
  isBusy: (provider: string) => boolean;
  confirm: ConfirmDisconnectModel;
}

/** The shared Connections/Import data layer: reads, writes, and per-row interaction state. */
export function useIntegrationsData(orgId: string): IntegrationsData {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const recoverAuthentication = useAuthenticationRecovery();

  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<Record<string, string | null>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [openConfigId, setOpenConfigId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    id: string;
    providerName: string;
  } | null>(null);

  const directoryQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.integrationsDirectory(orgId),
      () => api.v1.orgs[':orgId'].integrations.directory.$get({ param: { orgId } }),
      'Could not load the integration directory.',
    ),
    15_000,
  );
  const integrationsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrations(orgId),
      () => api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
      'Could not load integrations.',
    ),
  );
  const teamsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load teams.',
    ),
  );
  const identitiesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.identities(),
      () => api.v1.me.identities.$get(),
      'Could not load connected accounts.',
    ),
  );

  const directory: readonly IntegrationDirectoryProvider[] = directoryQ.data?.providers ?? [];
  const integrations: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const teams: readonly TeamOut[] = teamsQ.data?.items ?? [];
  const identities: readonly IdentityOut[] = identitiesQ.data?.items ?? [];
  const loading = directoryQ.isPending;
  const loadError = directoryQ.isError
    ? userErrorMessage(directoryQ.error, 'Could not load integrations.')
    : null;
  const { data: config } = usePublicConfig();

  const setActionError = useCallback((provider: string, message: string | null) => {
    setActionErrors((prev) => ({ ...prev, [provider]: message }));
  }, []);

  const refreshIntegrations = useCallback(
    () => qc.invalidateQueries({ queryKey: queryKeys.integrations(orgId) }),
    [qc, orgId],
  );

  /**
   * Validate (or repair) a connection: in production launch the provider's OAuth consent redirect
   * (returning with `?verify=<id>`); in local/mock dev validate directly. Only a successful
   * validation lets the card read as connected.
   */
  const finishConnection = useCallback(
    async (id: string, provider: string, useLinkedIdentity = false): Promise<void> => {
      if (!useLinkedIdentity && connectorOAuthConfigured(config, provider)) {
        await authClient.linkSocial({
          provider: socialProviderForConnector(provider),
          callbackURL: `${window.location.pathname}?verify=${id}`,
          scopes: [...googleScopesForConnector(provider)],
        });
        return; // the browser redirects to the provider's consent screen
      }
      const verified = await recoverAuthentication(() =>
        unwrap(
          () => api.v1.orgs[':orgId'].integrations[':id'].verify.$post({ param: { orgId, id } }),
          'Could not validate this connection.',
        ),
      );
      await refreshIntegrations();
      if (verified.status !== 'connected') {
        setActionError(provider, 'Connection could not be validated.');
      }
    },
    [config, orgId, recoverAuthentication, refreshIntegrations, setActionError],
  );

  /** Create a brand-new integration (pending) with the caller's pattern, then validate it. */
  const runConnect = useCallback(
    async (
      provider: ConnectorProviderId,
      roles: readonly IntegrationRole[],
      connect: ConnectPattern,
      externalAccountId?: string,
    ): Promise<void> => {
      setBusyProvider(provider);
      setActionError(provider, null);
      try {
        const legacyLinear =
          provider === 'linear' && externalAccountId
            ? integrations.find(
                (candidate) =>
                  candidate.provider === 'linear' && candidate.externalAccountId === null,
              )
            : undefined;
        if (legacyLinear && externalAccountId) {
          await recoverAuthentication(() =>
            unwrap(
              () =>
                api.v1.orgs[':orgId'].integrations[':id'].$patch({
                  param: { orgId, id: legacyLinear.id },
                  json: { externalAccountId },
                }),
              'Could not bind this account to the existing Linear connection.',
            ),
          );
          await refreshIntegrations();
          await finishConnection(legacyLinear.id, provider, true);
          return;
        }
        const created = await recoverAuthentication(() =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].integrations.$post({
                param: { orgId },
                json: {
                  provider,
                  pattern: connect.pattern,
                  ...(roles.length > 0 ? { roles: [...roles] } : {}),
                  syncMode: connect.syncMode,
                  ...(externalAccountId ? { externalAccountId } : {}),
                },
              }),
            'Could not connect this integration.',
          ),
        );
        await refreshIntegrations();
        await finishConnection(created.id, provider, externalAccountId !== undefined);
      } catch (err) {
        setActionError(provider, userErrorMessage(err, 'Could not connect this integration.'));
      } finally {
        setBusyProvider(null);
      }
    },
    [
      orgId,
      finishConnection,
      integrations,
      recoverAuthentication,
      refreshIntegrations,
      setActionError,
    ],
  );

  /** Finish/repair an existing integration's connection. */
  const runReconnect = useCallback(
    async (existing: IntegrationOut): Promise<void> => {
      setBusyProvider(existing.provider);
      setActionError(existing.provider, null);
      try {
        await finishConnection(existing.id, existing.provider);
      } catch (err) {
        setActionError(
          existing.provider,
          userErrorMessage(err, 'Could not reconnect this integration.'),
        );
      } finally {
        setBusyProvider(null);
      }
    },
    [finishConnection, setActionError],
  );

  // OAuth return: the consent redirect lands back with `?verify=<id>`. Re-validate through the
  // write path (never fetch `api.v1.*` directly inside an effect — data-layer rule), then strip.
  const verifyReturn = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].integrations[':id'].verify.$post({ param: { orgId, id } }),
        'Could not validate this connection.',
      ),
    invalidateKeys: [queryKeys.integrations(orgId)],
  });
  const verifyReturnId = searchParams.get('verify');
  useEffect(() => {
    if (!verifyReturnId) return;
    verifyReturn.mutate(verifyReturnId, {
      onSettled: () => {
        router.replace(window.location.pathname);
      },
    });
  }, [verifyReturnId, router]);

  const syncMutation = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].integrations[':id'].sync.$post({ param: { orgId, id } }),
        'Sync failed.',
      ),
    onSuccess: (data: SyncRunOut, id: string) => {
      setSyncingId(null);
      if (data.status === 'failed') return;
      const count = data.processed;
      const msg = count === 0 ? 'Up to date.' : `Synced ${count} item${count === 1 ? '' : 's'}.`;
      setSyncFeedback((prev) => ({ ...prev, [id]: msg }));
      setTimeout(() => {
        setSyncFeedback((prev) => ({ ...prev, [id]: null }));
      }, 5000);
    },
    onError: (err: unknown, id: string) => {
      setSyncingId(null);
      const provider = integrations.find((i) => i.id === id)?.provider;
      if (provider) setActionError(provider, userErrorMessage(err, 'Sync failed.'));
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });

  const disconnectMutation = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].integrations[':id'].$delete({ param: { orgId, id } }),
        'Could not disconnect this integration.',
      ),
    onSuccess: (_data: unknown, id: string) => {
      setDisconnectingId(null);
      const provider = integrations.find((i) => i.id === id)?.provider;
      if (provider) setActionError(provider, null);
    },
    onError: (err: unknown, id: string) => {
      setDisconnectingId(null);
      const provider = integrations.find((i) => i.id === id)?.provider;
      if (provider) {
        setActionError(provider, userErrorMessage(err, 'Could not disconnect this integration.'));
      }
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });

  const byProvider = useMemo(() => {
    const map = new Map<string, IntegrationOut[]>();
    for (const integration of integrations) {
      const list = map.get(integration.provider);
      if (list) list.push(integration);
      else map.set(integration.provider, [integration]);
    }
    return map;
  }, [integrations]);
  const availableLinearIdentities = useMemo(() => {
    const bound = new Set(
      (byProvider.get('linear') ?? [])
        .map((connection) => connection.externalAccountId)
        .filter((id): id is string => Boolean(id)),
    );
    return identities.filter((i) => i.provider === 'linear' && !bound.has(i.accountId));
  }, [byProvider, identities]);

  const isAvailable = useCallback(
    (provider: string) => connectorAvailable(config, provider),
    [config],
  );
  const isVisible = useCallback(
    (provider: string) => isAvailable(provider) || (byProvider.get(provider)?.length ?? 0) > 0,
    [isAvailable, byProvider],
  );

  const rowState = useCallback(
    (provider: string, existing: IntegrationOut | undefined): ProviderRowState => ({
      busy: busyProvider === provider,
      syncing: existing ? syncingId === existing.id : false,
      disconnecting: existing ? disconnectingId === existing.id : false,
      syncFeedback: existing ? (syncFeedback[existing.id] ?? null) : null,
      actionError: actionErrors[provider] ?? null,
      configOpen: existing ? openConfigId === existing.id : false,
    }),
    [busyProvider, syncingId, disconnectingId, syncFeedback, actionErrors, openConfigId],
  );

  const rowActions = useCallback(
    (
      provider: IntegrationDirectoryProvider,
      existing: IntegrationOut | undefined,
      connect: ConnectPattern,
    ): ProviderRowActions => ({
      connect: () => void runConnect(provider.provider, provider.roles, connect),
      reconnect: () => (existing ? runReconnect(existing) : Promise.resolve()),
      sync: () => {
        if (!existing) return;
        setSyncFeedback((prev) => ({ ...prev, [existing.id]: null }));
        setActionError(provider.provider, null);
        setSyncingId(existing.id);
        syncMutation.mutate(existing.id);
      },
      disconnect: () => {
        if (existing) setConfirmDisconnect({ id: existing.id, providerName: provider.name });
      },
      toggleConfig: () => {
        if (existing) setOpenConfigId((cur) => (cur === existing.id ? null : existing.id));
      },
    }),
    [runConnect, runReconnect, syncMutation, setActionError],
  );

  const connectAccount = useCallback(
    (
      provider: ConnectorProviderId,
      roles: readonly IntegrationRole[],
      externalAccountId: string,
      connect: ConnectPattern,
    ) => runConnect(provider, roles, connect, externalAccountId),
    [runConnect],
  );

  const isBusy = useCallback((provider: string) => busyProvider === provider, [busyProvider]);

  const confirm = useMemo<ConfirmDisconnectModel>(
    () => ({
      target: confirmDisconnect,
      request: (id, providerName) => {
        setConfirmDisconnect({ id, providerName });
      },
      confirm: () => {
        if (confirmDisconnect) {
          setDisconnectingId(confirmDisconnect.id);
          disconnectMutation.mutate(confirmDisconnect.id);
          setConfirmDisconnect(null);
        }
      },
      cancel: () => {
        setConfirmDisconnect(null);
      },
    }),
    [confirmDisconnect, disconnectMutation],
  );

  return {
    orgId,
    loading,
    loadError,
    directory,
    byProvider,
    teams,
    identities,
    availableLinearIdentities,
    isAvailable,
    isVisible,
    rowState,
    rowActions,
    connectAccount,
    isBusy,
    confirm,
  };
}
