import { MINUTES_PER_DAY } from './scheduling-geometry';

/** Live bounds for a pointer-selected scheduling region. */
export interface SchedulingRegionPreview {
  readonly laneId: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** Imperative browser state owned by one region-selection pointer. */
export interface SchedulingRegionSession {
  readonly pointerId: number;
  readonly laneId: string;
  readonly target: HTMLElement;
  readonly viewport: HTMLElement | null;
  readonly rectTop: number;
  readonly originX: number;
  readonly originY: number;
  readonly originScrollLeft: number;
  readonly originScrollTop: number;
  readonly originMinutes: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly pointerType: string;
  readonly selectable: boolean;
  active: boolean;
  panning: boolean;
  captured: boolean;
  longPressTimer: number | null;
  readonly move: (event: PointerEvent) => void;
  readonly up: (event: PointerEvent) => void;
  readonly cancel: (event: PointerEvent) => void;
  readonly escape: (event: KeyboardEvent) => void;
  readonly lostCapture: (event: PointerEvent) => void;
}

/** Derive a non-empty snapped region from its pointer origin and current wall minute. */
export function deriveSchedulingRegionSelection(
  laneId: string,
  originMinutes: number,
  currentMinutes: number,
  snapMinutes: number,
): SchedulingRegionPreview {
  let startMinutes = Math.min(originMinutes, currentMinutes);
  let endMinutes = Math.max(originMinutes, currentMinutes);
  if (startMinutes === endMinutes) {
    if (endMinutes === MINUTES_PER_DAY) startMinutes -= snapMinutes;
    else endMinutes += snapMinutes;
  }
  return { laneId, startMinutes, endMinutes };
}

/** Remove browser listeners and pending long-press work for a region session. */
export function detachSchedulingRegionSession(session: SchedulingRegionSession): void {
  if (session.longPressTimer !== null) {
    window.clearTimeout(session.longPressTimer);
    session.longPressTimer = null;
  }
  window.removeEventListener('pointermove', session.move);
  window.removeEventListener('pointerup', session.up);
  window.removeEventListener('pointercancel', session.cancel);
  window.removeEventListener('keydown', session.escape);
  session.target.removeEventListener('lostpointercapture', session.lostCapture);
}

/** Release pointer capture when the browser has not already done so. */
export function releaseSchedulingRegionCapture(session: SchedulingRegionSession): void {
  if (!session.captured) return;
  try {
    session.target.releasePointerCapture(session.pointerId);
  } catch {
    // The browser may have released capture before cleanup observes the session ending.
  }
}
