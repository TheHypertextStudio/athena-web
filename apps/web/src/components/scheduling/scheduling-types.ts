import type { ReactNode } from 'react';

/** One schedulable item rendered inside a {@link ScheduleLane}. */
export interface ScheduleItem {
  /** Stable consumer-owned item identifier. */
  readonly id: string;
  /** Primary text rendered on the item. */
  readonly title: string;
  /** Inclusive ISO instant at which the item begins. */
  readonly startsAt: string;
  /** Exclusive ISO instant at which the item ends. */
  readonly endsAt: string;
  /** Whether the item belongs in the all-day header instead of the hour grid. */
  readonly allDay?: boolean;
  /** Optional item color supplied by the consuming surface. */
  readonly color?: string;
  /** Whether move and resize affordances are available. Defaults to the lane's policy. */
  readonly editable?: boolean;
  /** Optional app object exposed when this item is dragged onto another scheduling item. */
  readonly dragObject?: ScheduleDragObject;
  /** Whether tasks/events may be dropped onto this item as a relationship target. */
  readonly dropTarget?: boolean;
}

/** Cross-surface objects that may be associated with a calendar target. */
export type ScheduleDragObject =
  | {
      readonly kind: 'task';
      readonly taskId: string;
      readonly organizationId: string;
      readonly title: string;
    }
  | { readonly kind: 'calendar_item'; readonly itemId: string; readonly title: string };

/** One object-on-item drop interpreted by the scheduling canvas. */
export interface ScheduleObjectDrop {
  readonly object: ScheduleDragObject;
  readonly targetItem: ScheduleItem;
  readonly targetLane: ScheduleLane;
}

/** An arbitrary date/resource lane accepted by the fluid scheduling canvas. */
export interface ScheduleLane {
  /** Stable consumer-owned lane identifier. */
  readonly id: string;
  /** Human-readable lane heading. */
  readonly label: string;
  /** Calendar date represented by the lane, formatted as `YYYY-MM-DD`. */
  readonly date: string;
  /** Items already assigned to this lane by the consuming surface. */
  readonly items: readonly ScheduleItem[];
  /** Optional resource represented by the lane, such as a person, room, or calendar. */
  readonly resourceId?: string;
  /** Optional resource timezone shown as metadata; it never controls shared canvas geometry. */
  readonly timezone?: string;
  /** Whether items in the lane may be moved or resized. Defaults to `true`. */
  readonly editable?: boolean;
}

/** A pointer-selected time region in one schedule lane. */
export interface ScheduleRegionSelection {
  readonly lane: ScheduleLane;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** A consumer-owned item-open request. */
export interface ScheduleItemOpen {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
}

/** A proposed item move. The consumer decides whether and how to persist it. */
export interface ScheduleItemMove {
  readonly item: ScheduleItem;
  readonly fromLane: ScheduleLane;
  readonly toLane: ScheduleLane;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** A proposed item resize. The consumer decides whether and how to persist it. */
export interface ScheduleItemResize {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly edge: 'start' | 'end';
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** One direct-manipulation operation supported by a timed scheduling item. */
export type ScheduleGestureMode = 'move' | 'resize-start' | 'resize-end';

/** Valid wall-clock and lane bounds shown before a scheduling gesture commits. */
export interface ScheduleGesturePreview {
  readonly laneIndex: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** Context supplied to a consumer-owned scheduling item renderer. */
export interface ScheduleItemRenderContext {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly allDay: boolean;
}

/** Public contract for the pure, callback-driven scheduling canvas. */
export interface SchedulingCanvasProps {
  /** IANA timezone shared by labels, item geometry, selection, and mutation conversion. */
  readonly displayTimezone: string;
  /** Arbitrary date/resource lanes. No view mode or fixed lane count is assumed. */
  readonly lanes: readonly ScheduleLane[];
  /** Continuous vertical zoom. Every positive value is supported. */
  readonly pixelsPerHour: number;
  /** Optional ISO instant used for deterministic current-time rendering. */
  readonly now?: string;
  /** Deterministic width override; when omitted the canvas observes its own viewport. */
  readonly viewportWidth?: number;
  /** Minimum readable lane width; the visible lane count is derived from this and the viewport. */
  readonly minimumLaneWidth?: number;
  /** Lane aligned at the leading edge when a rolling window mounts. */
  readonly initialLaneIndex?: number;
  /** Minute-of-day initially brought near the top of the viewport (default: 07:00). */
  readonly initialScrollMinutes?: number;
  /** Reports the live viewport-derived geometry to a rolling lane source. */
  readonly onViewportGeometry?: (geometry: {
    readonly visibleLaneCount: number;
    readonly laneWidth: number;
  }) => void;
  /** Requests the preceding/following window when horizontal scrolling reaches a boundary. */
  readonly onReachBoundary?: (direction: 'previous' | 'next') => void;
  /** Optional application-owned error copy. The grid remains mounted underneath it. */
  readonly error?: string | null;
  /** Application-owned empty copy shown when every lane has no items. */
  readonly emptyMessage?: string;
  /** Customize item content without transferring gesture or geometry ownership. */
  readonly renderItem?: (context: ScheduleItemRenderContext) => ReactNode;
  /** Receive a pointer-created time region. */
  readonly onSelectRegion?: (selection: ScheduleRegionSelection) => void;
  /** Receive item activation. */
  readonly onOpenItem?: (request: ScheduleItemOpen) => void;
  /** Receive a proposed lane/time move. */
  readonly onMoveItem?: (request: ScheduleItemMove) => void;
  /** Receive a proposed start/end resize. */
  readonly onResizeItem?: (request: ScheduleItemResize) => void;
  /** Associate a cross-surface task/event with an item target. */
  readonly onDropObjectOnItem?: (request: ScheduleObjectDrop) => void;
}
