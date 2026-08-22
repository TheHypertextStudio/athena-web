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
  stateType?: WorkflowStateType | undefined;
}

/** The synthesized bucket id for items with no group. */
export const NO_GROUP_ID = '__no_group__';

/** The default label for the synthesized no-group bucket. */
export const NO_GROUP_LABEL = 'No project / Triage';

/** Semantic DOM attributes owned by {@link ListView} and forwarded to one rendered row. */
export interface ListViewRowProps {
  /** Stable DOM id referenced by the grid's `aria-activedescendant`. */
  readonly id: string;
  /** One-based position in the flattened row sequence. */
  readonly 'aria-rowindex': number;
}

/** Context passed to {@link ListViewProps.renderRow} for one data row. */
export interface RenderRowContext {
  /** The row's index within the flattened row array. */
  flatIndex: number;
  /** Whether this row is the active (keyboard-focused) row. */
  active: boolean;
  /** Activate (open) this row. */
  onActivate: () => void;
  /** Attributes that the renderer must spread onto its semantic `role="row"` element. */
  rowProps: ListViewRowProps;
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
  /**
   * Stable key for one presentation mode whose scroll, collapse, and active-row state should be
   * restored when that mode returns. Use a small bounded set of keys such as `browse` and `search`.
   */
  stateKey?: string | undefined;
  /** The flat list of items to group, sub-group, and render. */
  items: readonly TItem[];
  /** Partition items into top-level groups; omit it for one flat virtualized list. */
  groupBy?: ((item: TItem) => GroupKey | null) | null | undefined;
  /** Optionally partition each group into sub-groups; omit for single-level grouping. */
  subGroupBy?: ((item: TItem) => GroupKey | null) | undefined;
  /** Render one data row. */
  renderRow: (item: TItem, ctx: RenderRowContext) => React.ReactNode;
  /** Stable React key for an item; falls back to the item's flat index when omitted. */
  getItemKey?: ((item: TItem) => string) | undefined;
  /** Controlled set of collapsed bucket ids (group id or `${groupId}/${subGroupId}`). */
  collapsed?: ReadonlySet<string> | undefined;
  /** Toggle a bucket's collapse state (controlled mode). */
  onToggle?: ((bucketId: string) => void) | undefined;
  /** Initial collapsed bucket ids for uncontrolled mode. */
  defaultCollapsed?: Iterable<string> | undefined;
  /** Activate (open) a data item (Enter / click). */
  onActivateItem?: ((item: TItem) => void) | undefined;
  /**
   * Estimated pixel height of a single row; drives virtualization. Defaults to the active
   * density's row height (32 / 36 / 44 for compact / comfortable / spacious), mirroring the
   * `--row-h` CSS variable the row components consume.
   */
  rowHeight?: number | undefined;
  /** Accessible label for the grid. */
  label?: string | undefined;
  /** Extra classes merged onto the scroll container. */
  className?: string | undefined;
}
