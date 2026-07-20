'use client';

/**
 * `settings` — the **Import** feature: move everything from another tool into Docket, *once* (Docket
 * becomes the source of truth and the tool can be retired).
 *
 * @remarks
 * A different product from Connections, kept separate on purpose. Import is a flat list of
 * migration-pattern providers with no live-sync framing: no "This workspace" scope header, no
 * Google Tasks multi-account section, no Calendar link-out, no per-card effect copy. It creates
 * `migration` integrations (`import` sync). It reuses only the shared {@link useIntegrationsData}
 * plumbing and the {@link ProviderCategorySection} content, never the Connections layout.
 */
import type { TeamOut } from '@docket/types';
import { useMemo } from 'react';

import { groupDirectoryByCategory, visibleProviderConnections } from './integrations-selectors';
import { categoryLabel } from './integrations-config';
import type { ProviderRowModel } from './provider-category-section';
import {
  useIntegrationsData,
  type ConfirmDisconnectModel,
  type ConnectPattern,
} from './use-integrations-data';

/** Import always creates a one-time migration. */
const MIGRATION_PATTERN: ConnectPattern = { pattern: 'migration', syncMode: 'import' };

/** One import category section: a label and its flat list of provider rows. */
export interface ImportCategoryModel {
  category: string;
  label: string;
  rows: readonly ProviderRowModel[];
}

/** The complete Import view model. */
export interface ImportController {
  orgId: string;
  canManage: boolean;
  teams: readonly TeamOut[];
  loading: boolean;
  loadError: string | null;
  intro: { text: string; crossHref: string; crossText: string };
  categories: readonly ImportCategoryModel[];
  confirm: ConfirmDisconnectModel;
}

/** Inputs for {@link useImportController}. */
export interface UseImportControllerArgs {
  orgId: string;
  canManage: boolean;
}

/** The Import feature controller: assembles the one-time-migration view model over shared data. */
export function useImportController({
  orgId,
  canManage,
}: UseImportControllerArgs): ImportController {
  const data = useIntegrationsData(orgId);
  const { directory, byProvider, teams, isVisible, rowState, rowActions } = data;

  // Migration-pattern providers, grouped by category. Flat — no dedicated-section extraction.
  const grouped = useMemo(
    () => groupDirectoryByCategory(directory, 'migration', isVisible),
    [directory, isVisible],
  );

  const categories = useMemo<readonly ImportCategoryModel[]>(
    () =>
      grouped.map(({ category, providers }) => ({
        category,
        label: categoryLabel(category),
        rows: providers.flatMap((provider) => {
          const connections = byProvider.get(provider.provider) ?? [];
          return visibleProviderConnections(provider.provider, connections).map(
            (existing): ProviderRowModel => ({
              key: existing?.id ?? provider.provider,
              provider,
              existing,
              actionLabel: 'Import',
              connectHint: 'One-time full import',
              configurable: false,
              state: rowState(provider.provider, existing),
              actions: rowActions(provider, existing, MIGRATION_PATTERN),
            }),
          );
        }),
      })),
    [grouped, byProvider, rowState, rowActions],
  );

  return {
    orgId,
    canManage,
    teams,
    loading: data.loading,
    loadError: data.loadError,
    intro: {
      text: 'Import everything from another tool into Docket, once. Docket becomes the source of truth and the tool can be retired.',
      crossHref: `/orgs/${orgId}/settings/connections`,
      crossText: 'Want to keep a tool in sync instead? Connect it →',
    },
    categories,
    confirm: data.confirm,
  };
}
