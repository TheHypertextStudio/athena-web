'use client';

import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import BlockIcon from '@mui/icons-material/Block';
import { cn } from '@/lib/utils';

export interface DependencyEdgeData extends Record<string, unknown> {
  type?: 'blocks' | 'related';
  isOnCriticalPath?: boolean;
}

export type DependencyEdgeType = Edge<DependencyEdgeData, 'dependency'>;

function DependencyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<DependencyEdgeType>) {
  const isBlocking = data?.type === 'blocks';
  const isCriticalPath = data?.isOnCriticalPath;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={cn(
          'transition-all',
          isBlocking ? 'stroke-error' : 'stroke-outline-variant',
          isCriticalPath && 'stroke-tertiary',
          selected && 'stroke-primary',
        )}
        style={{
          strokeWidth: isBlocking || isCriticalPath ? 2.5 : 1.5,
          strokeDasharray: isBlocking ? undefined : '5 5',
        }}
        markerEnd={`url(#${isBlocking ? 'blocking-arrow' : 'related-arrow'})`}
      />

      {isBlocking && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'nodrag nopan bg-error text-on-error pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full',
              '-translate-x-1/2 -translate-y-1/2 transform',
            )}
            style={{
              left: labelX,
              top: labelY,
            }}
            title="Blocking dependency"
          >
            <BlockIcon sx={{ fontSize: 12 }} />
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Define custom markers */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <marker
            id="blocking-arrow"
            markerWidth="12"
            markerHeight="12"
            refX="6"
            refY="6"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M2,2 L10,6 L2,10 L4,6 Z" fill="var(--md-sys-color-error)" />
          </marker>
          <marker
            id="related-arrow"
            markerWidth="12"
            markerHeight="12"
            refX="6"
            refY="6"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M2,2 L10,6 L2,10 L4,6 Z" fill="var(--md-sys-color-outline-variant)" />
          </marker>
        </defs>
      </svg>
    </>
  );
}

export const DependencyEdge = memo(DependencyEdgeComponent);
