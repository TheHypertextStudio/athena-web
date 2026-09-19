'use client';

/**
 * `components/plan-canvas/plan-canvas-context` — the element-level actions plan nodes call.
 *
 * @remarks
 * Node renderers are memoised and know nothing about the plan document; the panel owns the
 * document and hands these verbs down. Every verb is a reducer op in disguise, which keeps a node
 * from ever needing the query layer.
 */
import { createContext, useContext } from 'react';

/** What a node or edge on the plan canvas may ask the panel to do. */
export interface PlanCanvasActions {
  /** Whether the viewer may edit the draft. */
  readonly canEdit: boolean;
  /** Add a draft project under an initiative and select it. */
  readonly addProject: (initiativeRef: string) => void;
  /** Add a draft task inside a project and select it. */
  readonly addTask: (projectRef: string) => void;
  /** Add a draft subtask under a feature task and select it. */
  readonly addSubtask: (taskRef: string) => void;
  /** Show or hide a container's task rows. */
  readonly toggleTasks: (projectRef: string) => void;
  /** Fold or unfold a feature task's subtasks. */
  readonly toggleSubtasks: (taskRef: string) => void;
  /** Remove a dependency edge (`blocking → blocked`). */
  readonly removeDependency: (fromRef: string, toRef: string) => void;
  /** Open a confirmed node's real record. */
  readonly open: (href: string) => void;
}

const PlanCanvasActionsContext = createContext<PlanCanvasActions | null>(null);

/** Provide the plan canvas actions to the nodes beneath. */
export const PlanCanvasActionsProvider = PlanCanvasActionsContext.Provider;

/** Read the plan canvas actions, or null outside a plan canvas. */
export function usePlanCanvasActions(): PlanCanvasActions | null {
  return useContext(PlanCanvasActionsContext);
}
