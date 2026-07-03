'use client';

/**
 * `components/canvas/use-graph-interactions` — the editing handlers for `<ReactFlow>`.
 *
 * @remarks
 * Encapsulates every edit gesture as xyflow handlers so `Canvas` just spreads the result: drag
 * between handles to create a dependency (`onConnect` + `isValidConnection`), select an edge and
 * press Delete to remove it (`onBeforeDelete` drops subtask edges + nodes, `onEdgesDelete`), and
 * drag a subtask edge's parent end to reparent (`onReconnect`). The host supplies intent callbacks;
 * the server remains the cycle/duplicate authority.
 */
import {
  type Connection,
  type Edge,
  type Node,
  type OnBeforeDelete,
  useReactFlow,
} from '@xyflow/react';
import { useCallback } from 'react';

/** The intent callbacks the host wires to its mutations. */
export interface GraphInteractionHandlers {
  /** Create a `blocking → blocked` dependency edge. */
  onConnectEdge?: (source: string, target: string) => void;
  /** Remove a dependency edge. */
  onDeleteEdge?: (edge: Edge) => void;
  /** Reparent a subtask edge's child under a new parent: `(childId, newParentId)`. */
  onReparentEdge?: (childId: string, newParentId: string) => void;
}

/** The xyflow props this hook produces (spread onto `<ReactFlow>`). */
export interface GraphInteractionProps {
  isValidConnection: (c: Connection | Edge) => boolean;
  onConnect: (c: Connection) => void;
  onBeforeDelete: OnBeforeDelete;
  onEdgesDelete: (edges: Edge[]) => void;
  onReconnect: (oldEdge: Edge, newConnection: Connection) => void;
}

/** The `kind` discriminator carried on every edge's `data` (one place for the cast). */
export function edgeKind(edge: Edge): string | undefined {
  return (edge.data as { kind?: string }).kind;
}

/**
 * Build the xyflow editing handlers from the host's intent callbacks.
 *
 * @param handlers - The host's create/delete/reparent callbacks.
 * @returns props to spread onto `<ReactFlow>`.
 */
export function useGraphInteractions(handlers: GraphInteractionHandlers): GraphInteractionProps {
  const { onConnectEdge, onDeleteEdge, onReparentEdge } = handlers;
  const { getEdges } = useReactFlow();

  const isValidConnection = useCallback(
    (c: Connection | Edge): boolean => {
      if (c.source === c.target) return false;
      // The server owns the cycle/duplicate check; reject only obvious no-ops (exact duplicate).
      return !getEdges().some((e) => e.source === c.source && e.target === c.target);
    },
    [getEdges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source !== c.target) onConnectEdge?.(c.source, c.target);
    },
    [onConnectEdge],
  );

  // Only dependency edges are deletable (subtask edges reparent instead); nodes never delete.
  const onBeforeDelete = useCallback<OnBeforeDelete>(async ({ edges: toDelete }) => {
    const deletable = toDelete.filter((e) => edgeKind(e) !== 'subtask');
    if (deletable.length === 0) return false;
    return { nodes: [] as Node[], edges: deletable };
  }, []);

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) onDeleteEdge?.(e);
    },
    [onDeleteEdge],
  );

  // Dragging a subtask edge's parent end to another node reparents the child under it.
  const onReconnect = useCallback(
    (oldEdge: Edge, conn: Connection) => {
      if (edgeKind(oldEdge) !== 'subtask') return;
      const child = oldEdge.target;
      const newParent = conn.source;
      if (newParent !== child) onReparentEdge?.(child, newParent);
    },
    [onReparentEdge],
  );

  return { isValidConnection, onConnect, onBeforeDelete, onEdgesDelete, onReconnect };
}
