'use client';

/**
 * `settings` — the integrations surface, shared by **Connections** and **Import**.
 *
 * @remarks
 * Two sibling settings sections render this one component, differing only by `surface`:
 * - **Connections** (`surface='connections'`) — connect a tool to keep it in *live sync*; the tool
 *   stays the source of truth and Docket mirrors it. Includes the Google Tasks identity surface.
 * - **Import** (`surface='import'`) — a *one-time* full import / migration; Docket becomes the
 *   source of truth.
 *
 * The pattern is fixed by the surface (no inline "Migration vs Connector" choice). Every state
 * shown is the SERVER's truth — a card reads "Connected" only after `POST /:id/verify` validated
 * the credential. Data is fetched at runtime, so the production build needs no running server.
 */
import type {
  IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationPattern,
  IntegrationRole,
  SyncRunOut,
  TeamOut,
} from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';
import { connectorAvailable, connectorOAuthConfigured, usePublicConfig } from '@/lib/public-config';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { DisconnectConfirmDialog } from './disconnect-confirm-dialog';
import { GtasksAccountsSection } from './gtasks-accounts-section';
import { IntegrationProviderCard } from './integration-provider-card';
import { categoryLabel, socialProviderForConnector } from './integrations-config';

/** The provider rendered as its own multi-account identity surface (Connections only). */
const MULTI_ACCOUNT_PROVIDER = 'gtasks';
/** First-party Google Calendar has dedicated nested configuration. */
const FIRST_PARTY_CALENDAR_PROVIDER = 'calendar';

/** Which integration surface this instance renders. */
export type IntegrationSurface = 'connections' | 'import';

/** Per-surface copy + the connect pattern it creates. */
const SURFACE: Record<
  IntegrationSurface,
  {
    pattern: IntegrationPattern;
    actionLabel: string;
    connectHint: string;
    intro: string;
    crossHref: 'connections' | 'import';
    crossText: string;
  }
> = {
  connections: {
    pattern: 'connector',
    actionLabel: 'Connect',
    connectHint: 'Keep it in sync',
    intro:
      'Connect a tool to keep it in sync with Docket. The tool stays the source of truth; Docket mirrors your work.',
    crossHref: 'import',
    crossText: 'Moving off a tool entirely? Import it →',
  },
  import: {
    pattern: 'migration',
    actionLabel: 'Import',
    connectHint: 'One-time full import',
    intro:
      'Import everything from another tool into Docket, once. Docket becomes the source of truth and the tool can be retired.',
    crossHref: 'connections',
    crossText: 'Want to keep a tool in sync instead? Connect it →',
  },
};

/** Props for {@link IntegrationsTab}. */
export interface IntegrationsTabProps {
  /** The active organization id. */
  orgId: string;
  /** Whether the caller can connect integrations. */
  canManage: boolean;
  /** Which surface to render. */
  surface: IntegrationSurface;
}

