'use client';

import type { ScheduleComparisonItemOut } from '@docket/types';
import { Badge, Sheet, SheetContent, SheetDescription, SheetTitle } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import { CalendarDrawerClose } from '@/components/calendar/calendar-drawer-close';
import { formatScheduleInstantRange } from '@/components/scheduling/scheduling-time-label';
import { formatCalendarDate } from '@/lib/format-date';

/** A details-shared comparison item paired with its already-authorized person metadata. */
export interface SharedCalendarItemDetail {
  readonly personName: string;
  readonly personTimezone: string | null;
  readonly item: Extract<ScheduleComparisonItemOut, { access: 'details' }>;
}

/** Props for the read-only workspace-shared calendar detail sheet. */
export interface CalendarSharedItemDetailsProps {
  readonly detail: SharedCalendarItemDetail | null;
  readonly displayTimezone: string;
  readonly onClose: () => void;
}

const KIND_LABEL: Record<SharedCalendarItemDetail['item']['kind'], string> = {
  provider_event: 'Provider event',
  native_event: 'Native event',
  native_block: 'Block',
  timebox: 'Timebox',
  task_timebox: 'Timebox',
  availability_block: 'Availability',
};

/** Format shared bounds without looking up the owner-scoped calendar item. */
function timeLabel(detail: SharedCalendarItemDetail, displayTimezone: string): string {
  const { item } = detail;
  if (item.startsAt && item.endsAt) {
    try {
      const startsAt = new Date(item.startsAt);
      const endsAt = new Date(item.endsAt);
      const dateFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeZone: displayTimezone,
      });
      const startDate = dateFormatter.format(startsAt);
      const endDate = dateFormatter.format(endsAt);
      const timeRange = formatScheduleInstantRange(item.startsAt, item.endsAt, displayTimezone);
      if (startDate === endDate && timeRange) return `${startDate} · ${timeRange}`;
      const endpointFormatter = new Intl.DateTimeFormat(undefined, {
        timeZone: displayTimezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });
      return `${endpointFormatter.format(startsAt)} – ${endpointFormatter.format(endsAt)}`;
    } catch {
      return 'Shared time unavailable';
    }
  }
  if (item.allDayStartDate && item.allDayEndDate) {
    const start = formatCalendarDate(item.allDayStartDate) ?? item.allDayStartDate;
    const inclusiveEndDate = shiftISODate(item.allDayEndDate, -1);
    const end = formatCalendarDate(inclusiveEndDate) ?? inclusiveEndDate;
    return start === end ? `All day · ${start}` : `All day · ${start} – ${end}`;
  }
  return 'Shared time unavailable';
}

/** Render useful, immutable details sourced only from the schedule-comparison response. */
export function CalendarSharedItemDetails({
  detail,
  displayTimezone,
  onClose,
}: CalendarSharedItemDetailsProps): JSX.Element {
  return (
    <Sheet
      open={detail !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-[26rem] p-4">
        {detail ? (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <SheetTitle className="min-w-0 flex-1 text-base font-semibold">
                  {detail.item.title}
                </SheetTitle>
                <CalendarDrawerClose label="Close shared calendar item" onClick={onClose} />
              </div>
              <SheetDescription>
                Shared by {detail.personName} with this workspace.
              </SheetDescription>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Read-only</Badge>
                <Badge variant="outline">{KIND_LABEL[detail.item.kind]}</Badge>
              </div>
            </header>
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-on-surface-variant text-xs font-medium">When</dt>
                <dd className="text-on-surface mt-1">{timeLabel(detail, displayTimezone)}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant text-xs font-medium">Schedule owner</dt>
                <dd className="text-on-surface mt-1">{detail.personName}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant text-xs font-medium">Timezones</dt>
                <dd className="text-on-surface mt-1">
                  Times shown in {displayTimezone}
                  {detail.personTimezone ? ` · ${detail.personName}: ${detail.personTimezone}` : ''}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <>
            <SheetTitle className="sr-only">Shared calendar item</SheetTitle>
            <SheetDescription className="sr-only">
              Read-only shared calendar item details.
            </SheetDescription>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
