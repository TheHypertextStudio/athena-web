'use client';

/**
 * `components/canvas/use-animated-node-positions` — tween node positions instead of snapshotting
 * the page.
 *
 * @remarks
 * A root View Transition captures the whole document as a bitmap and freezes input for its
 * duration, which is the wrong tool for a layout that only moved some cards a few hundred pixels.
 * This animator interpolates exactly the nodes whose position differs, in one
 * `requestAnimationFrame` loop, and applies every other change from the target (data, style,
 * selection) on the first frame so the canvas stays live throughout. It jumps under reduced
 * motion, retargets from the in-flight position when a new sync lands mid-animation, and leaves a
 * node the pointer is dragging alone.
 */
import type { Node } from '@xyflow/react';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from 'react';

import { prefersReducedMotion } from '@/lib/motion';

/**
 * Move xyflow state from one arrangement to another.
 *
 * `onSettled` runs once the nodes sit on `to`: at the end of the tween, or at once when nothing
 * needed to move. A tween that is cancelled or superseded never calls it.
 */
export type AnimateNodePositions = (
  from: readonly Node[],
  to: readonly Node[],
  onSettled?: () => void,
) => void;

/** The controls {@link useAnimatedNodePositions} returns. */
export interface NodePositionAnimator {
  /** Tween from one arrangement to another; nodes present only in `to` land immediately. */
  readonly animate: AnimateNodePositions;
  /** Stop the tween in flight, leaving the nodes wherever it last placed them. */
  readonly cancel: () => void;
}

/** A canvas point. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** One node's start and end positions for the current tween. */
interface Track {
  readonly from: Point;
  readonly to: Point;
}

/** The frame request and the latest interpolated positions of the tween in flight. */
interface Flight {
  readonly frame: number;
  readonly current: ReadonlyMap<string, Point>;
}

/** Mirrors the design system's `--dur-slow` token. */
const DURATION_MS = 240;

/**
 * Build a CSS `cubic-bezier(x1, y1, x2, y2)` timing function as a JS easing.
 *
 * @remarks
 * Newton-Raphson on the x polynomial finds the parameter for a given time; a bisection fallback
 * covers the flat starts and ends where the derivative is too small to iterate.
 */
export function cubicBezierEasing(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number): number => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number): number => ((ay * u + by) * u + cy) * u;
  const sampleSlopeX = (u: number): number => (3 * ax * u + 2 * bx) * u + cx;
  const solveX = (x: number): number => {
    let u = x;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const error = sampleX(u) - x;
      if (Math.abs(error) < 1e-6) return u;
      const slope = sampleSlopeX(u);
      if (Math.abs(slope) < 1e-6) break;
      u -= error / slope;
    }
    let low = 0;
    let high = 1;
    u = x;
    while (high - low > 1e-6) {
      u = (low + high) / 2;
      if (sampleX(u) < x) low = u;
      else high = u;
    }
    return u;
  };
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveX(t));
  };
}

/** MD3 emphasized-decelerate, the design system's `--ease-emphasized-decel`. */
export const emphasizedDecelerate = cubicBezierEasing(0.05, 0.7, 0.1, 1);

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

/** Nodes whose position differs, starting from wherever a previous tween had carried them. */
function buildTracks(
  from: readonly Node[],
  to: readonly Node[],
  inFlight: ReadonlyMap<string, Point> | undefined,
): Map<string, Track> {
  const fromById = new Map(from.map((node) => [node.id, node]));
  const tracks = new Map<string, Track>();
  for (const node of to) {
    const previous = fromById.get(node.id);
    if (previous === undefined || previous.dragging === true) continue;
    const start = inFlight?.get(node.id) ?? previous.position;
    if (samePoint(start, node.position)) continue;
    tracks.set(node.id, { from: start, to: node.position });
  }
  return tracks;
}