/** The integrations surface (Connections or Import), driven by the server's truth. */
export function IntegrationsTab({ orgId, canManage, surface }: IntegrationsTabProps): JSX.Element {
  const cfg = SURFACE[surface];
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const teamsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load teams.',
    ),
  );

  const directory: readonly IntegrationDirectoryProvider[] = directoryQ.data?.providers ?? [];
  const integrations: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const teams: readonly TeamOut[] = teamsQ.data?.items ?? [];
  const loading = directoryQ.isPending;
  const loadError = directoryQ.isError ? directoryQ.error.message : null;
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
    async (id: string, provider: string): Promise<void> => {
      if (connectorOAuthConfigured(config, provider)) {
        await authClient.linkSocial({
          provider: socialProviderForConnector(provider),
          callbackURL: `${window.location.pathname}?verify=${id}`,
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
    [config, orgId, refreshIntegrations, setActionError],
  );

  /** Create a brand-new integration (pending) with this surface's pattern, then validate it. */
  const runConnect = useCallback(
    async (provider: string, roles: readonly IntegrationRole[]): Promise<void> => {
      setBusyProvider(provider);
      setActionError(provider, null);
      try {
        const created = await unwrap(
          () =>
            api.v1.orgs[':orgId'].integrations.$post({
              param: { orgId },
              json: {
                provider,
                pattern: cfg.pattern,
                ...(roles.length > 0 ? { roles: [...roles] } : {}),
                syncMode: cfg.pattern === 'migration' ? 'import' : 'mirror',
              },
            }),
          'Could not connect this integration.',
        );
        await refreshIntegrations();
        await finishConnection(created.id, provider);
      } catch (err) {
        setActionError(provider, readError(err, 'Could not connect this integration.'));
      } finally {
        setBusyProvider(null);
      }
    },
    [orgId, cfg.pattern, finishConnection, refreshIntegrations, setActionError],
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

  const sync = useApiMutation({
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
    const map = new Map<string, IntegrationOut[]>();
    for (const integration of integrations) {
      const list = map.get(integration.provider);
      if (list) list.push(integration);
      else map.set(integration.provider, [integration]);
    }
    return map;
  }, [integrations]);

  // Only providers whose recommended pattern matches this surface appear here.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, IntegrationDirectoryProvider[]>();
    for (const provider of directory) {
      if (provider.pattern !== cfg.pattern) continue;
      const list = map.get(provider.category);
      if (list) list.push(provider);
      else {
        order.push(provider.category);
        map.set(provider.category, [provider]);
      }
    }
    return order.map((category) => ({ category, providers: map.get(category) ?? [] }));
  }, [directory, cfg.pattern]);

  const gtasksDirectory = useMemo(
    () =>
      surface === 'connections'
        ? (directory.find((p) => p.provider === MULTI_ACCOUNT_PROVIDER) ?? null)
        : null,
    [directory, surface],
  );
  const calendarDirectory = useMemo(
    () =>
      surface === 'connections'
        ? (directory.find((p) => p.provider === FIRST_PARTY_CALENDAR_PROVIDER) ?? null)
        : null,
    [directory, surface],
  );

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
      <div className="flex flex-col gap-1">
        <p className="text-on-surface-variant text-body leading-relaxed">{cfg.intro}</p>
        <NextLink
          href={`/orgs/${orgId}/settings/${cfg.crossHref}`}
          className="text-primary text-body w-fit font-medium hover:underline"
        >
          {cfg.crossText}
        </NextLink>
      </div>

      {gtasksDirectory ? (
        <GtasksAccountsSection
          orgId={orgId}
          canManage={canManage}
          directory={gtasksDirectory}
          accounts={byProvider.get(MULTI_ACCOUNT_PROVIDER) ?? []}
          teams={teams}
          loading={integrationsQ.isPending}
        />
      ) : null}

      {calendarDirectory ? (
        <section aria-label="Google Calendar" className="flex flex-col gap-3">
          <h2 className="text-on-surface-variant text-xs font-medium">Calendar</h2>
          <NextLink
            href={`/orgs/${orgId}/settings/connections/google-calendar`}
            className="border-outline-variant bg-surface-container-low hover:bg-surface-container flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors"
          >
            <span className="min-w-0">
              <span className="text-on-surface block truncate text-sm font-medium">
                {calendarDirectory.name}
              </span>
              <span className="text-on-surface-variant block truncate text-xs">
                Accounts and visible calendars
              </span>
            </span>
            <span className="text-primary shrink-0 text-sm font-medium">Configure</span>
          </NextLink>
        </section>
      ) : null}

      {grouped.map(({ category, providers }) => (
        <section
          key={category}
          aria-label={categoryLabel(category)}
          className="flex flex-col gap-3"
        >
          <h2 className="text-on-surface-variant text-xs font-medium">{categoryLabel(category)}</h2>
          <ul className="flex flex-col gap-2">
            {providers.map((provider) => {
              // Google Tasks renders in its own identity section (above), not as a card here.
              if (provider.provider === MULTI_ACCOUNT_PROVIDER) return null;
              if (provider.provider === FIRST_PARTY_CALENDAR_PROVIDER) return null;
              const existing = byProvider.get(provider.provider)?.[0];
              return (
                <IntegrationProviderCard
                  key={provider.provider}
                  provider={provider}
                  existing={existing}
                  canManage={canManage}
                  available={connectorAvailable(config, provider.provider)}
                  actionLabel={cfg.actionLabel}
                  connectHint={cfg.connectHint}
                  busy={busyProvider === provider.provider}
                  syncing={existing ? syncingId === existing.id : false}
                  disconnecting={existing ? disconnectingId === existing.id : false}
                  syncFeedback={existing ? (syncFeedback[existing.id] ?? null) : null}
                  actionError={actionErrors[provider.provider] ?? null}
                  onConnect={() => {
                    void runConnect(provider.provider, provider.roles);
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
