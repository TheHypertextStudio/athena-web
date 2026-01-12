'use client';

import { Controls } from '@xyflow/react';

interface FlowControlsProps {
  showZoom?: boolean;
  showFitView?: boolean;
  showInteractive?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Styled controls for ReactFlow graphs.
 * Provides zoom, fit, and lock controls.
 */
export function FlowControls({
  showZoom = true,
  showFitView = true,
  showInteractive = true,
  position = 'bottom-right',
}: FlowControlsProps) {
  return (
    <Controls
      showZoom={showZoom}
      showFitView={showFitView}
      showInteractive={showInteractive}
      position={position}
      className="!bg-surface-container !border-outline-variant !rounded-xl !shadow-md"
    />
  );
}
