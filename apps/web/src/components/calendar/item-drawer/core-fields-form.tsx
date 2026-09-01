'use client';

import { WorkPlaceId } from '@docket/planning/ids';
import { type CalendarItemOut } from '@docket/planning/calendar-contract';
import { type WorkPlaceOut } from '@docket/planning/work-location-contract';
import { Input, Select, Textarea } from '@docket/ui/primitives';
import { type JSX, useEffect, useId, useState } from 'react';

import { DatePicker } from '@/components/date-picker';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

import { CalendarTimeField } from '../calendar-time-field';
import { calendarRangeError } from '../calendar-range-validation';
import {
  fromLocalInputValue,
  localInputOccurrenceForInstant,
  localInputResolutionError,
  toLocalInputValue,
} from '../datetime-input';
import { useUpdateCalendarItem } from '../calendar-mutations';
import { useRebasedField, useRebasedLocalTimeField } from './core-field-draft';
import { fromAllDayEndSeed, localAllDayEndSeed } from './presentation';

/** Props for {@link CoreFieldsForm}. */
export interface CoreFieldsFormProps {
  /** Hub display timezone used to interpret native datetime-local values. */
  displayTimezone: string;
  /** Calendar item whose editable core fields are shown. */
  item: CalendarItemOut;
  /** Report unsaved field changes so the owning drawer can guard dismissal. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Caller-loaded arbitrary saved places available for canonical binding. */
  workPlaces?: readonly WorkPlaceOut[];
}

