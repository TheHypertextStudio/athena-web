import { mergeSearchCandidates, type SearchCandidate } from '@/components/app-catalog/ranking';

import type { PaletteItem } from './types';

interface PaletteCandidate extends SearchCandidate {
  readonly item: PaletteItem;
}

function candidate(item: PaletteItem, source: SearchCandidate['source']): PaletteCandidate {
  return {
    id: item.id,
    label: item.label,
    description: item.description ?? item.hint ?? '',
    aliases: item.keywords ?? [],
    breadcrumb: item.breadcrumb ?? [],
    source,
    sourceRank: item.searchScore ?? 0,
    item,
  };
}

/** Merge local commands and remote hits into the palette's typed-query result list. */
export function mergePaletteResults(
  local: readonly PaletteItem[],
  remote: readonly PaletteItem[],
  query: string,
): readonly PaletteItem[] {
  return mergeSearchCandidates(
    local.map((item) => candidate(item, 'catalog')),
    remote.map((item) => candidate(item, 'remote')),
    query,
  ).map(({ item }) => ({ ...item, section: 'results' }));
}
