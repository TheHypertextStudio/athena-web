'use client';

/**
 * `components/canvas/group-node` — the swimlane container rendered behind its member tasks.
 *
 * @remarks
 * A non-interactive, hairline lane with a labeled header, sized by {@link layoutGrouped}. It sits
 * at a negative `zIndex` so task nodes and edges draw on top. Colors come from the surface tokens.
 */
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

/** The data a {@link GroupNode} renders. */
interface GroupNodeData extends Record<string, unknown> {
  /** The lane label. */
  label: string;
}

/** A swimlane container node. */
function GroupNodeComponent({ data }: NodeProps): React.JSX.Element {
  const { label } = data as GroupNodeData;
  return (
    <div className="border-outline-variant bg-surface-container-low/50 size-full rounded-xl border">
      <div className="text-on-surface-variant truncate px-3 py-1.5 text-xs font-medium">
        {label}
      </div>
    </div>
  );
}

/** Memoized container node. */
const GroupNode = memo(GroupNodeComponent);
export default GroupNode;
