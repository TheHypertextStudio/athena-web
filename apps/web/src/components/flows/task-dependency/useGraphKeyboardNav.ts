'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { TaskNodeType } from './TaskNode';
import type { DependencyEdgeType } from './DependencyEdge';
import { useSelection } from '@/components/objects/context/SelectionContext';
import type { SurfaceId } from '@/components/objects/types';

interface UseGraphKeyboardNavOptions {
  nodes: TaskNodeType[];
  edges: DependencyEdgeType[];
  topologicalOrder: string[];
  surfaceId: SurfaceId;
  /** Called when Enter/Space is pressed on focused node */
  onActivate?: (nodeId: string, position: { x: number; y: number }) => void;
  /** Whether keyboard navigation is enabled */
  enabled?: boolean;
}

interface UseGraphKeyboardNavReturn {
  /** Currently keyboard-focused node ID */
  focusedId: string | null;
  /** Set the focused node */
  setFocusedId: (id: string | null) => void;
  /** Key down handler to attach to the flow container */
  handleKeyDown: (event: React.KeyboardEvent) => void;
  /** Whether the graph has keyboard focus */
  hasFocus: boolean;
  /** Set whether the graph has focus */
  setHasFocus: (hasFocus: boolean) => void;
}

/**
 * Hook for keyboard navigation in the task dependency graph.
 *
 * Provides:
 * - Tab/Shift+Tab navigation in topological order
 * - Arrow key navigation based on visual position
 * - Enter/Space to activate (open context menu)
 * - Escape to clear selection
 * - Cmd/Ctrl+A to select all
 */
export function useGraphKeyboardNav({
  nodes,
  topologicalOrder,
  surfaceId,
  onActivate,
  enabled = true,
}: UseGraphKeyboardNavOptions): UseGraphKeyboardNavReturn {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const { getNodes, setCenter } = useReactFlow();
  const { select, toggle, selectAll, clear } = useSelection();

  // Map node positions for arrow key navigation
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      positions.set(node.id, node.position);
    }
    return positions;
  }, [nodes]);

  // Find nearest node in a direction
  const findNearestNode = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right'): string | null => {
      if (!focusedId) return topologicalOrder[0] ?? null;

      const currentPos = nodePositions.get(focusedId);
      if (!currentPos) return null;

      let bestId: string | null = null;
      let bestDistance = Infinity;

      for (const [nodeId, pos] of nodePositions) {
        if (nodeId === focusedId) continue;

        const dx = pos.x - currentPos.x;
        const dy = pos.y - currentPos.y;

        // Check if node is in the right direction
        let isInDirection = false;
        switch (direction) {
          case 'up':
            isInDirection = dy < -20;
            break;
          case 'down':
            isInDirection = dy > 20;
            break;
          case 'left':
            isInDirection = dx < -20;
            break;
          case 'right':
            isInDirection = dx > 20;
            break;
        }

        if (!isInDirection) continue;

        // Calculate distance with a preference for the primary direction
        let distance: number;
        if (direction === 'up' || direction === 'down') {
          distance = Math.abs(dy) + Math.abs(dx) * 0.5;
        } else {
          distance = Math.abs(dx) + Math.abs(dy) * 0.5;
        }

        if (distance < bestDistance) {
          bestDistance = distance;
          bestId = nodeId;
        }
      }

      return bestId;
    },
    [focusedId, nodePositions, topologicalOrder],
  );

  // Navigate in topological order
  const navigateTopological = useCallback(
    (direction: 'next' | 'prev') => {
      if (topologicalOrder.length === 0) return;

      if (!focusedId) {
        // Start at first or last node
        const idx = direction === 'next' ? 0 : topologicalOrder.length - 1;
        setFocusedId(topologicalOrder[idx] ?? null);
        return;
      }

      const currentIdx = topologicalOrder.indexOf(focusedId);
      if (currentIdx === -1) {
        setFocusedId(topologicalOrder[0] ?? null);
        return;
      }

      const nextIdx =
        direction === 'next'
          ? Math.min(currentIdx + 1, topologicalOrder.length - 1)
          : Math.max(currentIdx - 1, 0);

      setFocusedId(topologicalOrder[nextIdx] ?? null);
    },
    [focusedId, topologicalOrder],
  );

  // Center viewport on focused node
  useEffect(() => {
    if (!focusedId || !hasFocus) return undefined;

    const pos = nodePositions.get(focusedId);
    if (!pos) return undefined;

    // Use ReactFlow's setCenter with a slight delay for smooth animation
    const timer = setTimeout(() => {
      setCenter(pos.x + 100, pos.y + 50, { duration: 200, zoom: 1 }).catch(() => undefined);
    }, 50);
    return () => {
      clearTimeout(timer);
    };
  }, [focusedId, hasFocus, nodePositions, setCenter]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!enabled || !hasFocus) return;

      const isMeta = event.metaKey || event.ctrlKey;

      const focusNearest = (direction: 'up' | 'down' | 'left' | 'right') => {
        const nextNode = findNearestNode(direction);
        if (nextNode) setFocusedId(nextNode);
      };

      switch (event.key) {
        case 'Tab':
          event.preventDefault();
          navigateTopological(event.shiftKey ? 'prev' : 'next');
          break;

        case 'ArrowUp':
          event.preventDefault();
          focusNearest('up');
          break;

        case 'ArrowDown':
          event.preventDefault();
          focusNearest('down');
          break;

        case 'ArrowLeft':
          event.preventDefault();
          focusNearest('left');
          break;

        case 'ArrowRight':
          event.preventDefault();
          focusNearest('right');
          break;

        case 'Enter':
        case ' ':
          event.preventDefault();
          if (focusedId) {
            // Select the focused node
            if (isMeta) {
              toggle(focusedId, surfaceId);
            } else {
              select(focusedId, surfaceId);
            }

            // Trigger activation callback (e.g., open context menu)
            if (onActivate) {
              const pos = nodePositions.get(focusedId);
              if (pos) {
                // Get screen position from flow
                const flowNodes = getNodes();
                const node = flowNodes.find((n) => n.id === focusedId);
                if (node) {
                  onActivate(focusedId, {
                    x: node.position.x + 140,
                    y: node.position.y + 40,
                  });
                }
              }
            }
          }
          break;

        case 'Escape':
          event.preventDefault();
          clear();
          setFocusedId(null);
          break;

        case 'a':
        case 'A':
          if (isMeta) {
            event.preventDefault();
            selectAll(topologicalOrder, surfaceId);
          }
          break;
      }
    },
    [
      enabled,
      hasFocus,
      navigateTopological,
      findNearestNode,
      focusedId,
      toggle,
      select,
      surfaceId,
      onActivate,
      nodePositions,
      getNodes,
      clear,
      selectAll,
      topologicalOrder,
    ],
  );

  return {
    focusedId,
    setFocusedId,
    handleKeyDown,
    hasFocus,
    setHasFocus,
  };
}
