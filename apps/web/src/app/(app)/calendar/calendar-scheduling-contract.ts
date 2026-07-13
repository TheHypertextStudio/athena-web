import type { CalendarPreferences } from '@docket/types';

import type { CalendarRegionSelection } from '@/components/calendar/create-block-form';
import type { ScheduleRegionSelection, SchedulingCanvasProps } from '@/components/scheduling';

import type { CalendarAxis } from './calendar-schedule-model';
import type { SharedCalendarItemDetail } from './calendar-shared-item-details';
import type { CalendarDateAxisState } from './use-calendar-date-axis';
import type { CalendarPeopleAxisState } from './use-calendar-people-axis';

/** Exact calendar draft bounds paired with their fluid canvas selection geometry. */
export interface CalendarCanvasRegionSelection extends CalendarRegionSelection {
  readonly canvasRegion: ScheduleRegionSelection;
}

/** Props for the shared canvas and its axis-specific status/sidebar affordances. */
export interface CalendarSchedulingSurfaceProps {
  readonly axis: CalendarAxis;
  readonly visibleLaneCount: number;
  readonly horizontalAnchorKey?: number;
  readonly pixelsPerHour: number;
  readonly displayTimezone: string;
  readonly now?: string;
  readonly preferences?: CalendarPreferences;
  readonly dateAxis: CalendarDateAxisState;
  readonly peopleAxis: CalendarPeopleAxisState;
  readonly selectedRegion?: ScheduleRegionSelection | null;
  readonly selectedRegionAnchorRef?: SchedulingCanvasProps['selectedRegionAnchorRef'];
  readonly onVisibleLaneCountChange: (count: number) => void;
  readonly onVisibleDateRangeChange: (range: {
    readonly startDate: string;
    readonly endDate: string;
  }) => void;
  readonly onReachBoundary: (direction: 'previous' | 'next') => void;
  readonly onSelectRegion: (selection: CalendarCanvasRegionSelection) => void;
  readonly onOpenItem: (itemId: string) => void;
  readonly onOpenSharedItem: (detail: SharedCalendarItemDetail) => void;
}
