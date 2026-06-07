'use client';

/**
 * `@docket/ui` — the top-level group boundary renderer.
 *
 * @remarks
 * A thin, semantic wrapper over {@link GroupHeader} fixed at nesting level `0`, used by the
 * {@link ListView} to render a primary group boundary (e.g. one project, or the
 * `No project / Triage` bucket). Kept distinct from {@link ListSubGroup} so the two
 * boundary kinds are explicit at the call site and can diverge in styling later.
 */
import * as React from 'react';

import { GroupHeader } from './GroupHeader';

/** Props for {@link ListGroup}. */
export interface ListGroupProps {
  /** The display-ready group label (already vocabulary-resolved). */
  label: string;
  /** Whether the group is expanded. */
  expanded: boolean;
  /** Toggle the group's collapse state. */
  onToggle: () => void;
  /** Optional number of rows in the group, rendered as a trailing count. */
  count?: number;
  /** Optional leading decoration (e.g. a project glyph). */
  decoration?: React.ReactNode;
  /** Extra classes merged onto the header row. */
  className?: string;
}

/**
 * Render a top-level (level `0`) collapsible group boundary.
 *
 * @remarks
 * Delegates to {@link GroupHeader}; see it for the `role="row"` / `aria-expanded`
 * accessibility contract.
 */
export function ListGroup({
  label,
  expanded,
  onToggle,
  count,
  decoration,
  className,
}: ListGroupProps): React.JSX.Element {
  return (
    <GroupHeader
      label={label}
      expanded={expanded}
      onToggle={onToggle}
      count={count}
      decoration={decoration}
      level={0}
      className={className}
    />
  );
}
