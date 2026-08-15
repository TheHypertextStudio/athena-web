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
  return (
    <div className="relative size-full bg-transparent" data-testid="task-branch">
      <TaskHierarchyRails
        childYs={data.hierarchyChildYs ?? []}
        cardWidth={card.width}
        cardHeight={card.height}
      />
      <TaskNode {...props} />
    </div>
  );
}

/** Memoized compound task node. */
const TaskBranchNode = memo(TaskBranchNodeComponent);
export default TaskBranchNode;
