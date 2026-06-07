import type { PaletteItem } from './types';

/**
 * Whether `query`'s characters appear in order within `text` (a subsequence match).
 *
 * @remarks
 * A lightweight, case-insensitive fuzzy match — the same idiom Linear/VS Code use for
 * command palettes — so typing `myw` matches "My Work". An empty query always matches.
 *
 * @param text - The candidate string to test against.
 * @param query - The user's (already lowercased) query.
 * @returns `true` when every query character occurs, in order, in `text`.
 */
export function subsequenceMatch(text: string, query: string): boolean {
  if (query.length === 0) return true;
  const haystack = text.toLowerCase();
  let qi = 0;
  for (let hi = 0; hi < haystack.length && qi < query.length; hi += 1) {
    if (haystack[hi] === query[qi]) qi += 1;
  }
  return qi === query.length;
}

/**
 * Filter the static palette commands (navigation, actions, org switches) by a query.
 *
 * @remarks
 * Matches a command when its label OR any of its `keywords` fuzzy-match the query. Server
 * search hits are filtered by the API, not here, so they are never passed to this function.
 * Order is preserved (the input list is already in display order).
 *
 * @param items - The static commands to filter.
 * @param query - The raw user query (trimmed/lowercased internally).
 * @returns the matching subset, in input order.
 */
export function filterCommands(
  items: readonly PaletteItem[],
  query: string,
): readonly PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items;
  return items.filter((item) => {
    if (subsequenceMatch(item.label, q)) return true;
    return (item.keywords ?? []).some((kw) => subsequenceMatch(kw, q));
  });
}
