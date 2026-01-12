'use client';

import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps, type Edge } from '@xyflow/react';
import { cn } from '@/lib/utils';

export interface TimelineEdgeData extends Record<string, unknown> {
  type?: 'dependency' | 'hierarchy';
}

export type TimelineEdgeType = Edge<TimelineEdgeData, 'timeline'>;

function TimelineEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<TimelineEdgeType>) {
  const isHierarchy = data?.type === 'hierarchy';

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={cn(
          'transition-all',
          isHierarchy ? 'stroke-tertiary' : 'stroke-primary',
          selected && 'stroke-secondary',
        )}
        style={{
          strokeWidth: isHierarchy ? 2 : 1.5,
          strokeDasharray: isHierarchy ? undefined : '6 4',
        }}
        markerEnd={`url(#${isHierarchy ? 'hierarchy-arrow' : 'dependency-arrow'})`}
      />

      {/* Custom markers */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <marker
            id="hierarchy-arrow"
            markerWidth="10"
            markerHeight="10"
            refX="5"
            refY="5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <circle cx="5" cy="5" r="3" fill="var(--md-sys-color-tertiary)" />
          </marker>
          <marker
            id="dependency-arrow"
            markerWidth="12"
            markerHeight="12"
            refX="6"
            refY="6"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M2,2 L10,6 L2,10 L4,6 Z" fill="var(--md-sys-color-primary)" />
          </marker>
        </defs>
      </svg>
    </>
  );
}

export const TimelineEdge = memo(TimelineEdgeComponent);
