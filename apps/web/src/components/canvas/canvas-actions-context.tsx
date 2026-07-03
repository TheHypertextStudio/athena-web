'use client';

/**
 * `components/canvas/canvas-actions-context` — node-level actions for the per-node toolbar.
 *
 * @remarks
 * `task-node` is rendered deep inside `<ReactFlow>` (via `nodeTypes`), so its hover `NodeToolbar`
 * can't receive host callbacks as props. Rather than smuggle functions through node `data`, the
 * host provides them once through context; the node reads them with {@link useCanvasActions}. When
 * no provider is present (a read-only embed), actions are absent and the toolbar hides its edit
 * affordances.
 */
import { createContext, useContext } from 'react';

/** The actions a node's toolbar can invoke on the host. */
export interface CanvasActions {
  /** Whether the viewer may edit (gates the toolbar's write affordances). */
  canEdit: boolean;
  /** Navigate to a task's detail page. */
  navigate: (id: string) => void;
  /** Set a task's workflow state. */
  setState: (id: string, state: string) => void;
  /** Create a subtask under a task. */
  createSubtask: (parentId: string, title: string) => void;
}

const CanvasActionsContext = createContext<CanvasActions | null>(null);

/** Provides {@link CanvasActions} to the nodes rendered below. */
export const CanvasActionsProvider = CanvasActionsContext.Provider;

/** Read the host's {@link CanvasActions}, or null when none is provided (read-only). */
export function useCanvasActions(): CanvasActions | null {
  return useContext(CanvasActionsContext);
}
