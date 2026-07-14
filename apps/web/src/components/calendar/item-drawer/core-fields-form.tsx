'use client';

import type { CalendarItemOut } from '@docket/types';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, type SubmitEventHandler, useEffect, useId, useState } from 'react';

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
}

/** Inline title, description, location, and time editor for one calendar item. */
export function CoreFieldsForm({
  displayTimezone,
  item,
  onDirtyChange,
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
  const startTime = useRebasedLocalTimeField(startSeed, startOccurrenceSeed);
  const endTime = useRebasedLocalTimeField(endSeed, endOccurrenceSeed);
  const { wallValue: startsAt, occurrence: startOccurrence } = startTime;
  const { wallValue: endsAt, occurrence: endOccurrence } = endTime;
  const [allDayStart, setAllDayStart] = useRebasedField(item.allDayStartDate ?? '');
  const [allDayEnd, setAllDayEnd] = useRebasedField(localAllDayEndSeed(item.allDayEndDate));
  const [timeError, setTimeError] = useState<string | null>(null);
  const timeErrorId = useId();
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

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!canEdit || !dirty || title.trim().length === 0) return;
    const startResolutionError =
      timed && startTimeEdited
        ? localInputResolutionError(startsAt, displayTimezone, startOccurrence, 'start')
        : null;
    const endResolutionError =
      timed && endTimeEdited
        ? localInputResolutionError(endsAt, displayTimezone, endOccurrence, 'end')
        : null;
    if (startResolutionError || endResolutionError) {
      setTimeError(startResolutionError ?? endResolutionError);
      return;
    }
    const startInstant =
      timed && !startTimeEdited
        ? (item.startsAt ?? null)
        : fromLocalInputValue(startsAt, displayTimezone, startOccurrence);
    const endInstant =
      timed && !endTimeEdited
        ? (item.endsAt ?? null)
        : fromLocalInputValue(endsAt, displayTimezone, endOccurrence);
    const allDayExclusiveEnd = timed ? null : fromAllDayEndSeed(allDayEnd);
    const rangeError = calendarRangeError(
      timed ? startInstant : allDayStart,
      timed ? endInstant : allDayExclusiveEnd,
    );
    if (rangeError) {
      setTimeError(rangeError);
      return;
    }
    update.mutate({
      title,
      description,
      location,
      ...(timed
        ? { startsAt: startInstant ?? undefined, endsAt: endInstant ?? undefined }
        : { allDayStartDate: allDayStart, allDayEndDate: allDayExclusiveEnd ?? undefined }),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Title</span>
        <Input
          value={title}
          disabled={!canEdit}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        <span className="text-on-surface-variant">Description</span>
        <textarea
          value={description}
          disabled={!canEdit}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          rows={3}
          className="border-outline-variant text-body-medium flex w-full resize-none rounded-md border bg-transparent px-3 py-2 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
              <span className="text-on-surface-variant">Starts</span>
              <Input
                type="date"
                value={allDayStart}
                disabled={!canEdit}
                aria-invalid={Boolean(timeError)}
                aria-describedby={timeError ? timeErrorId : undefined}
                onChange={(event) => {
                  setAllDayStart(event.target.value);
                  setTimeError(null);
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
              <span className="text-on-surface-variant">Ends</span>
              <Input
                type="date"
                value={allDayEnd}
                disabled={!canEdit}
                aria-invalid={Boolean(timeError)}
                aria-describedby={timeError ? timeErrorId : undefined}
                onChange={(event) => {
                  setAllDayEnd(event.target.value);
                  setTimeError(null);
                }}
              />
            </label>
          </>
        )}
      </div>
      {timeError ? (
        <p id={timeErrorId} role="alert" className="text-destructive text-xs">
          {timeError}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {update.isError ? (
            <p role="alert" className="text-destructive text-xs">
              We couldn&apos;t save these changes. Please try again.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
