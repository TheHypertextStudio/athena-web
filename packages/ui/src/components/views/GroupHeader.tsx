'use client';

/**
 * `@docket/ui` — the collapsible group/sub-group header row.
 *
 * @remarks
 * Renders a single boundary row inside the virtualized {@link ListView}: a chevron
 * disclosure, the group label, and an optional count badge. It carries `role="row"` so it
 * lives in the same `role="grid"` as the data rows, plus `aria-expanded` reflecting the
 * collapse state so assistive tech can announce and toggle the group. Activating the header
 * (click, Enter, or Space) calls `onToggle`.
 *
 * Both {@link ListGroup} and {@link ListSubGroup} render through this component; `level`
 * adjusts the indentation so nested sub-groups read as subordinate.
 */
import * as React from 'react';

import { ChevronDown, ChevronRight } from '../../icons';
import { cn } from '../../lib/utils';

/** Props for {@link GroupHeader}. */
export interface GroupHeaderProps {
  /** The display-ready group label (entity labels must already be vocabulary-resolved). */
  label: string;
  /** Whether the group is expanded (its descendants are rendered). */
  expanded: boolean;
  /** Toggle the group's collapse state. */
  onToggle: () => void;
  /** Optional number of rows in the group, rendered as a trailing count. */
  count?: number;
  /** Nesting depth: `0` for a top-level group, `1` for a sub-group. Defaults to `0`. */
  level?: number;
  /** Optional leading decoration rendered between the chevron and the label (e.g. a StatusIcon). */
  decoration?: React.ReactNode;
  /** Extra classes merged onto the header row. */
  className?: string;
}

/**
 * A collapsible boundary header for a {@link ListGroup} or {@link ListSubGroup}.
 *
 * @remarks
 * The header is keyboard-operable on its own (Enter/Space) in addition to the grid-level
 * navigation provided by `useListKeyboard`.
 */
export function GroupHeader({
  label,
  expanded,
  onToggle,
  count,
  level = 0,
  decoration,
  className,
}: GroupHeaderProps): React.JSX.Element {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      role="row"
      aria-expanded={expanded}
      data-level={level}
      className={cn(
        'border-outline-variant bg-surface-container text-on-surface hover:bg-surface-container-high flex h-full w-full cursor-pointer items-center gap-1.5 border-b px-3 text-sm font-medium transition-colors select-none',
        className,
      )}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      style={level > 0 ? { paddingLeft: `${String(level * 1.25 + 0.5)}rem` } : undefined}
    >
      <Chevron aria-hidden="true" className="text-on-surface-variant h-4 w-4 shrink-0" />
      {decoration ? <span className="flex shrink-0 items-center">{decoration}</span> : null}
      <span className="truncate">{label}</span>
      {typeof count === 'number' ? (
        <span className="text-on-surface-variant ml-1 shrink-0 text-xs font-normal tabular-nums">
          {count}
        </span>
      ) : null}
    </div>
  );
}
