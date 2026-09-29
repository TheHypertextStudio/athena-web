'use client';

/** Put Athena messages in the search control the app already provides. */
import { MessageSquare } from '@docket/ui/icons';

import { api } from '@/lib/api';
import { useAppPathname } from '@/lib/app-location';
import { useAppRouter } from '@/lib/interactions/navigation';
import { apiQueryOptions, STALE } from '@/lib/query-core';
import { useApiListQuery } from '@/lib/query';
import { useDebouncedValue } from '@/lib/use-debounced-value';

import type { PaletteItem } from './types';

/** Read message matches only while the Athena page's search is open. */
export function useAthenaMessageSearch(
  query: string,
  enabled: boolean,
  close: () => void,
): { readonly items: readonly PaletteItem[]; readonly loading: boolean } {
  const pathname = useAppPathname();
  const router = useAppRouter();
  const settled = useDebouncedValue(query.trim(), 180);
  const active = enabled && pathname === '/athena' && settled.length >= 2;
  const matches = useApiListQuery(
    apiQueryOptions(
      ['me', 'athena', 'chat', 'palette-search', settled] as const,
      () => api.v1.me.athena.chat.search.$get({ query: { q: settled } }),
      'Could not search Athena messages.',
      { enabled: active, staleTime: STALE.volatile },
    ),
  );
  return {
    loading: active && matches.isPending,
    items:
      active && matches.data
        ? matches.data.items.map((hit) => ({
            id: `athena-message:${hit.activityId}`,
            section: 'results' as const,
            label: hit.text.replace(/\s+/g, ' ').trim().slice(0, 160),
            hint: hit.author === 'user' ? 'Your message to Athena' : 'Athena’s reply',
            icon: MessageSquare,
            searchScore: hit.lexical ? 70 : 40,
            run: () => {
              close();
              const params = new URLSearchParams(window.location.search);
              params.set('message', hit.activityId);
              router.push(`/athena?${params.toString()}`);
            },
          }))
        : [],
  };
}
