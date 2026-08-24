'use client';

/** Synchronize xyflow node selection with Athena's shared object-selection surface. */
import { type Node, useOnSelectionChange, useReactFlow, useStore } from '@xyflow/react';
import { useCallback, useEffect, useMemo } from 'react';

import { useSelection } from '@/components/selection';
import { objectKey, type ObjectKind } from '@/lib/actions';

const TASK_NODE_TYPES = ['task', 'taskBranch'] as const;

/** Props for {@link CanvasSelectionBridge}. */
export interface CanvasSelectionBridgeProps {
  /** Object kind represented by the accepted node types. Defaults to Task for existing callers. */
  readonly objectKind?: ObjectKind;
  /** Xyflow node types that represent selectable objects rather than groups. */
  readonly nodeTypes?: readonly string[];
  /** Optional observer for host-specific canvas gestures. */
  readonly onChange?: (nodes: readonly Node[]) => void;
  /** Object created by a composer and awaiting canvas selection. */
  readonly requestedSelectionId?: string | null;
  /** Whether the host's current structural node set contains the requested object. */
  readonly requestedSelectionReady?: boolean;
  /** Report after shared and xyflow selection both contain the requested object. */
  readonly onRequestedSelectionApplied?: (node: Node) => void;
}

/** Publish xyflow selection through the same registry used by lists and context menus. */
export default function CanvasSelectionBridge({
  objectKind = 'task',
  nodeTypes = TASK_NODE_TYPES,
  onChange,
  requestedSelectionId,
  requestedSelectionReady = true,
  onRequestedSelectionApplied,
}: CanvasSelectionBridgeProps): null {
  const { dispatch, selectedKeys } = useSelection();
  const { getNode, setNodes } = useReactFlow();
  const acceptedTypes = useMemo(() => new Set(nodeTypes), [nodeTypes]);
  const requestedNodeInStore = useStore(
    useCallback(
      (state) =>
        requestedSelectionId !== null &&
        requestedSelectionId !== undefined &&
        state.nodeLookup.has(requestedSelectionId),
      [requestedSelectionId],
    ),
  );
  useOnSelectionChange({
    onChange: useCallback(
      ({ nodes }: { nodes: Node[] }) => {
        const objectNodes = nodes.filter(
          ({ type }) => type !== undefined && acceptedTypes.has(type),
        );
        dispatch({
          type: 'set',
          keys: objectNodes.map(({ id }) => objectKey({ kind: objectKind, id })),
        });
        onChange?.(objectNodes);
      },
      [acceptedTypes, dispatch, objectKind, onChange],
    ),
  });
  useEffect(() => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.type === undefined || !acceptedTypes.has(node.type)) return node;
        const selected = selectedKeys.has(objectKey({ kind: objectKind, id: node.id }));
        return node.selected === selected ? node : { ...node, selected };
      }),
    );
  }, [acceptedTypes, objectKind, selectedKeys, setNodes]);
  useEffect(() => {
    if (
      !requestedSelectionReady ||
      !requestedNodeInStore ||
      requestedSelectionId === null ||
      requestedSelectionId === undefined
    ) {
      return;
    }
    const node = getNode(requestedSelectionId);
    if (node?.type === undefined || !acceptedTypes.has(node.type)) return;
    dispatch({
      type: 'set',
      keys: [objectKey({ kind: objectKind, id: requestedSelectionId })],
    });
    setNodes((nodes) =>
      nodes.map((candidate) => {
        if (candidate.type === undefined || !acceptedTypes.has(candidate.type)) return candidate;
        const selected = candidate.id === requestedSelectionId;
        return candidate.selected === selected ? candidate : { ...candidate, selected };
      }),
    );
    onChange?.([node]);
    onRequestedSelectionApplied?.(node);
  }, [
    acceptedTypes,
    dispatch,
    getNode,
    objectKind,
    onChange,
    onRequestedSelectionApplied,
    requestedSelectionId,
    requestedSelectionReady,
    requestedNodeInStore,
    setNodes,
  ]);
  return null;
}
