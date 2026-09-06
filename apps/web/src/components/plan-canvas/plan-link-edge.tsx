'use client';

/**
 * `components/plan-canvas/plan-link-edge` — an initiative-to-project membership link.
 *
 * @remarks
 * Dashed and quiet, because it states a relationship rather than an order: a project belongs to
 * an initiative, it is not blocked by it. It is never selectable and never removable from the
 * canvas — membership changes in the inspector — so it carries no hit area and no control.
 */
import { BaseEdge, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo, type JSX } from 'react';

function PlanLinkEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps): JSX.Element {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <BaseEdge
      id={id}
      path={path}
      interactionWidth={0}
      style={{
        stroke: 'var(--color-outline-variant)',
        strokeWidth: 1.5,
        strokeDasharray: '4 4',
        pointerEvents: 'none',
      }}
    />
  );
}

/** Memoised; the path only changes when an endpoint moves. */
const PlanLinkEdge = memo(PlanLinkEdgeComponent);
export default PlanLinkEdge;
