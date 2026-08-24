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
  /**
   * Move a task into or out of its workspace's completed status.
   *
   * @remarks
   * Deliberately a *verb* rather than `setState(id, key)`: every caller here means "finish this"
   * or "reopen it", and each one used to spell that as the literal keys `done` and `todo`. Those
   * keys belong to the workspace, not to the canvas, so the host resolves them once from the
   * status registry and the elements ask for the outcome they want.
   */
  setComplete: (id: string, complete: boolean) => void;
  /** Create a subtask under a task. */
  createSubtask: (parentId: string, title: string) => void;
  /** Remove the dependency between two tasks (`blocking → blocked`). */
  removeDependency: (sourceId: string, targetId: string) => void;
}

const CanvasActionsContext = createContext<CanvasActions | null>(null);

/** Provides {@link CanvasActions} to the nodes rendered below. */
export const CanvasActionsProvider = CanvasActionsContext.Provider;

/** Read the host's {@link CanvasActions}, or null when none is provided (read-only). */
export function useCanvasActions(): CanvasActions | null {
  return useContext(CanvasActionsContext);
}
