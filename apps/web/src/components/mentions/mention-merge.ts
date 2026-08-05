/**
 * Merge the picker's two result waves without the highlighted row moving under the user's fingers.
 *
 * @remarks
 * The local wave lands in tens of milliseconds and the external wave hundreds later, so rows
 * appear *while* someone is already arrowing through the menu. Every rule here exists to make that
 * safe:
 *
 * - Selection is tracked by a stable key, never by index. An index is correct for a modal whose
 *   list is fixed when it opens, and actively wrong for a list that grows underneath you.
 * - External groups always sort below local ones, so a late arrival can only ever append *below*
 *   the selection rather than pushing it down.
 * - Once the user has arrowed, the selection is pinned. Before they have, it tracks the best match,
 *   which is what makes typing feel responsive.
 *
 * Pure, so all of that is testable rather than aspirational.
 */
import type { MentionItem } from '@docket/types';

/** The order groups always render in. Local families first; external last. */
export const MENTION_GROUP_ORDER = ['recent', 'work', 'people', 'files'] as const;

/** One rendered group of the menu. */
export type MentionGroupKey = (typeof MENTION_GROUP_ORDER)[number];

/** A group of rows with its heading. */
export interface MentionGroup {
  readonly key: MentionGroupKey;
  readonly label: string;
  readonly items: readonly MentionItem[];
}

/** Human headings, application-owned. */
const GROUP_LABEL: Record<MentionGroupKey, string> = {
  recent: 'Recent',
  work: 'Work',
  people: 'People',
  files: 'Files',
};

/** Which group a row belongs in. */
function groupFor(item: MentionItem, hasQuery: boolean): MentionGroupKey {
  if (item.origin === 'external') return 'files';
  if (item.entityKind === 'actor' || item.entityKind === 'team') return 'people';
  return hasQuery ? 'work' : 'recent';
}

/** The two waves, plus whether anything has been typed. */
export interface MentionGroupInput {
  /** Rows from the local index. */
  readonly local: readonly MentionItem[];
  /** Rows from the provider fan-out. */
  readonly external: readonly MentionItem[];
  /** False before the first character, which is what turns the first group into Recent. */
  readonly hasQuery: boolean;
}

/**
 * Combine both waves into rendered groups, deduped and ordered.
 *
 * @remarks
 * Local rows are inserted first so that when the same resource arrives from both waves — a Drive
 * file already indexed locally, say — the local row wins and the external duplicate is dropped.
 *
 * @param input - The two waves and whether anything has been typed.
 * @returns Groups in render order; empty groups are omitted.
 */
export function buildMentionGroups(input: MentionGroupInput): MentionGroup[] {
  const seen = new Set<string>();
  const buckets = new Map<MentionGroupKey, MentionItem[]>();

  for (const item of [...input.local, ...input.external]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const key = groupFor(item, input.hasQuery);
    const bucket = buckets.get(key) ?? [];
    if (!buckets.has(key)) buckets.set(key, bucket);
    bucket.push(item);
  }

  return MENTION_GROUP_ORDER.flatMap((key) => {
    const items = buckets.get(key);
    return items === undefined || items.length === 0
      ? []
      : [{ key, label: GROUP_LABEL[key], items }];
  });
}

/** The rows of every group, flattened into the order arrow keys traverse. */
export function flattenMentionGroups(groups: readonly MentionGroup[]): MentionItem[] {
  return groups.flatMap((group) => [...group.items]);
}

/** Everything the highlight decision depends on. */
export interface ActiveKeyInput {
  /** The rows as they exist now. */
  readonly items: readonly MentionItem[];
  /** The row the user last arrowed to, if any. */
  readonly activeKey: string | undefined;
  /** Whether the user has taken control of the highlight. */
  readonly hasArrowed: boolean;
  /** The rows from the previous render, used to hold position when one disappears. */
  readonly previousItems: readonly MentionItem[];
}

/**
 * Choose which row is highlighted after a render.
 *
 * @remarks
 * The whole anti-jump contract lives in these few lines.
 *
 * Before the user has arrowed, the highlight re-derives to the first row, so it follows the best
 * match as they type. After they have arrowed, their choice is honoured even as rows arrive around
 * it. If their chosen row disappears entirely — a narrowing query removed it — the highlight falls
 * back to the same ordinal position rather than snapping to the top, because that is where their
 * attention already is.
 *
 * @param input - The current rows, the previously active key, and whether the user has arrowed.
 * @returns The key to highlight, or undefined when there is nothing to highlight.
 */
export function resolveActiveKey(input: ActiveKeyInput): string | undefined {
  const first = input.items[0]?.id;
  if (input.items.length === 0) return undefined;
  if (!input.hasArrowed || input.activeKey === undefined) return first;

  if (input.items.some((item) => item.id === input.activeKey)) return input.activeKey;

  const previousIndex = input.previousItems.findIndex((item) => item.id === input.activeKey);
  if (previousIndex === -1) return first;
  return input.items[Math.min(previousIndex, input.items.length - 1)]?.id ?? first;
}

/**
 * Step the highlight by one row, wrapping at both ends.
 *
 * @param items - The rows in traversal order.
 * @param activeKey - The currently highlighted row.
 * @param delta - `1` for down, `-1` for up.
 * @returns The newly highlighted key.
 */
export function stepActiveKey(
  items: readonly MentionItem[],
  activeKey: string | undefined,
  delta: 1 | -1,
): string | undefined {
  if (items.length === 0) return undefined;
  const index = items.findIndex((item) => item.id === activeKey);
  const next = index === -1 ? 0 : (index + delta + items.length) % items.length;
  return items[next]?.id;
}
