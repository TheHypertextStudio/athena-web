'use client';

/**
 * A list whose rows are tonal segments of one container: MD3 Expressive's segmented list.
 *
 * @remarks
 * Each row is its own `card`-tone surface, 2px from the next, so the rows read as one group and
 * each row still reads as a thing of its own. The group's outer corners are MD3's `corner-lg`
 * (16px) and the joins between rows are `corner-xs` (4px), the connected-shape treatment MD3
 * Expressive gives grouped list items. Hover and focus lift a row one tonal step. No border,
 * divider, or shadow is drawn (`docs/design/references/detail-page-layout.md`, rule 4).
 */
import { cn } from '@docket/ui/lib/utils';
import { surfaceToneColor } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import type { RelationDropTargetProps } from '@/components/dnd/use-relation-drop-target';

/** The corners and state layer every segment carries. */
const SEGMENT_CLASS = cn(
  'rounded-corner-xs first:rounded-t-corner-lg last:rounded-b-corner-lg',
  'hover:bg-surface-container-high focus-within:bg-surface-container-high transition-colors',
);

/**
 * The list container.
 *
 * @param props - The segments.
 * @returns the `ul`.
 */
export function SegmentedList({ children }: { readonly children: ReactNode }): JSX.Element {
  return <ul className="flex flex-col gap-0.5">{children}</ul>;
}

/** Props for {@link SegmentedListItem}. */
export interface SegmentedListItemProps {
  readonly children: ReactNode;
  /** Make the segment a drop destination (see `useRelationDropTarget`). */
  readonly drop?: RelationDropTargetProps | undefined;
}

/**
 * One segment: a 44px row on the `card` tone.
 *
 * @param props - See {@link SegmentedListItemProps}.
 * @returns the `li`.
 */
export function SegmentedListItem({ children, drop }: SegmentedListItemProps): JSX.Element {
  return (
    <li
      ref={drop?.ref}
      data-drop-state={drop?.['data-drop-state']}
      data-surface-tone="card"
      className={cn(
        surfaceToneColor('card'),
        SEGMENT_CLASS,
        'group/segment relative flex min-h-11 min-w-0 items-center gap-3 px-3',
        drop?.className,
      )}
    >
      {children}
    </li>
  );
}
