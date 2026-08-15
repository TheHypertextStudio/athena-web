'use client';

/** Dialog-based creation and whole-series editing for canonical expected locations. */
import type {
  WorkLocationAssertionCreate,
  WorkLocationAssertionOut,
  WorkLocationSchedule,
  WorkPlaceOut,
} from '@docket/types';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
} from '@docket/ui/primitives';
import { type JSX, type SubmitEventHandler, useEffect, useState } from 'react';

import { CalendarTimeField } from '@/components/calendar/calendar-time-field';
import {
  fromLocalInputValue,
  type LocalInputOccurrence,
  localInputOccurrenceForInstant,
  localInputResolutionError,
  toLocalInputValue,
} from '@/components/calendar/datetime-input';
import { DatePicker } from '@/components/date-picker';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
type ScheduleMode = WorkLocationSchedule['type'];

/** Props for {@link ScheduleEditorDialog}. */
export interface ScheduleEditorDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly places: readonly WorkPlaceOut[];
  readonly timezone: string;
  readonly assertion: WorkLocationAssertionOut | null;
  readonly pending: boolean;
  readonly onSave: (value: WorkLocationAssertionCreate) => void;
}

/** Return a local `HH:mm` value as minutes after midnight. */
function timeMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

/** Return canonical minutes as a local `HH:mm` editor value. */
function minuteInput(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** Render a complete schedule editor only while the user creates or edits a series. */
export function ScheduleEditorDialog({
  open,
  onOpenChange,
  places,
  timezone,
  assertion,
  pending,
  onSave,
}: ScheduleEditorDialogProps): JSX.Element {
  const [placeId, setPlaceId] = useState('');
  const [mode, setMode] = useState<ScheduleMode>('one_off_all_day');
  const [date, setDate] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [startOccurrence, setStartOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [endOccurrence, setEndOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const schedule = assertion?.schedule;
    setPlaceId(assertion?.placeId ?? places[0]?.id ?? '');
    setMode(schedule?.type ?? 'one_off_all_day');
    setEffectiveUntil(
      schedule?.type === 'weekly_all_day' || schedule?.type === 'weekly_timed'
        ? (schedule.effectiveUntil ?? '')
        : '',
    );
    setWeekdays(
      schedule?.type === 'weekly_all_day' || schedule?.type === 'weekly_timed'
        ? schedule.weekdays
        : [0, 1, 2, 3, 4],
    );
    if (schedule?.type === 'one_off_all_day') setDate(schedule.date);
    else if (schedule?.type === 'one_off_timed') {
      const localStart = toLocalInputValue(schedule.startsAt, timezone);
      const localEnd = toLocalInputValue(schedule.endsAt, timezone);
      setDate(localStart.split('T')[0] ?? '');
      setStartTime(localStart.split('T')[1] ?? '09:00');
      setEndTime(localEnd.split('T')[1] ?? '17:00');
      setStartOccurrence(localInputOccurrenceForInstant(schedule.startsAt, timezone));
      setEndOccurrence(localInputOccurrenceForInstant(schedule.endsAt, timezone));
    } else if (schedule?.type === 'weekly_all_day') setDate(schedule.effectiveFrom);
    else if (schedule?.type === 'weekly_timed') {
      setDate(schedule.effectiveFrom);
      setStartTime(minuteInput(schedule.startMinute));
      setEndTime(minuteInput(schedule.endMinute));
    } else {
      setDate('');
      setStartTime('09:00');
      setEndTime('17:00');
      setStartOccurrence(null);
      setEndOccurrence(null);
    }
    setError(null);
  }, [assertion, open, places, timezone]);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const selectedPlace = places.find((place) => place.id === placeId);
    const startMinute = timeMinutes(startTime);
    const endMinute = timeMinutes(endTime);
    if (!selectedPlace || !date) return;

    let schedule: WorkLocationSchedule | null = null;
    if (mode === 'one_off_all_day') schedule = { type: mode, date, timezone };
    else if (mode === 'one_off_timed' && startMinute !== null && endMinute !== null) {
      const startsAtInput = `${date}T${startTime}`;
      const endsAtInput = `${date}T${endTime}`;
      const resolutionError =
        localInputResolutionError(startsAtInput, timezone, startOccurrence, 'start') ??
        localInputResolutionError(endsAtInput, timezone, endOccurrence, 'end');
      if (resolutionError) {
        setError(resolutionError);
        return;
      }
      const startsAt = fromLocalInputValue(startsAtInput, timezone, startOccurrence);
      const endsAt = fromLocalInputValue(endsAtInput, timezone, endOccurrence);
      if (startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt)) {
        schedule = { type: mode, startsAt, endsAt, timezone };
      }
    } else if (mode === 'weekly_all_day' && weekdays.length > 0) {
      schedule = {
        type: mode,
        effectiveFrom: date,
        effectiveUntil: effectiveUntil || null,
        weekdays,
        timezone,
      };
    } else if (
      mode === 'weekly_timed' &&
      weekdays.length > 0 &&
      startMinute !== null &&
      endMinute !== null &&
      endMinute > startMinute
    ) {
      schedule = {
        type: mode,
        effectiveFrom: date,
        effectiveUntil: effectiveUntil || null,
        weekdays,
        startMinute,
        endMinute,
        timezone,
      };
    }
    if (!schedule) {
      setError('Choose a valid date and time range.');
      return;
    }
    setError(null);
    onSave({ placeId: selectedPlace.id, schedule });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{assertion ? 'Edit schedule' : 'Add schedule'}</DialogTitle>
          <DialogDescription>Choose where you expect to work and when.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 @2xl:grid-cols-2" onSubmit={submit}>
          <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
            Place
            <Select
              value={placeId}
              onChange={(event) => {
                setPlaceId(event.target.value);
              }}
            >
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
            Schedule
            <Select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as ScheduleMode);
                setError(null);
              }}
            >
              <option value="one_off_all_day">One day · all day</option>
              <option value="one_off_timed">One day · part day</option>
              <option value="weekly_all_day">Weekly · all day</option>
              <option value="weekly_timed">Weekly · part day</option>
            </Select>
          </label>
          <div className="text-on-surface-variant text-label-medium flex flex-col gap-1">
            <span>{mode.startsWith('weekly') ? 'Effective from' : 'Date'}</span>
            <DatePicker
              ariaLabel={mode.startsWith('weekly') ? 'Effective from' : 'Date'}
              placeholder="Pick a day"
              triggerVariant="outline"
              value={date || null}
              max={effectiveUntil || undefined}
              onChange={(nextDate) => {
                setDate(nextDate ?? '');
                setStartOccurrence(null);
                setEndOccurrence(null);
              }}
            />
          </div>
          {mode.startsWith('weekly') ? (
            <div className="text-on-surface-variant text-label-medium flex flex-col gap-1">
              <span>Ends</span>
              <DatePicker
                ariaLabel="End date"
                placeholder="No end date"
                triggerVariant="outline"
                value={effectiveUntil || null}
                min={date || undefined}
                onChange={(nextDate) => {
                  setEffectiveUntil(nextDate ?? '');
                }}
              />
            </div>
          ) : null}
          {mode.endsWith('timed') ? (
            <>
              <CalendarTimeField
                label="Start"
                inputType="time"
                date={date}
                value={startTime}
                displayTimezone={timezone}
                occurrence={startOccurrence}
                onValueChange={(value) => {
                  setStartTime(value);
                  setStartOccurrence(null);
                }}
                onOccurrenceChange={setStartOccurrence}
              />
              <CalendarTimeField
                label="End"
                inputType="time"
                date={date}
                value={endTime}
                displayTimezone={timezone}
                occurrence={endOccurrence}
                onValueChange={(value) => {
                  setEndTime(value);
                  setEndOccurrence(null);
                }}
                onOccurrenceChange={setEndOccurrence}
              />
            </>
          ) : null}
          {mode.startsWith('weekly') ? (
            <fieldset className="flex flex-wrap gap-3 @2xl:col-span-2">
              <legend className="text-on-surface-variant text-label-medium mb-1">Weekdays</legend>
              {WEEKDAYS.map((label, day) => (
                <label
                  key={label}
                  className="text-on-surface flex min-h-10 items-center gap-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={weekdays.includes(day)}
                    onChange={(event) => {
                      setWeekdays((current) =>
                        event.target.checked
                          ? [...current, day].sort()
                          : current.filter((value) => value !== day),
                      );
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}
          {error ? (
            <p role="alert" className="text-error text-body-small @2xl:col-span-2">
              {error}
            </p>
          ) : null}
          <DialogFooter className="@2xl:col-span-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!placeId || !date || pending}>
              Save schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
