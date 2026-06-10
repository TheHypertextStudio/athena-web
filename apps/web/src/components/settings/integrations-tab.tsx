'use client';

/**
 * `settings` — the Integrations tab.
 *
 * @remarks
 * A categorized directory of the providers Docket can connect to (from
 * `…/integrations/directory`), cross-referenced with the org's existing integrations (from
 * `…/integrations`). Each provider card shows its recommended pattern and what it contributes;
 * a not-yet-configured provider is marked "Available to configure" and expands the
 * {@link ConnectWizard} (which forces the Migration vs Connector choice before creating
 * anything). A configured provider shows its actual pattern + status drawn from the API — never
 * a fabricated "connected" state — which matters in local dev where no real providers exist.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type {
  IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationPattern,
  IntegrationRole,
  SyncJobOut,
} from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { DisconnectConfirmDialog } from './disconnect-confirm-dialog';
import { IntegrationProviderCard } from './integration-provider-card';
import { categoryLabel } from './integrations-config';

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

export function IntegrationsTab({
  orgId,
  canManage,
  isPersonal = false,
}: IntegrationsTabProps): JSX.Element {
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<Record<string, string | null>>({});
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string | null>>({});
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectErrors, setDisconnectErrors] = useState<Record<string, string | null>>({});
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    id: string;
    providerName: string;
  } | null>(null);

  const directoryQ = useApiQuery(
    queryKeys.integrationsDirectory(orgId),
    () => api.v1.orgs[':orgId'].integrations.directory.$get({ param: { orgId } }),
    'Could not load the integration directory.',
  );
  const integrationsQ = useApiQuery(
    queryKeys.integrations(orgId),
    () => api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
    'Could not load integrations.',
  );

  const directory: readonly IntegrationDirectoryProvider[] = directoryQ.data?.providers ?? [];
  const integrations: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const loading = directoryQ.isPending;
  const loadError = directoryQ.isError ? directoryQ.error.message : null;

  const connect = useApiMutation({
    mutationFn: (input: {
      provider: string;
      pattern: IntegrationPattern;
      roles: readonly IntegrationRole[];
    }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations.$post({
            param: { orgId },
            json: {
              provider: input.provider,
              pattern: input.pattern,
              ...(input.roles.length > 0 ? { roles: [...input.roles] } : {}),
              syncMode: input.pattern === 'migration' ? 'import' : 'mirror',
            },
          }),
        'Could not connect this integration.',
      ),
    onSuccess: () => {
      setOpenProvider(null);
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });
  const connecting = connect.isPending;
  const connectError = connect.isError ? connect.error.message : null;

  const sync = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].sync.$post({
            param: { orgId, id },
          }),
        'Sync failed.',
      ),
    onSuccess: (data: SyncJobOut, id: string) => {
      setSyncingId(null);
      if (data.status === 'failed') {
        setSyncErrors((prev) => ({ ...prev, [id]: data.error ?? 'Sync failed.' }));
        return;
      }
      const count = data.processed;
      const msg = count === 0 ? 'Up to date.' : `Synced ${count} item${count === 1 ? '' : 's'}.`;
      setSyncFeedback((prev) => ({ ...prev, [id]: msg }));
      setTimeout(() => {
        setSyncFeedback((prev) => ({ ...prev, [id]: null }));
      }, 5000);
    },
    onError: (err: { message: string }, id: string) => {
      setSyncingId(null);
      setSyncErrors((prev) => ({ ...prev, [id]: err.message }));
    },
    invalidateKeys: [queryKeys.integrations(orgId)],
  });

  const disconnect = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].$delete({
            param: { orgId, id },
          }),
        'Could not disconnect this integration.',
      ),
    onSuccess: (_data: unknown, id: string) => {
      setDisconnectingId(null);
      setDisconnectErrors((prev) => ({ ...prev, [id]: null }));
    },
    onError: (err: { message: string }, id: string) => {
      setDisconnectingId(null);
      setDisconnectErrors((prev) => ({ ...prev, [id]: err.message }));
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
      <p
        role="alert"
        className="border-outline-variant text-destructive text-body rounded-lg border p-4"
      >
        {loadError}
      </p>
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
                  syncingId={syncingId}
                  disconnectingId={disconnectingId}
                  syncFeedback={syncFeedback}
                  syncErrors={syncErrors}
                  disconnectErrors={disconnectErrors}
                  connecting={connecting}
                  connectError={connectError}
                  onToggleOpen={() => {
                    connect.reset();
                    setOpenProvider(isOpen ? null : provider.provider);
                  }}
                  onSync={() => {
                    if (existing) {
                      setSyncFeedback((prev) => ({ ...prev, [existing.id]: null }));
                      setSyncErrors((prev) => ({ ...prev, [existing.id]: null }));
                      setSyncingId(existing.id);
                      sync.mutate(existing.id);
                    }
                  }}
                  onDisconnect={() => {
                    if (existing) {
                      setConfirmDisconnect({ id: existing.id, providerName: provider.name });
                    }
                  }}
                  onConnect={(pattern) => {
                    connect.mutate({ provider: provider.provider, pattern, roles: provider.roles });
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
