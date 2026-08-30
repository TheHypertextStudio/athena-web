'use client';

import { Schedule } from '@docket/ui/icons';
import { Button, Checkbox, Select, Surface } from '@docket/ui/primitives';
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

/** Inclusive start and exclusive end dates for one all-day quick-create draft. */
export interface CalendarAllDayDraft {
  readonly start: string;
  /** Exclusive end date, matching the calendar write contract. */
  readonly end: string;
}

interface CreateBlockScheduleEditorProps {
  readonly draft: CalendarTimeDraft;
  readonly allDayDraft: CalendarAllDayDraft | null;
  readonly currentTimezone: string;
  readonly invalidField: 'start' | 'end' | 'range' | null;
  readonly onChange: (draft: CalendarTimeDraft) => void;
  readonly onAllDayChange: (draft: CalendarAllDayDraft | null) => void;
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf())
    ? date
    : new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(parsed);
}

function formatTimedSummary(draft: CalendarTimeDraft): string {
  const date = formatDate(draft.start.date, { weekday: 'short', month: 'short', day: 'numeric' });
  const start = new Date(`2000-01-01T${draft.start.time}:00`);
  const end = new Date(`2000-01-01T${draft.end.time}:00`);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const endDate =
    draft.end.date === draft.start.date
      ? ''
      : ` – ${formatDate(draft.end.date, { month: 'short', day: 'numeric' })}`;
  return `${date}${endDate} · ${time.format(start)} – ${time.format(end)}`;
}

function formatAllDaySummary(draft: CalendarAllDayDraft): string {
  const inclusiveEnd = shiftDate(draft.end, -1);
  const start = formatDate(draft.start, { weekday: 'short', month: 'short', day: 'numeric' });
  if (inclusiveEnd === draft.start) return `${start} · All day`;
  return `${start} – ${formatDate(inclusiveEnd, { month: 'short', day: 'numeric' })} · All day`;
}

function compactZone(zone: string): string {
  return zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone;
}

/** Collapsed schedule overview with progressive date, time, and all-day disclosure. */
export function CreateBlockScheduleEditor({
  draft,
  allDayDraft,
  currentTimezone,
  invalidField,
  onChange,
  onAllDayChange,
}: CreateBlockScheduleEditorProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showEndDate, setShowEndDate] = useState(draft.start.date !== draft.end.date);
  const startInvalid = invalidField === 'start' || invalidField === 'range';
  const endInvalid = invalidField === 'end' || invalidField === 'range';
  const summary = allDayDraft ? formatAllDaySummary(allDayDraft) : formatTimedSummary(draft);

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label={`Edit schedule, ${summary}`}
        aria-expanded="false"
        aria-invalid={Boolean(invalidField)}
        onClick={() => {
          setExpanded(true);
        }}
        className="hover:bg-surface-container-high focus-visible:ring-ring aria-invalid:ring-error flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none aria-invalid:ring-2"
      >
        <Schedule className="text-on-surface-variant mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="text-body-medium block">{summary}</span>
          <span className="text-body-small text-on-surface-variant block truncate">
            {allDayDraft ? 'Does not repeat' : compactZone(draft.startTimezone)}
            {!allDayDraft && draft.endTimezone !== draft.startTimezone
              ? ` → ${compactZone(draft.endTimezone)}`
              : ''}
            {!allDayDraft ? ' · Does not repeat' : ''}
          </span>
        </span>
      </button>
    );
  }

  const inclusiveAllDayEnd = allDayDraft ? shiftDate(allDayDraft.end, -1) : '';

  return (
    <Surface tone="card" shape="medium" pad="comfortable" className="flex flex-col gap-3">
      {allDayDraft ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">Start date</span>
            <DatePicker
              ariaLabel="Start date"
              placeholder="Pick a day"
              triggerVariant="outline"
              value={allDayDraft.start}
              onChange={(date) => {
                onAllDayChange({ ...allDayDraft, start: date ?? '' });
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">End date</span>
            <DatePicker
              ariaLabel="End date"
              placeholder="Pick a day"
              triggerVariant="outline"
              value={inclusiveAllDayEnd}
              invalid={Boolean(allDayDraft.end && allDayDraft.end <= allDayDraft.start)}
              onChange={(date) => {
                onAllDayChange({ ...allDayDraft, end: date ? shiftDate(date, 1) : '' });
              }}
            />
          </div>
        </div>
      ) : (
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
                  updateCalendarDraftStart(draft, { date: date ?? '', time: draft.start.time }),
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
          {showEndDate || draft.start.date !== draft.end.date ? (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-label-medium text-on-surface-variant">End date</span>
              <DatePicker
                ariaLabel="End date"
                placeholder="Pick a day"
                triggerVariant="outline"
                value={draft.end.date}
                invalid={endInvalid}
                onChange={(date) => {
                  onChange(
                    updateCalendarDraftEnd(draft, { date: date ?? '', time: draft.end.time }),
                  );
                }}
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start self-end"
              onClick={() => {
                setShowEndDate(true);
              }}
            >
              Add end date
            </Button>
          )}
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
      )}

      <label className="text-body-medium flex items-center gap-2">
        <Checkbox
          checked={Boolean(allDayDraft)}
          onChange={(event) => {
            onAllDayChange(
              event.target.checked
                ? { start: draft.start.date, end: shiftDate(draft.end.date, 1) }
                : null,
            );
          }}
        />
        All day
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-label-medium text-on-surface-variant">Repeat</span>
        <Select aria-label="Repeat" value="none" disabled>
          <option value="none">Does not repeat</option>
        </Select>
      </label>

      <div className="flex items-center justify-between gap-2">
        {allDayDraft ? (
          <span />
        ) : (
          <CalendarTimezoneDialog
            referenceInstant={draft.seed.startsAt}
            currentTimezone={currentTimezone}
            startTimezone={draft.startTimezone}
            endTimezone={draft.endTimezone}
            onApply={(start, end) => {
              onChange(applyCalendarDraftTimezones(draft, start, end));
            }}
          />
        )}
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
    </Surface>
  );
}
