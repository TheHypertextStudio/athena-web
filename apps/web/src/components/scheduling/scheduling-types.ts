import type { ReactNode, Ref } from 'react';

/** An inclusive-start, exclusive-end range of exact ISO instants. */
export interface ScheduleInstantRange {
  /** Inclusive exact instant at which the range begins. */
  readonly startsAt: string;
  /** Exclusive exact instant at which the range ends. */
  readonly endsAt: string;
}

/** Minute-of-day bounds clipped to one schedule lane. */
export interface ScheduleMinuteBounds {
  /** Inclusive minute position at which the range begins. */
  readonly startMinutes: number;
  /** Exclusive minute position at which the range ends. */
  readonly endMinutes: number;
}

/** Semantic surface treatment for a domain-neutral scheduling item. */
export type ScheduleItemAppearance = 'event' | 'timebox' | 'availability' | 'busy';

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
  readonly allDay?: boolean | undefined;
  /** Optional item color supplied by the consuming surface. */
  readonly color?: string | undefined;
  /** Semantic surface treatment. Consumers that omit it receive the safe `event` default. */
  readonly appearance?: ScheduleItemAppearance | undefined;
  /** Whether move and resize affordances are available. Defaults to the lane's policy. */
  readonly editable?: boolean | undefined;
  /** Whether activating the item opens consumer-owned details. Defaults to `true`. */
  readonly openable?: boolean | undefined;
  /** Optional application-owned label for a domain-level read-only state. */
  readonly readOnlyLabel?: string | undefined;
  /** Optional app object exposed when this item is dragged onto another scheduling item. */
  readonly dragObject?: ScheduleDragObject | undefined;
  /** Whether tasks/events may be dropped onto this item as a relationship target. */
  readonly dropTarget?: boolean | undefined;
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