/** Inline title, description, location, and time editor for one calendar item. */
export function CoreFieldsForm({
  displayTimezone,
  item,
  onDirtyChange,
  workPlaces = [],
}: CoreFieldsFormProps): JSX.Element {
  const update = useUpdateCalendarItem(item.id);
  const canEdit = item.permissions.canEditCore;
  const timed = item.startsAt !== null;
  const localInputSeed = (iso: string | null): string =>
    iso ? toLocalInputValue(iso, displayTimezone) : '';
  const startSeed = localInputSeed(item.startsAt);
  const endSeed = localInputSeed(item.endsAt);
  const startOccurrenceSeed = item.startsAt
    ? localInputOccurrenceForInstant(item.startsAt, displayTimezone)
    : null;
  const endOccurrenceSeed = item.endsAt
    ? localInputOccurrenceForInstant(item.endsAt, displayTimezone)
    : null;

  const [title, setTitle] = useRebasedField(item.title);
  const [description, setDescription] = useRebasedField(item.description ?? '');
  const [location, setLocation] = useRebasedField(item.location ?? '');
  const [workPlaceId, setWorkPlaceId] = useRebasedField(item.workPlaceId ?? '');
  const startTime = useRebasedLocalTimeField(startSeed, startOccurrenceSeed);
  const endTime = useRebasedLocalTimeField(endSeed, endOccurrenceSeed);
  const { wallValue: startsAt, occurrence: startOccurrence } = startTime;
  const { wallValue: endsAt, occurrence: endOccurrence } = endTime;
  const [allDayStart, setAllDayStart] = useRebasedField(item.allDayStartDate ?? '');
  const [allDayEnd, setAllDayEnd] = useRebasedField(localAllDayEndSeed(item.allDayEndDate));
  const [timeError, setTimeError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const timeErrorId = useId();
  const titleErrorId = useId();
  const startTimeEdited = startTime.dirty;
  const endTimeEdited = endTime.dirty;

  const dirty =
    title !== item.title ||
    description !== (item.description ?? '') ||
    location !== (item.location ?? '') ||
    (timed
      ? startTimeEdited || endTimeEdited
      : allDayStart !== (item.allDayStartDate ?? '') ||
        allDayEnd !== localAllDayEndSeed(item.allDayEndDate));

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => {
      onDirtyChange?.(false);
    };
  }, [dirty, onDirtyChange]);

  // --- Autosave (replaces the former "Save changes" button) -----------------
  // Text fields persist on blur; the schedule fields persist on a quiet debounce because native
  // date/time pickers behave like selects. Each commit fires the exact same update mutation the
  // Save button used, scoped to only the field(s) it touches, and guards against no-op writes.

  /** Persist a single-text rename-style field on blur, only when it actually changed. */
  const commitText = (key: 'title' | 'description' | 'location'): void => {
    if (!canEdit) return;
    if (key === 'title') {
      if (title === item.title) return;
      if (title.trim().length === 0) {
        setTitleError('Enter a title to save your changes.');
        return;
      }
      update.mutate({ title });
      return;
    }
    if (key === 'description') {
      if (description === (item.description ?? '')) return;
      update.mutate({ description });
      return;
    }
    if (location === (item.location ?? '')) return;
    update.mutate({ location });
  };

  /** Resolve, range-check, and persist the schedule fields as one atomic timed/all-day patch. */
  const commitSchedule = (): void => {
    if (!canEdit) return;
    if (timed) {
      if (!startTimeEdited && !endTimeEdited) return;
      const startResolutionError = startTimeEdited
        ? localInputResolutionError(startsAt, displayTimezone, startOccurrence, 'start')
        : null;
      const endResolutionError = endTimeEdited
        ? localInputResolutionError(endsAt, displayTimezone, endOccurrence, 'end')
        : null;
      if (startResolutionError || endResolutionError) {
        setTimeError(startResolutionError ?? endResolutionError);
        return;
      }
      const startInstant = startTimeEdited
        ? fromLocalInputValue(startsAt, displayTimezone, startOccurrence)
        : (item.startsAt ?? null);
      const endInstant = endTimeEdited
        ? fromLocalInputValue(endsAt, displayTimezone, endOccurrence)
        : (item.endsAt ?? null);
      const rangeError = calendarRangeError(startInstant, endInstant);
      if (rangeError) {
        setTimeError(rangeError);
        return;
      }
      update.mutate({ startsAt: startInstant ?? undefined, endsAt: endInstant ?? undefined });
      return;
    }
    if (
      allDayStart === (item.allDayStartDate ?? '') &&
      allDayEnd === localAllDayEndSeed(item.allDayEndDate)
    ) {
      return;
    }
    const allDayExclusiveEnd = fromAllDayEndSeed(allDayEnd);
    const rangeError = calendarRangeError(allDayStart, allDayExclusiveEnd);
    if (rangeError) {
      setTimeError(rangeError);
      return;
    }
    update.mutate({ allDayStartDate: allDayStart, allDayEndDate: allDayExclusiveEnd });
  };

  // Diff the schedule draft against its persisted seed so the debounce only fires on real edits.
  const scheduleDraft = timed
    ? {
        mode: 'timed' as const,
        start: `${startsAt}|${startOccurrence ?? ''}`,
        end: `${endsAt}|${endOccurrence ?? ''}`,
      }
    : { mode: 'all-day' as const, start: allDayStart, end: allDayEnd };
  const scheduleBaseline = timed
    ? {
        mode: 'timed' as const,
        start: `${startSeed}|${startOccurrenceSeed ?? ''}`,
        end: `${endSeed}|${endOccurrenceSeed ?? ''}`,
      }
    : {
        mode: 'all-day' as const,
        start: item.allDayStartDate ?? '',
        end: localAllDayEndSeed(item.allDayEndDate),
      };
  useDebouncedAutosave({
    value: scheduleDraft,
    baseline: scheduleBaseline,
    ready: canEdit,
    save: () => {
      commitSchedule();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <label className="text-label-medium flex flex-col gap-1">
        <span className="text-on-surface-variant">Title</span>
        <Input
          value={title}
          disabled={!canEdit}
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? titleErrorId : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleError(null);
          }}
          onBlur={() => {
            commitText('title');
          }}
        />
        {titleError ? (
          <span id={titleErrorId} role="alert" className="text-error text-xs font-normal">
            {titleError}
          </span>
        ) : null}
      </label>
      <label className="text-label-medium flex flex-col gap-1">
        <span className="text-on-surface-variant">Saved place</span>
        <Select
          value={workPlaceId}
          onChange={(event) => {
            const next = event.target.value;
            setWorkPlaceId(next);
            update.mutate({ workPlaceId: next ? WorkPlaceId.parse(next) : null });
          }}
        >
          <option value="">No saved place</option>
          {workPlaces.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Description</span>
        <Textarea
          value={description}
          disabled={!canEdit}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          onBlur={() => {
            commitText('description');
          }}
          rows={3}
          className="resize-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Location</span>
        <Input
          value={location}
          disabled={!canEdit}
          onChange={(event) => {
            setLocation(event.target.value);
          }}
          onBlur={() => {
            commitText('location');
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {timed ? (
          <>
            <CalendarTimeField
              label="Starts"
              value={startsAt}
              displayTimezone={displayTimezone}
              occurrence={startOccurrence}
              disabled={!canEdit}
              invalid={Boolean(timeError)}
              describedBy={timeError ? timeErrorId : undefined}
              onValueChange={(value) => {
                startTime.setWallValue(value);
                setTimeError(null);
              }}
              onOccurrenceChange={(occurrence) => {
                startTime.setOccurrence(occurrence);
                setTimeError(null);
              }}
            />
            <CalendarTimeField
              label="Ends"
              value={endsAt}
              displayTimezone={displayTimezone}
              occurrence={endOccurrence}
              disabled={!canEdit}
              invalid={Boolean(timeError)}
              describedBy={timeError ? timeErrorId : undefined}
              onValueChange={(value) => {
                endTime.setWallValue(value);
                setTimeError(null);
              }}
              onOccurrenceChange={(occurrence) => {
                endTime.setOccurrence(occurrence);
                setTimeError(null);
              }}
            />
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-on-surface-variant text-label-medium">Starts</span>
              <DatePicker
                ariaLabel="Starts"
                placeholder="Pick a day"
                triggerVariant="outline"
                disabled={!canEdit}
                invalid={Boolean(timeError)}
                describedBy={timeError ? timeErrorId : undefined}
                value={allDayStart === '' ? null : allDayStart}
                onChange={(next) => {
                  setAllDayStart(next ?? '');
                  setTimeError(null);
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-on-surface-variant text-label-medium">Ends</span>
              <DatePicker
                ariaLabel="Ends"
                placeholder="Pick a day"
                triggerVariant="outline"
                disabled={!canEdit}
                invalid={Boolean(timeError)}
                describedBy={timeError ? timeErrorId : undefined}
                value={allDayEnd === '' ? null : allDayEnd}
                onChange={(next) => {
                  setAllDayEnd(next ?? '');
                  setTimeError(null);
                }}
              />
            </div>
          </>
        )}
      </div>
      {timeError ? (
        <p id={timeErrorId} role="alert" className="text-error text-xs">
          {timeError}
        </p>
      ) : null}
      {canEdit ? (
        <div className="min-h-4">
          {update.isError ? (
            <p role="alert" className="text-error text-xs">
              We couldn&apos;t save these changes. Please try again.
            </p>
          ) : (
            <p aria-live="polite" className="text-on-surface-variant text-xs">
              {update.isPending ? 'Saving…' : update.isSuccess ? 'Saved' : ''}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
