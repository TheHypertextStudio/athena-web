/**
 * Flow visualization components using ReactFlow (xyflow).
 *
 * This module provides reusable components for:
 * - Task dependency graphs
 * - Project roadmaps
 * - Workflow status builders
 *
 * @packageDocumentation
 */

// Core components
export { FlowSurface } from './FlowSurface';
export type { FlowSurfaceProps } from './FlowSurface';

// Task Dependency Graph
export {
  TaskDependencyFlow,
  TaskNode,
  DependencyEdge,
  useDependencyGraph,
  dependencyKeys,
} from './task-dependency';
export type {
  TaskDependencyFlowProps,
  TaskNodeData,
  TaskNodeType,
  DependencyEdgeData,
  DependencyEdgeType,
} from './task-dependency';

// Project Roadmap
export {
  ProjectRoadmapFlow,
  InitiativeNode,
  ProjectNode,
  TimelineEdge,
  useRoadmapGraph,
  roadmapKeys,
} from './project-roadmap';
export type {
  ProjectRoadmapFlowProps,
  InitiativeNodeData,
  InitiativeNodeType,
  ProjectNodeData,
  ProjectNodeType,
  TimelineEdgeData,
  TimelineEdgeType,
} from './project-roadmap';

// Workflow Status Builder
export {
  WorkflowStatusFlow,
  StatusNode,
  useWorkflowGraph,
  CATEGORY_ORDER,
} from './workflow-status';
export type { WorkflowStatusFlowProps, StatusNodeData, StatusNodeType } from './workflow-status';

// Shared utilities
export { FlowBackground } from './shared/FlowBackground';
export { FlowControls } from './shared/FlowControls';
export { FlowMinimap } from './shared/FlowMinimap';
export {
  getLayoutedElements,
  getGraphBounds,
  groupNodesByCategory,
  getSwimLaneLayout,
} from './shared/layout-utils';
export type { LayoutOptions } from './shared/layout-utils';