/** One object dropped onto empty grid time (not onto an existing item) — schedule it there. */
export interface ScheduleObjectGridDrop {
  readonly object: ScheduleDragObject;
  readonly lane: ScheduleLane;
  /** Snapped minute-of-day of the drop position (the new block's start). */
  readonly startMinutes: number;
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
  readonly resourceId?: string | undefined;
  /** Optional resource timezone shown as metadata; it never controls shared canvas geometry. */
  readonly timezone?: string | undefined;
  /** Whether items in the lane may be moved or resized. Defaults to `true`. */
  readonly editable?: boolean | undefined;
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

/** A proposed move for an all-day item using an inclusive-start/exclusive-end date range. */
export interface ScheduleAllDayItemMove {
  readonly item: ScheduleItem;
  readonly fromLane: ScheduleLane;
  readonly toLane: ScheduleLane;
  readonly startDate: string;
  readonly endDate: string;
}

/** A proposed true-edge resize for an all-day item's calendar-date range. */
export interface ScheduleAllDayItemResize {
  readonly item: ScheduleItem;
  readonly fromLane: ScheduleLane;
  readonly toLane: ScheduleLane;
  readonly edge: 'start' | 'end';
  readonly startDate: string;
  readonly endDate: string;
}

/** One direct-manipulation operation supported by a timed scheduling item. */
export type ScheduleGestureMode = 'move' | 'resize-start' | 'resize-end';

/** Amount of visible detail that fits inside a rendered scheduling item. */
export type ScheduleItemDensity = 'marker' | 'compact' | 'full';

/** Valid wall-clock and lane bounds shown before a scheduling gesture commits. */
export interface ScheduleGesturePreview {
  readonly laneIndex: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** Exact label and commit eligibility for one direct-manipulation preview. */
export interface ScheduleGestureTimePresentation {
  readonly label: string;
  readonly valid: boolean;
  readonly announcement?: string;
}

/** Context supplied to a consumer-owned scheduling item renderer. */
export interface ScheduleItemRenderContext {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly allDay: boolean;
  /** Layout-derived detail level consumers should honor when rendering item content. */
  readonly density: ScheduleItemDensity;
}

/** Geometry supplied to a consumer-owned timed-lane underlay. */
export interface ScheduleTimedLaneGeometry {
  /** Zero-based lane position in the current canvas. */
  readonly laneIndex: number;
  /** Rendered lane width in CSS pixels. */
  readonly laneWidth: number;
  /** Full 24-hour lane height in CSS pixels. */
  readonly laneHeight: number;
  /** Current vertical scale in CSS pixels per hour. */
  readonly pixelsPerHour: number;
}

/** Context supplied to a consumer-owned timed-lane underlay renderer. */
export interface ScheduleTimedLaneRenderContext {
  /** Lane receiving the underlay. */
  readonly lane: ScheduleLane;
  /** Current lane placement and scale. */
  readonly geometry: ScheduleTimedLaneGeometry;
}

/** Neutral geometry supplied to an app-owned interactive timed-lane context renderer. */
export interface ScheduleTimedLaneContextRenderContext extends ScheduleTimedLaneRenderContext {
  /** Every visible lane, supplied only so app-owned pointer logic can resolve a target date. */
  readonly lanes: readonly ScheduleLane[];
  /** Current neutral wall-time snap interval. */
  readonly snapMinutes: number;
}

/** Geometry supplied to a consumer-owned all-day lane context renderer. */
export interface ScheduleAllDayLaneGeometry {
  /** Zero-based lane position in the current canvas. */
  readonly laneIndex: number;
  /** Rendered lane width in CSS pixels. */
  readonly laneWidth: number;
}

/** Context supplied to an app-owned interactive all-day lane renderer. */
export interface ScheduleAllDayLaneRenderContext {
  /** Lane receiving the context content. */
  readonly lane: ScheduleLane;
  /** Current all-day lane placement. */
  readonly geometry: ScheduleAllDayLaneGeometry;
}

/** Geometry supplied to a decorative renderer for one timed item. */
export interface ScheduleTimedItemGeometry {
  /** Zero-based lane position that matches the visible item segment. */
  readonly laneIndex: number;
  /** Current projected bounds, including any direct-manipulation preview. */
  readonly bounds: ScheduleMinuteBounds;
  /** Current top offset in CSS pixels within the timed lane. */
  readonly top: number;
  /** Current rendered height in CSS pixels. */
  readonly height: number;
  /** Rendered lane width in CSS pixels. */
  readonly laneWidth: number;
  /** Current vertical scale in CSS pixels per hour. */
  readonly pixelsPerHour: number;
}

/** Collision placement supplied to a decorative renderer for one timed item. */
export interface ScheduleTimedItemPlacement {
  /** Zero-based visual overlap column. */
  readonly columnIndex: number;
  /** Peak column count in the item's overlap cluster. */
  readonly columnCount: number;
}

/** Context supplied to a consumer-owned timed-item decoration renderer. */
export interface ScheduleTimedItemDecorationContext {
  /** Readonly item receiving decoration. */
  readonly item: ScheduleItem;
  /** Lane that contains the projected item segment. */
  readonly lane: ScheduleLane;
  /** Current item bounds and rendered dimensions. */
  readonly geometry: ScheduleTimedItemGeometry;
  /** Current collision column without any interaction callbacks. */
  readonly placement: ScheduleTimedItemPlacement;
}

/** Public contract for the pure, callback-driven scheduling canvas. */
export interface SchedulingCanvasProps {
  /** Surface-specific chrome while geometry and interactions remain shared. */
  readonly presentation?: 'calendar' | 'agenda' | undefined;
  /** IANA timezone shared by labels, item geometry, selection, and mutation conversion. */
  readonly displayTimezone: string;
  /** Arbitrary date/resource lanes. No view mode or fixed lane count is assumed. */
  readonly lanes: readonly ScheduleLane[];
  /** Continuous vertical zoom. Every positive value is supported. */
  readonly pixelsPerHour: number;
  /** Optional ISO instant used for deterministic current-time rendering. */
  readonly now?: string | undefined;
  /** Deterministic width override; when omitted the canvas observes its own viewport. */
  readonly viewportWidth?: number | undefined;
  /** Consumer-owned viewport height; defaults to a bounded responsive calendar surface. */
  readonly viewportHeight?: string | number | undefined;
  /** Minimum readable lane width; the visible lane count is derived from this and the viewport. */
  readonly minimumLaneWidth?: number | undefined;
  /**
   * Consumer-owned chrome placed in the header's hour-gutter cell.
   *
   * @remarks
   * The canvas exposes no controls of its own — zoom, navigation, and view choice all belong to the
   * surface around it. This is the one exception's escape hatch: a control that has to sit *inside*
   * the grid's own coordinate system to make sense, which today is the rail's scale stepper.
   */
  readonly gutterSlot?: ReactNode | undefined;
  /** Lane aligned at the leading edge when a rolling window mounts. */
  readonly initialLaneIndex?: number | undefined;
  /** Consumer-owned signal that realigns the initial lane even when the lane window is unchanged. */
  readonly horizontalAnchorKey?: string | number | undefined;
  /** Minute brought near the top; defaults to one hour before live time, or 07:00 off today. */
  readonly initialScrollMinutes?: number | undefined;
  /** Reports the live viewport-derived geometry to a rolling lane source. */
  readonly onViewportGeometry?:
    | ((geometry: { readonly visibleLaneCount: number; readonly laneWidth: number }) => void)
    | undefined;
  /** Reports the first and last lanes intersecting the live horizontal viewport. */
  readonly onVisibleLaneRange?:
    | ((range: { readonly startLane: ScheduleLane; readonly endLane: ScheduleLane }) => void)
    | undefined;
  /** Requests the preceding/following window when horizontal scrolling reaches a boundary. */
  readonly onReachBoundary?: ((direction: 'previous' | 'next') => void) | undefined;
  /** Optional application-owned error copy. The grid remains mounted underneath it. */
  readonly error?: string | null | undefined;
  /** Application-owned empty copy shown when every lane has no items. */
  readonly emptyMessage?: string | undefined;
  /** One control rendered beside {@link emptyMessage}, so an empty canvas offers a way forward. */
  readonly emptyAction?: ReactNode | undefined;
  /** Customize item content without transferring gesture or geometry ownership. */
  readonly renderItem?: ((context: ScheduleItemRenderContext) => ReactNode) | undefined;
  /**
   * Render decorative context beneath timed items in each lane.
   *
   * @remarks
   * The canvas wraps this output in an inert, pointer-disabled layer. Consumers receive geometry
   * but no mutation callbacks, so the underlay can show rails without taking gesture ownership.
   */
  readonly renderTimedLaneUnderlay?:
    | ((context: ScheduleTimedLaneRenderContext) => ReactNode)
    | undefined;
  /**
   * Render app-owned controls in a timed lane without exposing scheduling item mutations.
   *
   * @remarks
   * The full-lane wrapper ignores pointer events so empty-grid selection still works. Interactive
   * descendants must opt back in with `pointer-events-auto`. Consumers receive only readonly lane
   * geometry, visible lanes, and the neutral snap interval.
   */
  readonly renderTimedLaneContext?:
    | ((context: ScheduleTimedLaneContextRenderContext) => ReactNode)
    | undefined;
  /**
   * Render app-owned interactive context above the existing all-day items in each lane.
   *
   * @remarks
   * Unlike the timed decoration seams, this output remains interactive so an app can own compact
   * buttons and drag behavior. The renderer receives neutral lane geometry and no scheduling item
   * mutation callbacks. Returning `null` omits the wrapper and its flex gap.
   */
  readonly renderAllDayLaneContext?:
    | ((context: ScheduleAllDayLaneRenderContext) => ReactNode)
    | undefined;
  /**
   * Render decoration above a timed item's base surface and below its text and controls.
   *
   * @remarks
   * The canvas wraps this output in an inert, pointer-disabled layer. The renderer receives only
   * readonly scheduling data and cannot take ownership of item mutation or gestures.
   */
  readonly renderTimedItemDecoration?:
    | ((context: ScheduleTimedItemDecorationContext) => ReactNode)
    | undefined;
  /**
   * Optional per-item action control (e.g. a start-timer button), rendered as a fixed corner
   * control alongside the built-in resize/move/relationship controls.
   *
   * @remarks
   * Distinct from {@link SchedulingCanvasProps.renderItem}, which only supplies the item's label
   * content — this supplies a separate, independently-clickable control anchored to one corner of
   * the item, the way the move handle and relationship-source control already are.
   */
  readonly renderItemAction?: ((context: ScheduleItemRenderContext) => ReactNode) | undefined;
  /** Consumer-owned committed selection kept visible after its pointer gesture completes. */
  readonly selectedRegion?: ScheduleRegionSelection | null | undefined;
  /** Optional ref to the committed selection element for contextual consumer UI. */
  readonly selectedRegionAnchorRef?: Ref<HTMLDivElement> | undefined;
  /** Receive a pointer-created time region. */
  readonly onSelectRegion?: ((selection: ScheduleRegionSelection) => void) | undefined;
  /** Receive an explicit create request from one lane's all-day strip. */
  readonly onSelectAllDayRegion?: ((lane: ScheduleLane, anchor: HTMLElement) => void) | undefined;
  /** Receive a focused-grid day shortcut without teaching shared geometry how dates navigate. */
  readonly onDateShortcut?: ((shortcut: 'previous' | 'next' | 'today') => void) | undefined;
  /** Receive item activation. */
  readonly onOpenItem?: ((request: ScheduleItemOpen) => void) | undefined;
  /** Receive a proposed lane/time move. */
  readonly onMoveItem?: ((request: ScheduleItemMove) => void) | undefined;
  /** Receive a proposed start/end resize. */
  readonly onResizeItem?: ((request: ScheduleItemResize) => void) | undefined;
  /** Receive a proposed calendar-date move for an all-day item. */
  readonly onMoveAllDayItem?: ((request: ScheduleAllDayItemMove) => void) | undefined;
  /** Receive a proposed calendar-date resize for an all-day item. */
  readonly onResizeAllDayItem?: ((request: ScheduleAllDayItemResize) => void) | undefined;
  /** Associate a cross-surface task/event with an item target. */
  readonly onDropObjectOnItem?: ((request: ScheduleObjectDrop) => void) | undefined;
  /** Schedule a cross-surface object dropped onto empty grid time as a new block at that time. */
  readonly onDropObjectOnGrid?: ((request: ScheduleObjectGridDrop) => void) | undefined;
  /**
   * Receive a pinch / ctrl+wheel zoom intent as a multiplicative scale factor.
   * `> 1` zooms in (more pixels per hour), `< 1` zooms out. The canvas emits raw intent only;
   * the consumer owns clamping, rounding, and persistence.
   */
  readonly onZoomGesture?: ((scale: number) => void) | undefined;
}
