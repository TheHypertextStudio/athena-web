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
import {
  Badge,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@docket/ui/primitives';
import {
  Calendar,
  Folder,
  Github,
  Layers,
  type LucideIcon,
  Mail,
  Sparkles,
  TaskAlt,
} from '@docket/ui/icons';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { ConnectWizard } from './connect-wizard';

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

/**
 * The leading glyph for each directory provider, keyed by its provider slug.
 *
 * @remarks
 * Mirrors the per-tool glyphs the onboarding connect step shows for the same providers
 * (`calendar` → Calendar, `gtasks` → TaskAlt, `linear` → Layers), extended to the remaining
 * directory providers so every tile reads as its own tool rather than a generic placeholder.
 * Any provider not listed here falls back to {@link Sparkles}.
 */
const PROVIDER_ICON: Record<string, LucideIcon> = {
  github: Github,
  linear: Layers,
  drive: Folder,
  gmail: Mail,
  calendar: Calendar,
  gtasks: TaskAlt,
};

/** Resolve a provider slug to its glyph, falling back to a neutral placeholder. */
function providerIcon(provider: string): LucideIcon {
  return PROVIDER_ICON[provider] ?? Sparkles;
}

/** Human labels for the directory categories. */
const CATEGORY_LABEL: Record<string, string> = {
  engineering: 'Engineering',
  'project-management': 'Project management',
  documents: 'Documents',
  communication: 'Communication',
};

/** Human labels + badge variant for an integration's connection status. */
const STATUS_LABEL: Record<
  IntegrationOut['status'],
  { label: string; variant: 'secondary' | 'destructive' }
> = {
  connected: { label: 'Connected', variant: 'secondary' },
  error: { label: 'Needs attention', variant: 'destructive' },
  disconnected: { label: 'Disconnected', variant: 'secondary' },
};

/** Title-case a category key for any label the map does not cover. */
function categoryLabel(category: string): string {
  return (
    CATEGORY_LABEL[category] ??
    category
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

/**
 * The Integrations tab body.
 *
 * @param props - The {@link IntegrationsTabProps}.
 * @returns the rendered tab panel body.
 */
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

  // The provider directory governs whether the screen can render at all; the org's existing
  // integrations are a best-effort overlay (a failed read just shows everything as configurable).
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

  /** Connect a provider with the chosen pattern, then add it to the org's integrations. */
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

  /** Trigger a read-only mirror refresh for a connected integration. */
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
      // A failed job still returns 200; surface as an error, not success feedback.
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

  /** Remove an integration entirely. */
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

  /** The org's existing integration for a provider, if any. */
  const byProvider = useMemo(() => {
    const map = new Map<string, IntegrationOut>();
    for (const integration of integrations) map.set(integration.provider, integration);
    return map;
  }, [integrations]);

  /** The directory grouped by category, categories in first-seen order. */
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
              const ProviderIcon = providerIcon(provider.provider);
              return (
                <li
                  key={provider.provider}
                  className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border"
                >
                  <div className="flex items-center gap-3 p-4">
                    <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <ProviderIcon aria-hidden="true" className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-on-surface text-body font-medium">{provider.name}</span>
                      <span className="text-on-surface-variant text-xs">
                        {existing
                          ? `Connected as ${existing.pattern === 'migration' ? 'a migration' : 'a connector'}`
                          : `Recommended: ${provider.pattern === 'migration' ? 'Migration' : 'Connector'}`}
                      </span>
                    </div>
                    {existing ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant={STATUS_LABEL[existing.status].variant}
                          className="font-normal"
                        >
                          {STATUS_LABEL[existing.status].label}
                        </Badge>
                        {canManage ? (
                          <>
                            {existing.pattern !== 'migration' ? (
                              <button
                                type="button"
                                disabled={syncingId === existing.id}
                                onClick={() => {
                                  setSyncFeedback((prev) => ({ ...prev, [existing.id]: null }));
                                  setSyncErrors((prev) => ({ ...prev, [existing.id]: null }));
                                  setSyncingId(existing.id);
                                  sync.mutate(existing.id);
                                }}
                                className="focus-visible:ring-ring text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50"
                              >
                                {syncingId === existing.id ? 'Syncing…' : 'Sync'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={disconnectingId === existing.id}
                              onClick={() => {
                                setConfirmDisconnect({
                                  id: existing.id,
                                  providerName: provider.name,
                                });
                              }}
                              className="focus-visible:ring-ring text-destructive hover:bg-destructive/10 text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50"
                            >
                              {disconnectingId === existing.id ? 'Disconnecting…' : 'Disconnect'}
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : canManage ? (
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => {
                          connect.reset();
                          setOpenProvider(isOpen ? null : provider.provider);
                        }}
                        className="focus-visible:ring-ring text-primary hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1"
                      >
                        {isOpen ? 'Close' : 'Configure'}
                      </button>
                    ) : (
                      <span className="text-on-surface-variant text-xs">
                        Ask an admin to configure
                      </span>
                    )}
                  </div>

                  {existing?.status === 'error' ? (
                    <p className="text-on-surface-variant border-outline-variant border-t px-4 py-2 text-xs">
                      Connection needs attention — try syncing to retry. If the issue persists,
                      re-authenticate from your account settings.
                    </p>
                  ) : null}

                  {existing && syncFeedback[existing.id] ? (
                    <p className="text-on-surface-variant border-outline-variant border-t px-4 py-2 text-xs">
                      {syncFeedback[existing.id]}
                    </p>
                  ) : null}

                  {existing && syncErrors[existing.id] ? (
                    <div role="alert" className="border-outline-variant border-t px-4 py-2 text-xs">
                      <p className="text-destructive">{syncErrors[existing.id]}</p>
                      {/sign in with (\w+)/i.test(syncErrors[existing.id] ?? '') ? (
                        <p className="text-on-surface-variant mt-1">
                          To fix this, sign in again with{' '}
                          {(/sign in with (\w+)/i.exec(syncErrors[existing.id] ?? '') ?? [])[1]}{' '}
                          from your account settings, then retry.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {existing && disconnectErrors[existing.id] ? (
                    <p
                      role="alert"
                      className="text-destructive border-outline-variant border-t px-4 py-2 text-xs"
                    >
                      {disconnectErrors[existing.id]}
                    </p>
                  ) : null}

                  {isOpen && !existing ? (
                    <ConnectWizard
                      providerName={provider.name}
                      recommendedPattern={provider.pattern}
                      roles={provider.roles}
                      connecting={connecting}
                      error={connectError}
                      onConnect={(pattern) => {
                        connect.mutate({
                          provider: provider.provider,
                          pattern,
                          roles: provider.roles,
                        });
                      }}
                      onCancel={() => {
                        setOpenProvider(null);
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <Dialog
        open={confirmDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDisconnect(null);
        }}
      >
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>Disconnect {confirmDisconnect?.providerName}?</DialogTitle>
            <DialogDescription>
              Linked tasks imported from it will remain, but won&apos;t receive further updates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className="focus-visible:ring-ring text-on-surface-variant hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1">
              Cancel
            </DialogClose>
            <button
              type="button"
              className="focus-visible:ring-ring bg-destructive text-destructive-foreground hover:bg-destructive/90 text-body rounded-md px-3 py-1.5 font-medium shadow-sm transition-colors outline-none focus-visible:ring-1"
              onClick={() => {
                if (confirmDisconnect) {
                  setDisconnectingId(confirmDisconnect.id);
                  disconnect.mutate(confirmDisconnect.id);
                  setConfirmDisconnect(null);
                }
              }}
            >
              Disconnect
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
