import type { Density } from '../shell/ContextProvider';
import type { FlatRow, GroupKey } from './list-view-types';
import { NO_GROUP_ID, NO_GROUP_LABEL } from './list-view-types';

/**
 * Default virtualizer row-height estimate per density. Mirrors the `--row-h` CSS variable
 * (globals.css §density) — the two MUST change together or virtualized scrolling jitters.
 */
export const DENSITY_ROW_HEIGHT: Record<Density, number> = {
  compact: 32,
  comfortable: 36,
  spacious: 44,
};

/** Build the composite collapse key for a sub-group bucket. */
export function subGroupKey(groupId: string, subGroupId: string): string {
  return `${groupId}/${subGroupId}`;
}

/**
 * Flatten grouped items into a linear {@link FlatRow} array, omitting collapsed descendants.
 *
 * @remarks
 * Preserves first-seen order for both buckets and the items within them. A top-level group
 * always emits its header; its sub-group headers and rows are emitted only when the group is
 * expanded, and a sub-group's rows only when that sub-group is also expanded.
 */
export function flattenGroups<TItem>(
  items: readonly TItem[],
  groupBy: (item: TItem) => GroupKey | null,
  subGroupBy: ((item: TItem) => GroupKey | null) | undefined,
  collapsed: ReadonlySet<string>,
  getItemKey: (item: TItem, index: number) => string,
): FlatRow<TItem>[] {
  const groupOrder: string[] = [];
  const groups = new Map<
    string,
    {
      group: GroupKey;
      subOrder: string[];
      subs: Map<string, { sub: GroupKey; items: { item: TItem; key: string }[] }>;
    }
  >();

  items.forEach((item, index) => {
    const rawGroup = groupBy(item);
    const group: GroupKey = rawGroup ?? { id: NO_GROUP_ID, label: NO_GROUP_LABEL };
    let bucket = groups.get(group.id);
    if (!bucket) {
      bucket = { group, subOrder: [], subs: new Map() };
      groups.set(group.id, bucket);
      groupOrder.push(group.id);
    }

    const rawSub = subGroupBy ? subGroupBy(item) : null;
    const sub: GroupKey = subGroupBy
      ? (rawSub ?? { id: NO_GROUP_ID, label: NO_GROUP_LABEL })
      : { id: '__all__', label: '' };
    let subBucket = bucket.subs.get(sub.id);
    if (!subBucket) {
      subBucket = { sub, items: [] };
      bucket.subs.set(sub.id, subBucket);
      bucket.subOrder.push(sub.id);
    }
    subBucket.items.push({ item, key: getItemKey(item, index) });
  });

  const rows: FlatRow<TItem>[] = [];
  for (const groupId of groupOrder) {
    const bucket = groups.get(groupId);
    /* v8 ignore start -- unreachable: every id in `groupOrder` was set in `groups` above. */
    if (!bucket) continue;
    /* v8 ignore stop */
    const groupCount = bucket.subOrder.reduce(
      /* v8 ignore next -- the `?.`/`?? 0` only narrow the always-present sub-bucket lookup. */
      (sum, sid) => sum + (bucket.subs.get(sid)?.items.length ?? 0),
      0,
    );
    rows.push({ kind: 'group', key: `g:${groupId}`, group: bucket.group, count: groupCount });
    if (collapsed.has(groupId)) continue;

    const hasSubGroups = Boolean(subGroupBy);
    for (const subId of bucket.subOrder) {
      const subBucket = bucket.subs.get(subId);
      /* v8 ignore start -- unreachable: every id in `subOrder` was set in `bucket.subs` above. */
      if (!subBucket) continue;
      /* v8 ignore stop */
      if (hasSubGroups) {
        const composite = subGroupKey(groupId, subId);
        rows.push({
          kind: 'subgroup',
          key: `s:${composite}`,
          group: bucket.group,
          subGroup: subBucket.sub,
          count: subBucket.items.length,
        });
        if (collapsed.has(composite)) continue;
      }
      for (const entry of subBucket.items) {
        rows.push({ kind: 'row', key: `r:${entry.key}`, item: entry.item });
      }
    }
  }
  return rows;
}
