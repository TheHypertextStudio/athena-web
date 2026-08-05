'use client';

/**
 * `components/canvas/canvas-actions-context` — element-level actions for nodes and edges.
 *
 * @remarks
 * `task-node` and `dependency-edge` are rendered deep inside `<ReactFlow>` (via `nodeTypes` /
 * `edgeTypes`), so neither can receive host callbacks as props. Rather than smuggle functions
 * through element `data`, the host provides them once through context; the element reads them with
 * {@link useCanvasActions}. When no provider is present (a read-only embed), actions are absent and
 * every write affordance hides itself.
 */
import { createContext, useContext } from 'react';

/** The actions a node's toolbar or an edge's controls can invoke on the host. */
export interface CanvasActions {
  /** Whether the viewer may edit (gates every write affordance). */
  canEdit: boolean;
  /** Navigate to a task's detail page. */
  navigate: (id: string) => void;
  /** Set a task's workflow state. */
  setState: (id: string, state: string) => void;
  /** Create a subtask under a task. */
  createSubtask: (parentId: string, title: string) => void;
  /** Remove the dependency between two tasks (`blocking → blocked`). */
  removeDependency: (sourceId: string, targetId: string) => void;
  /** Flip which of two tasks blocks the other. */
  reverseDependency: (sourceId: string, targetId: string) => void;
}

const CanvasActionsContext = createContext<CanvasActions | null>(null);

/** Provides {@link CanvasActions} to the nodes rendered below. */
export const CanvasActionsProvider = CanvasActionsContext.Provider;

/** Read the host's {@link CanvasActions}, or null when none is provided (read-only). */
export function useCanvasActions(): CanvasActions | null {
  return useContext(CanvasActionsContext);
}
