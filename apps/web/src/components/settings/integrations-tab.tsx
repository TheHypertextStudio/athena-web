'use client';

/**
 * `settings` — the Integrations tab.
 *
 * @remarks
 * A categorized directory of the providers Docket can connect to (from
 * `…/integrations/directory`), cross-referenced with the org's existing integrations (from
 * `…/integrations`). Every state shown is the SERVER's truth — a card is "Connected" only after
 * `POST /:id/verify` actually validated the credential, and a failed connection/sync surfaces
 * its persisted `lastError` (which survives reload), never a fabricated or ephemeral state.
 *
 * Connecting is a two-beat, validate-before-connected flow: create the integration (`pending`),
 * then either run the provider's OAuth consent redirect (production) or validate directly
 * against the mock connector (local) before anything reads as connected.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type {
  IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationPattern,
  IntegrationRole,
  SyncRunOut,
} from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { DisconnectConfirmDialog } from './disconnect-confirm-dialog';
import { IntegrationProviderCard } from './integration-provider-card';
import {
  categoryLabel,
  connectorOAuthConfigured,
  socialProviderForConnector,
} from './integrations-config';

/** Props for {@link IntegrationsTab}. */
export interface IntegrationsTabProps {
  /** The active organization id. */
  orgId: string;
  /** Whether the caller can connect integrations. */
  canManage: boolean;
  /**
   * Whether the active workspace is the caller's personal space (`OrgSummary.isPersonal`).
   *
   * @remarks
   * Purely presentational: a personal workspace has no team, so the intro copy reads "the tools
   * you already use" rather than "the tools your team already uses". Defaults to `false`.
   */
  isPersonal?: boolean;
}

