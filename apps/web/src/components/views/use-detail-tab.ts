'use client';

/** URL-backed section selection shared by native entity detail pages. */
import { useCallback, useMemo } from 'react';

import { useAppPathname, useAppSearchParams } from '@/lib/app-location';
import { useImmediateUrlState } from '@/lib/interactions/immediate-url-state';
import { useAppRouter } from '@/lib/interactions/navigation';

/** The controlled detail tab and the setter that commits it without adding a history entry. */
export interface UseDetailTabResult<TTab extends string> {
  readonly tab: TTab;
  readonly setTab: (tab: TTab) => void;
}

/**
 * Keep one native entity detail section in the URL.
 *
 * @remarks
 * Overview is the first allowed section and stays implicit so ordinary detail links remain short.
 * Invalid hand-edited values resolve to Overview. Other search parameters survive each tab change,
 * and the immediate overlay keeps a selected tab visible before the router commits its URL update.
 *
 * @param allowedTabs - Ordered section ids, with Overview first.
 * @returns The visible section and an URL-writing setter.
 */
export function useDetailTab<TTab extends string>(
  allowedTabs: readonly [TTab, ...TTab[]],
): UseDetailTabResult<TTab> {
  const router = useAppRouter();
  const pathname = useAppPathname();
  const searchParams = useAppSearchParams();
  const search = searchParams.toString();
  const overview = allowedTabs[0];
  const canonicalTab = useMemo<TTab>(() => {
    const candidate = new URLSearchParams(search).get('tab');
    return candidate && allowedTabs.includes(candidate as TTab) ? (candidate as TTab) : overview;
  }, [allowedTabs, overview, search]);
  const [tab, setImmediateTab] = useImmediateUrlState(canonicalTab);

  const setTab = useCallback(
    (next: TTab): void => {
      setImmediateTab(next);
      const params = new URLSearchParams(search);
      if (next === overview) params.delete('tab');
      else params.set('tab', next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [overview, pathname, router, search, setImmediateTab],
  );

  return { tab, setTab };
}
