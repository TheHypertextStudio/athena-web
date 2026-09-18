import * as React from 'react';

import { useVocabulary } from '../../hooks/useVocabulary';
import { type ResolvedNavigationDestination, resolveNavigationCatalog } from './navigation-catalog';
import type { HomeNavKey, WorkspaceNavKey } from './workspaces';

/** What the shell knows that decides which destinations the sidebar lists. */
export interface NavigationCatalogInputs {
  readonly activeHomeKey: HomeNavKey | undefined;
  readonly activeWorkspaceKey: WorkspaceNavKey | undefined;
  readonly activeOrgId: string | null;
  readonly personalWorkspace: boolean;
  /** Composer drafts the person can return to; the Drafts destination is listed only above zero. */
  readonly draftCount: number;
}

/**
 * Resolve the navigation catalog for the active workspace's vocabulary.
 *
 * Both sidebar presentations read the same catalog, so the vocabulary lookups and the memo live
 * here rather than in either of them.
 */
export function useNavigationCatalog({
  activeHomeKey,
  activeWorkspaceKey,
  activeOrgId,
  personalWorkspace,
  draftCount,
}: NavigationCatalogInputs): readonly ResolvedNavigationDestination[] {
  const initiatives = useVocabulary('initiative', { plural: true });
  const programs = useVocabulary('program', { plural: true });
  const projects = useVocabulary('project', { plural: true });
  const cycles = useVocabulary('cycle', { plural: true });
  const teams = useVocabulary('team', { plural: true });
  const hasDrafts = draftCount > 0;
  return React.useMemo(
    () =>
      resolveNavigationCatalog({
        activeHomeKey,
        activeWorkspaceKey,
        activeOrgId,
        personalWorkspace,
        vocabulary: { initiatives, programs, projects, cycles, teams },
        hiddenHomeKeys: hasDrafts ? [] : ['drafts'],
      }),
    [
      hasDrafts,
      activeHomeKey,
      activeWorkspaceKey,
      activeOrgId,
      cycles,
      initiatives,
      personalWorkspace,
      programs,
      projects,
      teams,
    ],
  );
}
