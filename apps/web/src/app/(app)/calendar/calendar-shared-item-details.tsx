'use client';

import type { ScheduleComparisonItemOut } from '@docket/planning/calendar-contract';
import {
  Badge,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { type JSX } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import { CALENDAR_ITEM_KIND_LABEL } from '@/components/calendar/calendar-item-card';
import { CalendarDrawerClose } from '@/components/calendar/calendar-drawer-close';
import { formatScheduleInstantRange } from '@/components/scheduling/scheduling-time-label';
import { formatCalendarDate } from '@/lib/format-date';

/** A details-shared comparison item paired with its already-authorized person metadata. */
export interface SharedCalendarItemDetail {
  readonly personName: string;
  readonly personTimezone: string | null;
  readonly item: Extract<ScheduleComparisonItemOut, { access: 'details' }>;
}

/** Props for the read-only workspace-shared calendar detail dialog. */
export interface CalendarSharedItemDetailsProps {
  readonly detail: SharedCalendarItemDetail | null;
  readonly displayTimezone: string;
  readonly onClose: () => void;
}

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
    <Dialog
      open={detail !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showClose={false}
        presentation={{ kind: 'centered', size: 'standard', height: 'tall' }}
      >
        {detail ? (
          <>
            <DialogHeader className="gap-2">
              <div className="flex items-start gap-2">
                <DialogTitle className="text-title-medium min-w-0 flex-1">
                  {detail.item.title}
                </DialogTitle>
                <CalendarDrawerClose label="Close shared calendar item" onClick={onClose} />
              </div>
              <DialogDescription>
                Shared by {detail.personName} with this workspace.
              </DialogDescription>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Read-only</Badge>
                <Badge variant="outline">{CALENDAR_ITEM_KIND_LABEL[detail.item.kind]}</Badge>
              </div>
            </DialogHeader>
            <DialogBody data-testid="calendar-shared-item-dialog-scroll">
              <dl className="text-body-medium grid gap-5">
                <div>
                  <dt className="text-on-surface-variant text-label-medium">When</dt>
                  <dd className="text-on-surface mt-1">{timeLabel(detail, displayTimezone)}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant text-label-medium">Schedule owner</dt>
                  <dd className="text-on-surface mt-1">{detail.personName}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant text-label-medium">Timezones</dt>
                  <dd className="text-on-surface mt-1">
                    Times shown in {displayTimezone}
                    {detail.personTimezone
                      ? ` · ${detail.personName}: ${detail.personTimezone}`
                      : ''}
                  </dd>
                </div>
              </dl>
            </DialogBody>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">Shared calendar item</DialogTitle>
            <DialogDescription className="sr-only">
              Read-only shared calendar item details.
            </DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
