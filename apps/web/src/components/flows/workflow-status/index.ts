/**
 * Workflow status visualization components.
 *
 * Provides a visual editor for task status workflows showing:
 * - Status nodes organized by category
 * - Swim lane layout (Not Started → In Progress → Done → Cancelled)
 * - Status transitions
 *
 * @packageDocumentation
 */

export { WorkflowStatusFlow } from './WorkflowStatusFlow';
export type { WorkflowStatusFlowProps } from './WorkflowStatusFlow';

export { StatusNode } from './StatusNode';
export type { StatusNodeData, StatusNodeType } from './StatusNode';

export { useWorkflowGraph, CATEGORY_ORDER } from './useWorkflowGraph';
