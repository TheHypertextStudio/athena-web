'use client';

/**
 * `@docket/ui` — the second-level sub-group boundary renderer.
 *
 * @remarks
 * A thin, semantic wrapper over {@link GroupHeader} fixed at nesting level `1`, used by the
 * {@link ListView} to render a sub-group boundary nested beneath a {@link ListGroup} (e.g.
 * tasks grouped by project, then sub-grouped by workflow state). A `stateType` may be
 * supplied so the sub-group header shows the matching {@link StatusIcon} decoration when the
 * sub-grouping is by workflow state.
 */
import * as React from 'react';

import { StatusIcon, type WorkflowStateType } from '../atoms/StatusIcon';
import { GroupHeader } from './GroupHeader';

/** Props for {@link ListSubGroup}. */
export interface ListSubGroupProps {
  /** The display-ready sub-group label (already vocabulary-resolved). */
  label: string;
  /** Whether the sub-group is expanded. */
  expanded: boolean;
  /** Toggle the sub-group's collapse state. */
  onToggle: () => void;
  /** Optional number of rows in the sub-group, rendered as a trailing count. */
  count?: number;
  /**
   * When the sub-grouping is by workflow state, the canonical type for this sub-group;
   * renders a {@link StatusIcon} as the header decoration.
   */
  stateType?: WorkflowStateType;
  /** Optional explicit decoration; overrides the {@link StatusIcon} derived from `stateType`. */
  decoration?: React.ReactNode;
  /** Extra classes merged onto the header row. */
  className?: string;
}

/**
 * Render a second-level (level `1`) collapsible sub-group boundary.
 *
 * @remarks
 * Delegates to {@link GroupHeader} at `level={1}` for the indented styling and the shared
 * `role="row"` / `aria-expanded` contract.
 */
export function ListSubGroup({
  label,
  expanded,
  onToggle,
  count,
  stateType,
  decoration,
  className,
}: ListSubGroupProps): React.JSX.Element {
  const resolvedDecoration =
    decoration ?? (stateType ? <StatusIcon type={stateType} label={label} /> : undefined);
  return (
    <GroupHeader
      label={label}
      expanded={expanded}
      onToggle={onToggle}
      count={count}
      decoration={resolvedDecoration}
      level={1}
      className={className}
    />
  );
}
