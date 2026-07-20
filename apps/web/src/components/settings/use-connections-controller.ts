'use client';

/**
 * `settings` — the **Connections** feature: connect a tool to keep it in *live sync* (the tool stays
 * the source of truth; Docket mirrors it).
 *
 * @remarks
 * This is deliberately separate from Import — a different product with different copy, scope, and
 * layout — even though both drive the shared {@link useIntegrationsData}. Connections adds the
 * "This workspace" scope framing, the Google Tasks multi-account section, the Calendar link-out,
 * and per-card effect/mechanics copy. It creates `connector` integrations (`mirror` sync).
 */
import type { IntegrationDirectoryProvider, IntegrationOut, TeamOut } from '@docket/types';
import { useMemo, useState } from 'react';

import { groupDirectoryByCategory, visibleProviderConnections } from './integrations-selectors';
import { categoryLabel, connectionCardCopy } from './integrations-config';
import type { LinearAddModel } from './linear-add-account-row';
import type { ProviderRowModel } from './provider-category-section';
import {
  useIntegrationsData,
  type ConfirmDisconnectModel,
  type ConnectPattern,
} from './use-integrations-data';

/** Connections always creates a live-sync connector. */
const CONNECTOR_PATTERN: ConnectPattern = { pattern: 'connector', syncMode: 'mirror' };
/** The provider rendered as its own multi-account identity surface. */
const MULTI_ACCOUNT_PROVIDER = 'gtasks';
/** First-party Google Calendar has dedicated nested configuration. */
const FIRST_PARTY_CALENDAR_PROVIDER = 'calendar';

/** The Google Tasks multi-account section's inputs. */
export interface GtasksSectionModel {
  directory: IntegrationDirectoryProvider;
  accounts: readonly IntegrationOut[];
  teams: readonly TeamOut[];
  loading: boolean;
}

/** The Google Calendar link-out row's inputs. */
export interface CalendarRowModel {
  name: string;
  effect: string;
  href: string;
}

/** One category section: its label, its rows, and the Linear add-row when relevant. */
export interface CategorySectionModel {
  category: string;
  label: string;
  rows: readonly ProviderRowModel[];
  linearAdd: LinearAddModel | null;
}

/** The complete Connections view model. */
export interface ConnectionsController {
  orgId: string;
  canManage: boolean;
  teams: readonly TeamOut[];
  loading: boolean;
  loadError: string | null;
  intro: { text: string; crossHref: string; crossText: string };
  /** Drives the "This workspace" scope header; `linkedAccountsHref` links to identity linking. */
  scope: { linkedAccountsHref: string | undefined };
  gtasks: GtasksSectionModel | null;
  calendar: CalendarRowModel | null;
  categories: readonly CategorySectionModel[];
  confirm: ConfirmDisconnectModel;
}

/** Inputs for {@link useConnectionsController}. */
export interface UseConnectionsControllerArgs {
  orgId: string;
  canManage: boolean;
  /** Route to the personal "Connected accounts" surface; omit when it renders inline above. */
  linkedAccountsHref?: string;
}

/** The Connections feature controller: assembles the live-sync view model over the shared data. */
export function useConnectionsController({
  orgId,
  canManage,
  linkedAccountsHref,
}: UseConnectionsControllerArgs): ConnectionsController {
  const data = useIntegrationsData(orgId);
  const {
    directory,
    byProvider,
    teams,
    availableLinearIdentities,
    isVisible,
    rowState,
    rowActions,
  } = data;
  const [selectedLinearAccountId, setSelectedLinearAccountId] = useState('');

  const gtasksDirectory = useMemo(
    () =>
      directory.find((p) => p.provider === MULTI_ACCOUNT_PROVIDER && isVisible(p.provider)) ?? null,
    [directory, isVisible],
  );
  const calendarDirectory = useMemo(
    () =>
      directory.find(
        (p) => p.provider === FIRST_PARTY_CALENDAR_PROVIDER && isVisible(p.provider),
      ) ?? null,
    [directory, isVisible],
  );

  // Connector-pattern providers, grouped by category, minus the two with dedicated sections.
  const grouped = useMemo(
    () => groupDirectoryByCategory(directory, 'connector', isVisible),
    [directory, isVisible],
  );

  const linearAdd = useMemo<LinearAddModel | null>(() => {
    if (!canManage) return null;
    const linearRoles = directory.find((p) => p.provider === 'linear')?.roles ?? [];
    return {
      available: availableLinearIdentities,
      selectedId: selectedLinearAccountId,
      setSelectedId: setSelectedLinearAccountId,
      busy: data.isBusy('linear'),
      connect: () => {
        const accountId = selectedLinearAccountId;
        if (!accountId) return;
        void data.connectAccount('linear', linearRoles, accountId, CONNECTOR_PATTERN).then(() => {
          setSelectedLinearAccountId('');
        });
      },
      addAccountsHref: `/orgs/${orgId}/settings/connected-accounts`,
    };
  }, [canManage, directory, availableLinearIdentities, selectedLinearAccountId, data, orgId]);

  const categories = useMemo<readonly CategorySectionModel[]>(
    () =>
      grouped
        .map(({ category, providers }) => {
          const rows = providers.flatMap((provider) => {
            if (
              provider.provider === MULTI_ACCOUNT_PROVIDER ||
              provider.provider === FIRST_PARTY_CALENDAR_PROVIDER
            )
              return [];
            const connections = byProvider.get(provider.provider) ?? [];
            const copy = connectionCardCopy(provider.provider);
            return visibleProviderConnections(provider.provider, connections).map(
              (existing): ProviderRowModel => ({
                key: existing?.id ?? provider.provider,
                provider,
                existing,
                actionLabel: 'Connect',
                connectHint: 'Keep it in sync',
                effect: copy.effect,
                mechanics: copy.mechanics,
                configurable: provider.provider === 'linear',
                state: rowState(provider.provider, existing),
                actions: rowActions(provider, existing, CONNECTOR_PATTERN),
              }),
            );
          });
          const hasLinear = providers.some((p) => p.provider === 'linear');
          return {
            category,
            label: categoryLabel(category),
            rows,
            linearAdd: hasLinear ? linearAdd : null,
          };
        })
        // Never render a bare category heading whose only members moved to their own sections.
        .filter((section) => section.rows.length > 0 || section.linearAdd !== null),
    [grouped, byProvider, rowState, rowActions, linearAdd],
  );

  const gtasks = useMemo<GtasksSectionModel | null>(
    () =>
      gtasksDirectory
        ? {
            directory: gtasksDirectory,
            accounts: byProvider.get(MULTI_ACCOUNT_PROVIDER) ?? [],
            teams,
            loading: data.loading,
          }
        : null,
    [gtasksDirectory, byProvider, teams, data.loading],
  );

  const calendar = useMemo<CalendarRowModel | null>(
    () =>
      calendarDirectory
        ? {
            name: calendarDirectory.name,
            effect: connectionCardCopy('calendar').effect,
            href: `/orgs/${orgId}/settings/connections/google-calendar`,
          }
        : null,
    [calendarDirectory, orgId],
  );

  return {
    orgId,
    canManage,
    teams,
    loading: data.loading,
    loadError: data.loadError,
    intro: {
      text: 'Connect a tool to keep it in sync with Docket. The tool stays the source of truth; Docket mirrors your work.',
      crossHref: `/orgs/${orgId}/settings/import`,
      crossText: 'Moving off a tool entirely? Import it →',
    },
    scope: { linkedAccountsHref },
    gtasks,
    calendar,
    categories,
    confirm: data.confirm,
  };
}
