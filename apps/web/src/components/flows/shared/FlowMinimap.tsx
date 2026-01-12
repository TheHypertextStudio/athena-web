'use client';

import { MiniMap } from '@xyflow/react';

interface FlowMinimapProps {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pannable?: boolean;
  zoomable?: boolean;
}

/**
 * Styled minimap for ReactFlow graphs.
 * Shows overview of the entire graph with current viewport.
 */
export function FlowMinimap({
  position = 'bottom-left',
  pannable = true,
  zoomable = true,
}: FlowMinimapProps) {
  return (
    <MiniMap
      position={position}
      pannable={pannable}
      zoomable={zoomable}
      className="!bg-surface-container !border-outline-variant !rounded-xl !shadow-md"
      maskColor="rgba(0, 0, 0, 0.1)"
      nodeColor={(node) => {
        const color = node.data.color as string | undefined;
        return color ?? 'var(--md-sys-color-primary)';
      }}
    />
  );
}
