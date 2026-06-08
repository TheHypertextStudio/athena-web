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
} from '@docket/types';
import { Badge, Skeleton } from '@docket/ui/primitives';
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
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

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
  const [directory, setDirectory] = useState<readonly IntegrationDirectoryProvider[]>([]);
  const [integrations, setIntegrations] = useState<readonly IntegrationOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  /** Load the provider directory and the org's existing integrations. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [directoryRes, integrationsRes] = await Promise.all([
        api.v1.orgs[':orgId'].integrations.directory.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
      ]);
      if (!directoryRes.ok) {
        setLoadError(await readProblem(directoryRes, 'Could not load the integration directory.'));
        return;
      }
      setDirectory((await directoryRes.json()).providers);
      if (integrationsRes.ok) setIntegrations((await integrationsRes.json()).items);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading integrations.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** Connect a provider with the chosen pattern, then add it to the list. */
  const connect = useCallback(
    async (
      provider: string,
      pattern: IntegrationPattern,
      roles: readonly IntegrationRole[],
    ): Promise<void> => {
      setConnecting(true);
      setConnectError(null);
      try {
        const res = await api.v1.orgs[':orgId'].integrations.$post({
          param: { orgId },
          json: {
            provider,
            pattern,
            ...(roles.length > 0 ? { roles: [...roles] } : {}),
            syncMode: pattern === 'migration' ? 'import' : 'mirror',
          },
        });
        if (!res.ok) {
          setConnectError(await readProblem(res, 'Could not connect this integration.'));
          return;
        }
        const created = await res.json();
        setIntegrations((current) => [...current, created]);
        setOpenProvider(null);
      } catch (caught) {
        setConnectError(readError(caught, 'Something went wrong connecting the integration.'));
      } finally {
        setConnecting(false);
      }
    },
    [orgId],
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
      <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
        {loadError}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm leading-relaxed">
        {isPersonal
          ? 'Connect the tools you already use.'
          : 'Connect the tools your team already uses.'}{' '}
        Choose a <span className="text-foreground font-medium">Migration</span> to move fully into
        Docket, or a <span className="text-foreground font-medium">Connector</span> to mirror a tool
        that stays the source of truth — you decide per tool when you connect.
      </p>

      {grouped.map(({ category, providers }) => (
        <section
          key={category}
          aria-label={categoryLabel(category)}
          className="flex flex-col gap-2"
        >
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {categoryLabel(category)}
          </h2>
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
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <ProviderIcon aria-hidden="true" className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-foreground text-sm font-medium">{provider.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {existing
                          ? `Connected as ${existing.pattern === 'migration' ? 'a migration' : 'a connector'}`
                          : `Recommended: ${provider.pattern === 'migration' ? 'Migration' : 'Connector'}`}
                      </span>
                    </div>
                    {existing ? (
                      <Badge
                        variant={STATUS_LABEL[existing.status].variant}
                        className="font-normal"
                      >
                        {STATUS_LABEL[existing.status].label}
                      </Badge>
                    ) : canManage ? (
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => {
                          setConnectError(null);
                          setOpenProvider(isOpen ? null : provider.provider);
                        }}
                        className="focus-visible:ring-ring text-primary hover:bg-accent rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-1"
                      >
                        {isOpen ? 'Close' : 'Configure'}
                      </button>
                    ) : (
                      <span className="text-muted-foreground text-xs">Available to configure</span>
                    )}
                  </div>

                  {isOpen && !existing ? (
                    <ConnectWizard
                      providerName={provider.name}
                      recommendedPattern={provider.pattern}
                      roles={provider.roles}
                      connecting={connecting}
                      error={connectError}
                      onConnect={(pattern) => {
                        void connect(provider.provider, pattern, provider.roles);
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
    </div>
  );
}
