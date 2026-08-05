/**
 * Group and order the picker's rows, and keep the highlight still while results stream in.
 *
 * @remarks
 * Rows are grouped by what they *are* — Tasks, Projects, People, Files — rather than pooled into
 * one list. A single flat list makes the reader scan every row to find the kind they meant, and it
 * lets whichever kind matched most flood the menu. Grouping by kind means someone looking for a
 * project reads one short section instead of filtering twenty rows in their head.
 *
 * Each group is capped, so a query matching thirty tasks still leaves room for the one project and
 * the two people that also matched.
 *
 * The highlight rules exist because the local wave lands in tens of milliseconds and the external
 * wave hundreds later, so rows appear while someone is already arrowing. Selection is tracked by a
 * stable key rather than an index, external groups always sort last, and once the user has arrowed
 * their choice is pinned.
 */
import type { MentionEntityKind, MentionItem } from '@docket/types';

/** How many rows one group may contribute before it starts crowding out the others. */
const PER_GROUP_CAP = 5;

/** The bare-`@` group, which mixes kinds because recency is the only ordering that matters there. */
const RECENT_GROUP = 'recent';

/** The external group, always last. */
const FILES_GROUP = 'files';

/**
 * The order groups render in.
 *
 * @remarks
 * Roughly by how often each is the thing someone means mid-sentence. Tasks and projects dominate
 * in practice; cycles and milestones are real referents but rarer, so they sit below.
 */
export const MENTION_GROUP_ORDER = [
  RECENT_GROUP,
  'task',
  'project',
  'initiative',
  'program',
  'milestone',
  'cycle',
  'actor',
  'team',
  'agent_session',
  'comment',
  'update',
  FILES_GROUP,
] as const;

/** Which section a row renders under. */
export type MentionGroupKey = (typeof MENTION_GROUP_ORDER)[number];

/** A group of rows with its heading. */
export interface MentionGroup {
  readonly key: MentionGroupKey;
  readonly label: string;
  readonly items: readonly MentionItem[];
  /** How many rows the cap hid, so the menu can say so rather than silently truncating. */
  readonly hidden: number;
}

/** Section headings, application-owned and plural. */
const GROUP_LABEL: Record<MentionGroupKey, string> = {
  recent: 'Recent',
  task: 'Tasks',
  project: 'Projects',
  initiative: 'Initiatives',
  program: 'Programs',
  milestone: 'Milestones',
  cycle: 'Cycles',
  actor: 'People',
  team: 'Teams',
  agent_session: 'Sessions',
  comment: 'Comments',
  update: 'Updates',
  files: 'Files',
};

/** Which group a row belongs in. */
function groupFor(item: MentionItem, hasQuery: boolean): MentionGroupKey {
  if (item.origin === 'external') return FILES_GROUP;
  // Before anything is typed there is no matching to explain, so recency is the whole ordering and
  // splitting it by kind would just make one list into six of length one.
  if (!hasQuery) return RECENT_GROUP;
  return item.entityKind satisfies MentionEntityKind;
}

/** The two waves, plus whether anything has been typed. */
export interface MentionGroupInput {
  /** Rows from the local index. */
  readonly local: readonly MentionItem[];
  /** Rows from the provider fan-out. */
  readonly external: readonly MentionItem[];
  /** False before the first character, which is what turns the whole list into Recent. */
  readonly hasQuery: boolean;
}

/**
 * Combine both waves into rendered groups, deduped, capped, and ordered.
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
    if (items === undefined || items.length === 0) return [];
    return [
      {
        key,
        label: GROUP_LABEL[key],
        items: items.slice(0, PER_GROUP_CAP),
        hidden: Math.max(0, items.length - PER_GROUP_CAP),
      },
    ];
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
 * Before the user has arrowed, the highlight re-derives to the first row, so it follows the best
 * match as they type. After they have arrowed, their choice is honoured even as rows arrive around
 * it. If their chosen row disappears — a narrowing query removed it — the highlight falls back to
 * the same ordinal position rather than snapping to the top.
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
