'use client';

/** Synchronize xyflow node selection with Athena's shared object-selection surface. */
import { type Node, useOnSelectionChange, useReactFlow } from '@xyflow/react';
import { useCallback, useEffect } from 'react';

import { useSelection } from '@/components/selection';
import { objectKey } from '@/lib/actions';

/** Props for {@link CanvasSelectionBridge}. */
export interface CanvasSelectionBridgeProps {
  /** Optional observer for task-specific canvas gestures. */
  readonly onChange?: (nodes: readonly Node[]) => void;
}

/** Publish xyflow selection through the same registry used by lists and context menus. */
export default function CanvasSelectionBridge({ onChange }: CanvasSelectionBridgeProps): null {
  const { dispatch, selectedKeys } = useSelection();
  const { setNodes } = useReactFlow();
  useOnSelectionChange({
    onChange: useCallback(
      ({ nodes }: { nodes: Node[] }) => {
        const taskNodes = nodes.filter(({ type }) => type === 'task' || type === 'taskBranch');
        dispatch({
          type: 'set',
          keys: taskNodes.map(({ id }) => objectKey({ kind: 'task', id })),
        });
        onChange?.(taskNodes);
      },
      [dispatch, onChange],
    ),
  });
  useEffect(() => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.type !== 'task' && node.type !== 'taskBranch') return node;
        const selected = selectedKeys.has(objectKey({ kind: 'task', id: node.id }));
        return node.selected === selected ? node : { ...node, selected };
      }),
    );
  }, [selectedKeys, setNodes]);
  return null;
}
