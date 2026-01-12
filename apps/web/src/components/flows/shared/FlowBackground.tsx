'use client';

import { Background, BackgroundVariant } from '@xyflow/react';

interface FlowBackgroundProps {
  variant?: 'dots' | 'lines' | 'cross';
  gap?: number;
  size?: number;
}

/**
 * Styled background for ReactFlow graphs.
 * Uses MD3 colors for consistency.
 */
export function FlowBackground({ variant = 'dots', gap = 16, size = 1 }: FlowBackgroundProps) {
  const variantMap: Record<string, BackgroundVariant> = {
    dots: BackgroundVariant.Dots,
    lines: BackgroundVariant.Lines,
    cross: BackgroundVariant.Cross,
  };

  return (
    <Background
      variant={variantMap[variant]}
      gap={gap}
      size={size}
      color="var(--md-sys-color-outline-variant)"
      style={{ opacity: 0.5 }}
    />
  );
}
