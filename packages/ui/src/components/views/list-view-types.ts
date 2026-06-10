import type * as React from 'react';
import type { WorkflowStateType } from '../atoms/StatusIcon';

/** The id + label identifying a group or sub-group bucket. */
export interface GroupKey {
  /** Stable bucket id (used as the collapse-state key and React key). */
  id: string;
  /** Display-ready bucket label (entity nouns must already be vocabulary-resolved). */
  label: string;
  /**
   * When the (sub-)grouping is by workflow state, the canonical type — lets a sub-group
   * header render the matching status icon.
   */
  stateType?: WorkflowStateType;
}

/** The synthesized bucket id for items with no group. */
export const NO_GROUP_ID = '__no_group__';

/** The default label for the synthesized no-group bucket. */
export const NO_GROUP_LABEL = 'No project / Triage';

/** Context passed to {@link ListViewProps.renderRow} for one data row. */
export interface RenderRowContext {
  /** The row's index within the flattened row array. */
  flatIndex: number;
  /** Whether this row is the active (keyboard-focused) row. */
  active: boolean;
  /** Activate (open) this row. */
  onActivate: () => void;
}

/** A flattened row: a group header, a sub-group header, or a data row. */
export type FlatRow<TItem> =
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly group: GroupKey;
      readonly count: number;
    }
  | {
      readonly kind: 'subgroup';
      readonly key: string;
      readonly group: GroupKey;
      readonly subGroup: GroupKey;
      readonly count: number;
    }
  | { readonly kind: 'row'; readonly key: string; readonly item: TItem };

/** Props for {@link ListView}. */
export interface ListViewProps<TItem> {
  /** The flat list of items to group, sub-group, and render. */
  items: readonly TItem[];
  /** Partition items into top-level groups; `null` routes to the no-group bucket. */
  groupBy: (item: TItem) => GroupKey | null;
  /** Optionally partition each group into sub-groups; omit for single-level grouping. */
  subGroupBy?: (item: TItem) => GroupKey | null;
  /** Render one data row. */
  renderRow: (item: TItem, ctx: RenderRowContext) => React.ReactNode;
  /** Stable React key for an item; falls back to the item's flat index when omitted. */
  getItemKey?: (item: TItem) => string;
  /** Controlled set of collapsed bucket ids (group id or `${groupId}/${subGroupId}`). */
  collapsed?: ReadonlySet<string>;
  /** Toggle a bucket's collapse state (controlled mode). */
  onToggle?: (bucketId: string) => void;
  /** Initial collapsed bucket ids for uncontrolled mode. */
  defaultCollapsed?: Iterable<string>;
  /** Activate (open) a data item (Enter / click). */
  onActivateItem?: (item: TItem) => void;
  /**
   * Estimated pixel height of a single row; drives virtualization. Defaults to the active
   * density's row height (32 / 36 / 44 for compact / comfortable / spacious), mirroring the
   * `--row-h` CSS variable the row components consume.
   */
  rowHeight?: number;
  /** Accessible label for the grid. */
  label?: string;
  /** Extra classes merged onto the scroll container. */
  className?: string;
}