/** IntegrationsTab renders the settings UI control for its parent workflow. */
export function IntegrationsTab({
  orgId,
  canManage,
  isPersonal = false,
}: IntegrationsTabProps): JSX.Element {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<Record<string, string | null>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    id: string;
    providerName: string;
  } | null>(null);

  const directoryQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrationsDirectory(orgId),
      () => api.v1.orgs[':orgId'].integrations.directory.$get({ param: { orgId } }),
      'Could not load the integration directory.',
    ),
  );
  const integrationsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrations(orgId),
      () => api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
      'Could not load integrations.',
    ),
  );

  const directory: readonly IntegrationDirectoryProvider[] = directoryQ.data?.providers ?? [];
  const integrations: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const loading = directoryQ.isPending;
  const loadError = directoryQ.isError ? directoryQ.error.message : null;

  const setActionError = useCallback((provider: string, message: string | null) => {
    setActionErrors((prev) => ({ ...prev, [provider]: message }));
  }, []);

  const refreshIntegrations = useCallback(
    () => qc.invalidateQueries({ queryKey: queryKeys.integrations(orgId) }),
    [qc, orgId],
  );

  /**
   * Validate (or repair) a connection: in production launch the provider's OAuth consent
   * redirect (which returns to this page with `?verify=<id>`); in local/mock dev validate
   * directly. Only a successful validation lets the card read as connected.
   */
  const finishConnection = useCallback(
    async (id: string, provider: string): Promise<void> => {
      if (connectorOAuthConfigured(provider)) {
        const callbackURL = `${window.location.pathname}?verify=${id}`;
        await authClient.linkSocial({
          provider: socialProviderForConnector(provider),
          callbackURL,
        });
        return; // the browser redirects to the provider's consent screen
      }
      const verified = await unwrap(
        () => api.v1.orgs[':orgId'].integrations[':id'].verify.$post({ param: { orgId, id } }),
        'Could not validate this connection.',
      );
      await refreshIntegrations();
      if (verified.status !== 'connected') {
        setActionError(provider, verified.lastError ?? 'Connection could not be validated.');
      }
    },
    [orgId, refreshIntegrations, setActionError],
  );

  /** Create a brand-new integration (pending), then validate it before it reads as connected. */
  const runConnect = useCallback(
    async (
      provider: string,
      pattern: IntegrationPattern,
      roles: readonly IntegrationRole[],
    ): Promise<void> => {
      setBusyProvider(provider);
      setActionError(provider, null);
      try {
        const created = await unwrap(
          () =>
            api.v1.orgs[':orgId'].integrations.$post({
              param: { orgId },
              json: {
                provider,
                pattern,
                ...(roles.length > 0 ? { roles: [...roles] } : {}),
                syncMode: pattern === 'migration' ? 'import' : 'mirror',
              },
            }),
          'Could not connect this integration.',
        );
        await refreshIntegrations();
        setOpenProvider(null);
        await finishConnection(created.id, provider);
      } catch (err) {
        setActionError(provider, readError(err, 'Could not connect this integration.'));
      } finally {
        setBusyProvider(null);
      }
    },
    [orgId, finishConnection, refreshIntegrations, setActionError],
  );

  /** Finish/repair an existing integration's connection. */
  const runReconnect = useCallback(
    async (existing: IntegrationOut): Promise<void> => {
      setBusyProvider(existing.provider);
      setActionError(existing.provider, null);
      try {
        await finishConnection(existing.id, existing.provider);
      } catch (err) {
        setActionError(existing.provider, readError(err, 'Could not reconnect this integration.'));
      } finally {
        setBusyProvider(null);
      }
    },
    [finishConnection, setActionError],
  );

  // OAuth return: the consent redirect lands back here with `?verify=<id>`. Validate that
  // integration, refresh, then strip the param so a reload doesn't re-run it. `verify` is
  // idempotent, so a StrictMode double-invoke or redundant replace is harmless.
  const verifyReturnId = searchParams.get('verify');
  useEffect(() => {
    if (!verifyReturnId) return;
    void (async () => {
      try {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].integrations[':id'].verify.$post({
              param: { orgId, id: verifyReturnId },
            }),
          'Could not validate this connection.',
        );
        await refreshIntegrations();
      } finally {
        router.replace(window.location.pathname);
      }
    })();
  }, [verifyReturnId, orgId, refreshIntegrations, router]);

  const sync = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].integrations[':id'].sync.$post({ param: { orgId, id } }),
        'Sync failed.',
      ),
    onSuccess: (data: SyncRunOut, id: string) => {
      setSyncingId(null);
      // A failed run already persisted `status: error` + `lastError` on the integration, so the
      // invalidation below repaints the card from that server truth — no ephemeral error needed.
      if (data.status === 'failed') return;
      const count = data.processed;
      const msg = count === 0 ? 'Up to date.' : `Synced ${count} item${count === 1 ? '' : 's'}.`;
      setSyncFeedback((prev) => ({ ...prev, [id]: msg }));
      setTimeout(() => {
        setSyncFeedback((prev) => ({ ...prev, [id]: null }));
      }, 5000);
    },
    onError: (err: { message: string }, id: string) => {
      setSyncingId(null);
      const provider = integrations.find((i) => i.id === id)?.provider;
      if (provider) setActionError(provider, err.message);
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });

  const disconnect = useApiMutation({
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
    onError: (err: { message: string }, id: string) => {
      setDisconnectingId(null);
      const provider = integrations.find((i) => i.id === id)?.provider;
      if (provider) setActionError(provider, err.message);
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });

  const byProvider = useMemo(() => {
    const map = new Map<string, IntegrationOut>();
    for (const integration of integrations) map.set(integration.provider, integration);
    return map;
  }, [integrations]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, IntegrationDirectoryProvider[]>();
    for (const provider of directory) {
      const list = map.get(provider.category);
      if (list) {
        list.push(provider);
      } else {
        order.push(provider.category);
        map.set(provider.category, [provider]);
      }
    }
    return order.map((category) => ({ category, providers: map.get(category) ?? [] }));
  }, [directory]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="border-outline-variant text-on-surface-variant flex flex-col items-start gap-3 rounded-lg border p-4"
      >
        <p className="text-destructive text-body">{loadError}</p>
        <button
          type="button"
          onClick={() => void directoryQ.refetch()}
          className="focus-visible:ring-ring text-primary hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-on-surface-variant text-body leading-relaxed">
        {isPersonal
          ? 'Docket connects to the tools you already use'
          : 'Docket connects to the tools your team already uses'}{' '}
        — pulling your existing work in. Choose a{' '}
        <span className="text-on-surface font-medium">Migration</span> to move fully into Docket, or
        a <span className="text-on-surface font-medium">Connector</span> to mirror a tool that stays
        the source of truth.
      </p>

      {grouped.map(({ category, providers }) => (
        <section
          key={category}
          aria-label={categoryLabel(category)}
          className="flex flex-col gap-3"
        >
          <h2 className="text-on-surface-variant text-xs font-medium">{categoryLabel(category)}</h2>
          <ul className="flex flex-col gap-2">
            {providers.map((provider) => {
              const existing = byProvider.get(provider.provider);
              const isOpen = openProvider === provider.provider;
              return (
                <IntegrationProviderCard
                  key={provider.provider}
                  provider={provider}
                  existing={existing}
                  isOpen={isOpen}
                  canManage={canManage}
                  busy={busyProvider === provider.provider}
                  syncing={existing ? syncingId === existing.id : false}
                  disconnecting={existing ? disconnectingId === existing.id : false}
                  syncFeedback={existing ? (syncFeedback[existing.id] ?? null) : null}
                  actionError={actionErrors[provider.provider] ?? null}
                  onToggleOpen={() => {
                    setActionError(provider.provider, null);
                    setOpenProvider(isOpen ? null : provider.provider);
                  }}
                  onConnect={(pattern) => {
                    void runConnect(provider.provider, pattern, provider.roles);
                  }}
                  onReconnect={() => {
                    if (existing) void runReconnect(existing);
                  }}
                  onSync={() => {
                    if (existing) {
                      setSyncFeedback((prev) => ({ ...prev, [existing.id]: null }));
                      setActionError(provider.provider, null);
                      setSyncingId(existing.id);
                      sync.mutate(existing.id);
                    }
                  }}
                  onDisconnect={() => {
                    if (existing) {
                      setConfirmDisconnect({ id: existing.id, providerName: provider.name });
                    }
                  }}
                />
              );
            })}
          </ul>
        </section>
      ))}

      <DisconnectConfirmDialog
        providerName={confirmDisconnect?.providerName ?? null}
        onConfirm={() => {
          if (confirmDisconnect) {
            setDisconnectingId(confirmDisconnect.id);
            disconnect.mutate(confirmDisconnect.id);
            setConfirmDisconnect(null);
          }
        }}
        onCancel={() => {
          setConfirmDisconnect(null);
        }}
      />
    </div>
  );
}
