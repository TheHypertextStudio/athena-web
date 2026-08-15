import type { CalendarPreferences } from '@docket/types';

import type { CalendarTimedRegionSelection } from '@/components/calendar/calendar-time-draft';
import type { ScheduleRegionSelection, SchedulingCanvasProps } from '@/components/scheduling';

import type { CalendarAxis } from './calendar-schedule-model';
import type { SharedCalendarItemDetail } from './calendar-shared-item-details';
import type { CalendarDateAxisState } from './use-calendar-date-axis';
import type { CalendarPeopleAxisState } from './use-calendar-people-axis';

/** Exact calendar draft bounds paired with their fluid canvas selection geometry. */
export type CalendarCanvasRegionSelection = CalendarTimedRegionSelection & {
  readonly canvasRegion: ScheduleRegionSelection;
};

/** Props for the shared canvas and its axis-specific status affordances. */
export interface CalendarSchedulingSurfaceProps {
  readonly axis: CalendarAxis;
  readonly visibleLaneCount: number;
  readonly horizontalAnchorKey?: number | undefined;
  readonly pixelsPerHour: number;
  readonly displayTimezone: string;
  readonly now?: string | undefined;
  readonly preferences?: CalendarPreferences | undefined;
  readonly dateAxis: CalendarDateAxisState;
  readonly peopleAxis: CalendarPeopleAxisState;
  readonly selectedRegion?: ScheduleRegionSelection | null | undefined;
  readonly selectedRegionAnchorRef?: SchedulingCanvasProps['selectedRegionAnchorRef'] | undefined;
  readonly onVisibleLaneCountChange: (count: number) => void;
  readonly onVisibleDateRangeChange: (range: {
    readonly startDate: string;
    readonly endDate: string;
  }) => void;
  readonly onReachBoundary: (direction: 'previous' | 'next') => void;
  readonly onSelectRegion: (selection: CalendarCanvasRegionSelection) => void;
  readonly onOpenItem: (itemId: string) => void;
  readonly onOpenSharedItem: (detail: SharedCalendarItemDetail) => void;
  /**
   * Receive a pinch / ctrl+wheel zoom intent as a multiplicative scale factor.
   * `> 1` zooms in (more pixels per hour), `< 1` zooms out. The canvas emits raw intent only;
   * the consumer owns clamping, rounding, and persistence.
   */
  readonly onZoomGesture?: ((scale: number) => void) | undefined;
}
