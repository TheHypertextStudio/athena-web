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
  /** IANA timezone used to interpret item instants inside this lane. */
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
