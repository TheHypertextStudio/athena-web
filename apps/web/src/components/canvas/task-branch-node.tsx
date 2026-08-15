'use client';

/** Transparent xyflow compound node containing one task header and its descendant bounds. */
import { type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import TaskNode, { type TaskNodeData } from './task-node';
import { TaskHierarchyRails } from './task-hierarchy-rails';
import { NODE_SIZE } from './use-dagre-layout';

interface TaskBranchNodeData extends TaskNodeData {
  /** Vertical centers of direct children relative to this branch. */
  hierarchyChildYs?: readonly number[];
}

/** Render hierarchy structure while keeping the task itself an ordinary card. */
function TaskBranchNodeComponent(props: NodeProps): React.JSX.Element {
  const data = props.data as TaskBranchNodeData;
  const card = NODE_SIZE[data.density];
  const childYs = data.hierarchyChildYs ?? [];
  const previewCount =
    typeof data['hierarchyPreviewCount'] === 'number' ? data['hierarchyPreviewCount'] : 0;
  const previewY = Math.max(
    card.height + 16,
    (childYs.at(-1) ?? card.height) + card.height / 2 + 10,
  );
  return (
    <div className="relative size-full bg-transparent" data-testid="task-branch">
      <TaskHierarchyRails
        childYs={previewCount > 0 ? [...childYs, previewY + card.height / 2] : childYs}
        cardWidth={card.width}
        cardHeight={card.height}
      />
      <TaskNode {...props} />
      {previewCount > 0 ? (
        <div
          aria-hidden="true"
          className="border-primary bg-primary/8 text-primary text-label-medium pointer-events-none absolute left-12 flex items-center rounded-xl border border-dashed px-3 opacity-80"
          style={{ top: previewY, width: card.width, height: card.height }}
        >
          {previewCount === 1 ? 'Move task here' : `Move ${previewCount} task branches here`}
        </div>
      ) : null}
    </div>
  );
}

/** Memoized compound task node. */
const TaskBranchNode = memo(TaskBranchNodeComponent);
export default TaskBranchNode;
