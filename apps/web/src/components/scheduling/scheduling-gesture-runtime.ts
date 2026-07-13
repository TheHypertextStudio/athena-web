import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';

import type { ScheduleItemLaneBounds } from './scheduling-date-lanes';
import { deriveGesturePreview } from './scheduling-gesture';
import type {
  ScheduleGestureMode,
  ScheduleGesturePreview,
  ScheduleItem,
  ScheduleLane,
  SchedulingCanvasProps,
} from './scheduling-types';

/** Euclidean distance required to activate an armed pointer gesture. */
export const SCHEDULING_GESTURE_ACTIVATION_PIXELS = 4;

const AUTO_SCROLL_EDGE_PIXELS = 32;
const AUTO_SCROLL_STEP_PIXELS = 16;

/** Inputs needed to bind direct manipulation to one rendered scheduling card. */
export interface UseSchedulingGestureOptions {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly laneWidth: number;
  readonly gutterWidth: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly bounds: ScheduleItemLaneBounds;
  readonly editable: boolean;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveItem?: SchedulingCanvasProps['onMoveItem'];
  readonly onResizeItem?: SchedulingCanvasProps['onResizeItem'];
  readonly formatPreviewTimeRange: (
    mode: ScheduleGestureMode,
    preview: ScheduleGesturePreview,
  ) => string;
  readonly onAnnouncementChange: (announcement: string) => void;
}

/** Event bindings and live preview returned by the scheduling gesture hook. */
export interface SchedulingGestureController {
  readonly preview: ScheduleGesturePreview | null;
  readonly previewMode: ScheduleGestureMode | null;
  readonly onBodyPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onBodyClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onMoveKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  readonly onStartResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onStartResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  readonly onEndResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onEndResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

/** Browser listeners and capture state owned by one armed pointer. */
export interface SchedulingPointerSession {
  readonly pointerId: number;
  readonly target: HTMLElement;
  readonly originX: number;
  readonly originY: number;
  readonly originViewportX: number;
  readonly originContentX: number;
  readonly originScrollLeft: number;
  readonly originScrollTop: number;
  active: boolean;
  captured: boolean;
  readonly move: (event: PointerEvent) => void;
  readonly up: (event: PointerEvent) => void;
  readonly cancel: (event: PointerEvent) => void;
  readonly escape: (event: KeyboardEvent) => void;
  readonly lostCapture: (event: PointerEvent) => void;
}

/** Remove every global and capture-loss listener installed for a pointer session. */
export function detachSchedulingPointerSession(session: SchedulingPointerSession): void {
  window.removeEventListener('pointermove', session.move);
  window.removeEventListener('pointerup', session.up);
  window.removeEventListener('pointercancel', session.cancel);
  window.removeEventListener('keydown', session.escape);
  session.target.removeEventListener('lostpointercapture', session.lostCapture);
}

/** Release capture only when the hook successfully requested it. */
export function releaseSchedulingPointerSession(session: SchedulingPointerSession): void {
  if (!session.captured) return;
  try {
    session.target.releasePointerCapture(session.pointerId);
  } catch {
    // Capture may already have been released by the browser before cleanup runs.
  }
}

/** Return one clamped edge-scroll step for the current pointer coordinate. */
function scrollStep(
  position: number,
  start: number,
  end: number,
  current: number,
  max: number,
): number {
  const requested =
    position < start + AUTO_SCROLL_EDGE_PIXELS
      ? -AUTO_SCROLL_STEP_PIXELS
      : position > end - AUTO_SCROLL_EDGE_PIXELS
        ? AUTO_SCROLL_STEP_PIXELS
        : 0;
  return Math.max(-current, Math.min(requested, Math.max(0, max) - current));
}

/** Scroll at most one bounded step in each axis for one active pointer movement. */
export function autoScrollSchedulingViewport(
  viewport: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  const rect = viewport.getBoundingClientRect();
  const left =
    rect.width > 0
      ? scrollStep(
          clientX,
          rect.left,
          rect.right,
          viewport.scrollLeft,
          viewport.scrollWidth - viewport.clientWidth,
        )
      : 0;
  const top =
    rect.height > 0
      ? scrollStep(
          clientY,
          rect.top,
          rect.bottom,
          viewport.scrollTop,
          viewport.scrollHeight - viewport.clientHeight,
        )
      : 0;
  if (left === 0 && top === 0) return;
  if (typeof viewport.scrollBy === 'function') {
    viewport.scrollBy({ left, top, behavior: 'auto' });
  } else {
    viewport.scrollLeft += left;
    viewport.scrollTop += top;
  }
}

/** Compare semantic preview bounds without relying on object identity. */
export function schedulingPreviewsEqual(
  left: ScheduleGesturePreview | null,
  right: ScheduleGesturePreview | null,
): boolean {
  return (
    left?.laneIndex === right?.laneIndex &&
    left?.startMinutes === right?.startMinutes &&
    left?.endMinutes === right?.endMinutes
  );
}

/** Geometry and policy needed for one arrow-key adjustment. */
export interface SchedulingKeyboardGestureOptions {
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly laneWidth: number;
  readonly gutterWidth: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly bounds: ScheduleItemLaneBounds;
  readonly editable: boolean;
}

/** Derive one active-snap keyboard adjustment, or `undefined` for an unrelated key. */
export function deriveKeyboardGesturePreview(
  current: SchedulingKeyboardGestureOptions,
  mode: ScheduleGestureMode,
  key: string,
): ScheduleGesturePreview | null | undefined {
  const vertical = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
  const horizontal =
    mode === 'move' ? (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0) : 0;
  if (vertical === 0 && horizontal === 0) return undefined;
  return deriveGesturePreview({
    mode,
    original: { laneIndex: current.laneIndex, ...current.bounds },
    delta: {
      x: horizontal * current.laneWidth,
      y: vertical * ((current.snapMinutes / 60) * current.pixelsPerHour),
    },
    laneGeometry: {
      laneWidth: current.laneWidth,
      gutterWidth: current.gutterWidth,
      viewportWidth: current.gutterWidth + current.laneWidth * current.lanes.length,
      originViewportX:
        current.gutterWidth + current.laneIndex * current.laneWidth + current.laneWidth / 2,
      originContentX: current.laneIndex * current.laneWidth + current.laneWidth / 2,
      scrollDelta: { x: 0, y: 0 },
    },
    pixelsPerHour: current.pixelsPerHour,
    snapMinutes: current.snapMinutes,
    itemEditable: current.editable,
    lanes: current.lanes,
  });
}
