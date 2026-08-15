'use client';

/**
 * `components/canvas/dependency-edge` — the edge renderer that makes a dependency removable.
 *
 * @remarks
 * The canvas has always been able to delete a dependency: select the edge, press Delete. Nobody
 * ever found it. xyflow's default edge is a two-pixel bezier with no widened hit area, no visible
 * selected state, and no hint that a key does anything — on a trackpad the gesture is effectively
 * undiscoverable, which is how "it's impossible to remove dependencies once something is dragged"
 * became true in practice while the capability shipped.
 *
 * Three things fix that, and they are all in this file:
 *
 * 1. **A real target.** `interactionWidth` puts a {@link HIT_WIDTH}px invisible stroke under the
 *    visible line, so the edge can be hit without pixel-hunting.
 * 2. **Visible selection.** A selected edge thickens and takes the primary colour, so pressing
 *    Delete is an obvious next move rather than a guess.
 * 3. **A direct affordance.** Hovering the edge (or selecting it) reveals a remove button at the
 *    midpoint, drawn through `EdgeLabelRenderer` so it stays upright and legible at any zoom.
 *
 * Subtask edges render through the same component but never offer removal — they reparent by
 * dragging, and the host's `onBeforeDelete` refuses to delete them. The button is also withheld
 * when the host is read-only.
 */
import { X } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { memo, useState } from 'react';

import { useCanvasActions } from './canvas-actions-context';

/** The invisible stroke width that actually receives the pointer. */
const HIT_WIDTH = 22;

/**
 * How far the remove control may be scaled back up as the canvas zooms out.
 *
 * @remarks
 * `EdgeLabelRenderer` draws into the transformed viewport layer, so a 24px button is 11px on a
 * graph fitted at 0.45 — below any reasonable pointer target and invisible at a glance. Countering
 * the viewport scale keeps the control at a constant on-screen size. The cap stops a heavily
 * zoomed-out canvas from rendering a control larger than the nodes it sits between.
 */
const MAX_COUNTER_SCALE = 2.5;

/** Read the `kind` discriminator off an edge's data. */
function edgeDataKind(data: unknown): string | undefined {
  return (data as { kind?: string | undefined } | undefined)?.kind;
}

/** A dependency (or subtask) edge with a hover/selected remove affordance. */
function DependencyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  const actions = useCanvasActions();
  const { getEdge } = useReactFlow();
  // Zoom is read from the store rather than passed down, so only the edges that render a control
  // re-render when the viewport scales.
  const zoom = useStore((s) => s.transform[2]);
  const counterScale = Math.min(MAX_COUNTER_SCALE, zoom > 0 ? Math.max(1, 1 / zoom) : 1);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isSubtask = edgeDataKind(data) === 'subtask';
  // Only a dependency is removable, and only when the viewer may edit. A subtask link is changed
  // by dragging its parent end, so offering an X here would promise a delete that is refused.
  const removable = !isSubtask && actions?.canEdit === true;
  const showRemove = removable && (hovered || selected === true);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
        interactionWidth={HIT_WIDTH}
        style={{
          ...style,
          ...(selected === true
            ? { stroke: 'var(--color-primary)', strokeWidth: 2.5, strokeOpacity: 1 }
            : {}),
        }}
        // The wrapper carries the pointer handlers so the widened interaction stroke drives hover,
        // not just the hairline the user can see.
        className={cn(selected === true && 'react-flow__edge-selected')}
      />
      <g
        onPointerEnter={() => {
          setHovered(true);
        }}
        onPointerLeave={() => {
          setHovered(false);
        }}
      >
        <path
          d={path}
          fill="none"
          strokeWidth={HIT_WIDTH}
          stroke="transparent"
          className="pointer-events-stroke"
        />
      </g>

      {showRemove ? (
        <EdgeLabelRenderer>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconOnly
            // `nodrag`/`nopan` keep the click from being swallowed by the canvas's pan handler,
            // and `pointer-events-auto` re-enables hits inside the label layer, which is inert.
            className="nodrag nopan pointer-events-auto absolute rounded-full"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${counterScale})`,
            }}
            aria-label="Remove dependency"
            onPointerEnter={() => {
              setHovered(true);
            }}
            onPointerLeave={() => {
              setHovered(false);
            }}
            onClick={() => {
              // `removable` already established that actions exist; narrowing again here would
              // only be to satisfy the reader, and the button does not render otherwise.
              const edge = getEdge(id);
              if (edge) actions.removeDependency(edge.source, edge.target);
            }}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

/** Memoized so unrelated graph updates don't re-render every edge. */
const DependencyEdge = memo(DependencyEdgeComponent);
export default DependencyEdge;
