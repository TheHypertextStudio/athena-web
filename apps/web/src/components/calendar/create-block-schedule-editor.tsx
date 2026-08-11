'use client';

import { Schedule } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { DatePicker } from '@/components/date-picker';

import {
  applyCalendarDraftTimezones,
  type CalendarTimeDraft,
  updateCalendarDraftEnd,
  updateCalendarDraftStart,
} from './calendar-time-draft';
import { CalendarTimeField } from './calendar-time-field';
import { CalendarTimezoneDialog } from './calendar-timezone-dialog';

interface CreateBlockScheduleEditorProps {
  readonly draft: CalendarTimeDraft;
  readonly invalidField: 'start' | 'end' | 'range' | null;
  readonly onChange: (draft: CalendarTimeDraft) => void;
}

function formatSummary(draft: CalendarTimeDraft): string {
  const start = new Date(`${draft.start.date}T${draft.start.time}:00`);
  const end = new Date(`${draft.end.date}T${draft.end.time}:00`);
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(start);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} · ${time.format(start)} – ${time.format(end)}`;
}

function compactZone(zone: string): string {
  return zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone;
}

/** Collapsed schedule overview with Google-style progressive date/time disclosure. */
export function CreateBlockScheduleEditor({
  draft,
  invalidField,
  onChange,
}: CreateBlockScheduleEditorProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const startInvalid = invalidField === 'start' || invalidField === 'range';
  const endInvalid = invalidField === 'end' || invalidField === 'range';

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="Edit date and time"
        aria-invalid={Boolean(invalidField)}
        onClick={() => {
          setExpanded(true);
        }}
        className="hover:bg-surface-container-high focus-visible:ring-ring aria-invalid:ring-error flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none aria-invalid:ring-2"
      >
        <Schedule className="text-on-surface-variant mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{formatSummary(draft)}</span>
          <span className="text-on-surface-variant block truncate text-xs">
            {compactZone(draft.startTimezone)}
            {draft.endTimezone !== draft.startTimezone
              ? ` → ${compactZone(draft.endTimezone)}`
              : ''}
            {' · Does not repeat'}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="bg-surface-container-low flex flex-col gap-3 rounded-lg p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label-medium text-on-surface-variant">Start date</span>
          <DatePicker
            ariaLabel="Start date"
            placeholder="Pick a day"
            triggerVariant="outline"
            value={draft.start.date}
            invalid={startInvalid}
            onChange={(date) => {
              onChange(
                updateCalendarDraftStart(draft, {
                  date: date ?? '',
                  time: draft.start.time,
                }),
              );
            }}
          />
        </div>
        <CalendarTimeField
          label="Start time"
          inputType="time"
          date={draft.start.date}
          value={draft.start.time}
          displayTimezone={draft.startTimezone}
          occurrence={draft.start.occurrence}
          invalid={startInvalid}
          onValueChange={(time) => {
            onChange(updateCalendarDraftStart(draft, { date: draft.start.date, time }));
          }}
          onOccurrenceChange={(occurrence) => {
            onChange(
              updateCalendarDraftStart(draft, {
                date: draft.start.date,
                time: draft.start.time,
                occurrence,
              }),
            );
          }}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label-medium text-on-surface-variant">End date</span>
          <DatePicker
            ariaLabel="End date"
            placeholder="Pick a day"
            triggerVariant="outline"
            value={draft.end.date}
            invalid={endInvalid}
            onChange={(date) => {
              onChange(updateCalendarDraftEnd(draft, { date: date ?? '', time: draft.end.time }));
            }}
          />
        </div>
        <CalendarTimeField
          label="End time"
          inputType="time"
          date={draft.end.date}
          value={draft.end.time}
          displayTimezone={draft.endTimezone}
          occurrence={draft.end.occurrence}
          invalid={endInvalid}
          onValueChange={(time) => {
            onChange(updateCalendarDraftEnd(draft, { date: draft.end.date, time }));
          }}
          onOccurrenceChange={(occurrence) => {
            onChange(
              updateCalendarDraftEnd(draft, {
                date: draft.end.date,
                time: draft.end.time,
                occurrence,
              }),
            );
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <CalendarTimezoneDialog
          referenceInstant={draft.seed.startsAt}
          startTimezone={draft.startTimezone}
          endTimezone={draft.endTimezone}
          onApply={(start, end) => {
            onChange(applyCalendarDraftTimezones(draft, start, end));
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setExpanded(false);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
