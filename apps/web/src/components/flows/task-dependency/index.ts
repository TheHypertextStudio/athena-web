/**
 * Task dependency graph visualization components.
 *
 * Provides interactive visualization of task dependencies showing:
 * - Blocking chains between tasks
 * - Task status and priority at a glance
 * - Critical path through dependent work
 *
 * @packageDocumentation
 */

export { TaskDependencyFlow } from './TaskDependencyFlow';
export type { TaskDependencyFlowProps } from './TaskDependencyFlow';

export { ProjectTaskGraphSurface } from './ProjectTaskGraphSurface';
export type { ProjectTaskGraphSurfaceProps } from './ProjectTaskGraphSurface';

export { TaskNode } from './TaskNode';
export type { TaskNodeData, TaskNodeType } from './TaskNode';

export { TaskNodeContextMenu } from './TaskNodeContextMenu';
export type { TaskNodeContextMenuProps } from './TaskNodeContextMenu';

export { DependencyEdge } from './DependencyEdge';
export type { DependencyEdgeData, DependencyEdgeType } from './DependencyEdge';

export { useDependencyGraph, dependencyKeys } from './useDependencyGraph';
export { useGraphKeyboardNav } from './useGraphKeyboardNav';