function lerp(from: Point, to: Point, progress: number): Point {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

/** Whether two nodes carry the same selection flag. */
function sameSelection(left: Node, right: Node): boolean {
  return (left.selected ?? false) === (right.selected ?? false);
}

/**
 * Overlay what the viewer is doing right now onto a target arrangement.
 *
 * @remarks
 * A node the pointer is dragging keeps the position the drag gave it, and a node the viewer
 * selected or deselected since the sync keeps that choice, so a tween never undoes an interaction.
 */
function keepLiveInteraction(target: readonly Node[], live: readonly Node[]): Node[] {
  const liveById = new Map(live.map((node) => [node.id, node]));
  return target.map((node) => {
    const current = liveById.get(node.id);
    if (current === undefined) return node;
    const dragged = current.dragging === true;
    if (!dragged && sameSelection(current, node)) return node;
    return {
      ...node,
      ...(dragged ? { position: current.position, dragging: true } : {}),
      ...(current.selected === undefined ? {} : { selected: current.selected }),
    };
  });
}

/** The target arrangement with each tracked node placed at `progress` along its track. */
function targetAt(
  to: readonly Node[],
  tracks: ReadonlyMap<string, Track>,
  progress: number,
  current: Map<string, Point>,
): Node[] {
  return to.map((node) => {
    const track = tracks.get(node.id);
    if (track === undefined) return node;
    const position = lerp(track.from, track.to, progress);
    current.set(node.id, position);
    return { ...node, position };
  });
}

/**
 * Advance only the tracked positions of the live nodes.
 *
 * @remarks
 * Building on the live node keeps everything xyflow attached to it (measured size, selection,
 * drag state) instead of swapping in the target object on every frame.
 */
function advanceLive(
  live: readonly Node[],
  tracks: ReadonlyMap<string, Track>,
  progress: number,
  current: Map<string, Point>,
): Node[] {
  return live.map((node) => {
    const track = tracks.get(node.id);
    if (track === undefined || node.dragging === true) return node;
    const position = lerp(track.from, track.to, progress);
    current.set(node.id, position);
    return { ...node, position };
  });
}

/**
 * Tween node positions toward a new arrangement through xyflow's `setNodes`.
 *
 * @param setNodes - The controlled-state setter from `useNodesState`.
 * @returns A stable animator: `animate(from, to)` runs the design system's slow, emphasized
 *   decelerate motion, and `cancel()` stops a tween whose target has gone stale.
 */
export function useAnimatedNodePositions(
  setNodes: Dispatch<SetStateAction<Node[]>>,
): NodePositionAnimator {
  const flight = useRef<Flight | null>(null);

  const stop = useCallback((): ReadonlyMap<string, Point> | undefined => {
    const active = flight.current;
    if (active === null) return undefined;
    cancelAnimationFrame(active.frame);
    flight.current = null;
    return active.current;
  }, []);

  const cancel = useCallback((): void => {
    stop();
  }, [stop]);

  useEffect(() => cancel, [cancel]);

  const animate = useCallback<AnimateNodePositions>(
    (from, to, onSettled) => {
      const inFlight = stop();
      const canAnimate = typeof requestAnimationFrame === 'function' && !prefersReducedMotion();
      const tracks = canAnimate ? buildTracks(from, to, inFlight) : new Map<string, Track>();
      if (tracks.size === 0) {
        setNodes((live) => keepLiveInteraction(to, live));
        onSettled?.();
        return;
      }
      const current = new Map<string, Point>();
      setNodes((live) => keepLiveInteraction(targetAt(to, tracks, 0, current), live));
      // The first frame's own timestamp is the start, so the loop never mixes two clocks. That
      // frame only records the start: progress is zero and the nodes already sit at the start.
      let startedAt: number | null = null;
      const step = (now: number): void => {
        startedAt ??= now;
        const progress = Math.min(1, (now - startedAt) / DURATION_MS);
        if (progress >= 1) {
          flight.current = null;
          setNodes((live) => keepLiveInteraction(to, live));
          onSettled?.();
          return;
        }
        if (progress > 0) {
          setNodes((live) => advanceLive(live, tracks, emphasizedDecelerate(progress), current));
        }
        flight.current = { frame: requestAnimationFrame(step), current };
      };
      flight.current = { frame: requestAnimationFrame(step), current };
    },
    [stop, setNodes],
  );

  return { animate, cancel };
}
