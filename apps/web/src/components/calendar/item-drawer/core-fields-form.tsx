'use client';

import type { CalendarItemOut } from '@docket/types';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, type SubmitEventHandler, useState } from 'react';

import { fromLocalInputValue, toLocalInputValue } from '../datetime-input';
import { useUpdateCalendarItem } from '../calendar-mutations';
import { fromAllDayEndSeed, localAllDayEndSeed } from './presentation';

/** Props for {@link CoreFieldsForm}. */
export interface CoreFieldsFormProps {
  /** Hub display timezone used to interpret native datetime-local values. */
  displayTimezone: string;
  /** Calendar item whose editable core fields are shown. */
  item: CalendarItemOut;
}

/** Inline title, description, location, and time editor for one calendar item. */
export function CoreFieldsForm({ displayTimezone, item }: CoreFieldsFormProps): JSX.Element {
  const update = useUpdateCalendarItem(item.id);
  const canEdit = item.permissions.canEditCore;
  const timed = item.startsAt !== null;
  const localInputSeed = (iso: string | null): string =>
    iso ? toLocalInputValue(iso, displayTimezone) : '';

  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [location, setLocation] = useState(item.location ?? '');
  const [startsAt, setStartsAt] = useState(localInputSeed(item.startsAt));
  const [endsAt, setEndsAt] = useState(localInputSeed(item.endsAt));
  const [allDayStart, setAllDayStart] = useState(item.allDayStartDate ?? '');
  const [allDayEnd, setAllDayEnd] = useState(localAllDayEndSeed(item.allDayEndDate));
  const [timeError, setTimeError] = useState(false);

  const dirty =
    title !== item.title ||
    description !== (item.description ?? '') ||
    location !== (item.location ?? '') ||
    (timed
      ? startsAt !== localInputSeed(item.startsAt) || endsAt !== localInputSeed(item.endsAt)
      : allDayStart !== (item.allDayStartDate ?? '') ||
        allDayEnd !== localAllDayEndSeed(item.allDayEndDate));

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!canEdit || !dirty || title.trim().length === 0) return;
    if (!timed && (allDayStart.length === 0 || allDayEnd.length === 0)) return;
    const startInstant =
      timed && startsAt === localInputSeed(item.startsAt)
        ? (item.startsAt ?? null)
        : fromLocalInputValue(startsAt, displayTimezone);
    const endInstant =
      timed && endsAt === localInputSeed(item.endsAt)
        ? (item.endsAt ?? null)
        : fromLocalInputValue(endsAt, displayTimezone);
    if (timed && (!startInstant || !endInstant)) {
      setTimeError(true);
      return;
    }
    update.mutate({
      title,
      description,
      location,
      ...(timed
        ? { startsAt: startInstant ?? undefined, endsAt: endInstant ?? undefined }
        : { allDayStartDate: allDayStart, allDayEndDate: fromAllDayEndSeed(allDayEnd) }),
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
          className="border-outline-variant text-body flex w-full resize-none rounded-md border bg-transparent px-3 py-2 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
        <label className="flex flex-col gap-1 text-xs font-medium">
          <span className="text-on-surface-variant">Starts</span>
          <Input
            type={timed ? 'datetime-local' : 'date'}
            value={timed ? startsAt : allDayStart}
            disabled={!canEdit}
            onChange={(event) => {
              if (timed) setStartsAt(event.target.value);
              else setAllDayStart(event.target.value);
              setTimeError(false);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          <span className="text-on-surface-variant">Ends</span>
          <Input
            type={timed ? 'datetime-local' : 'date'}
            value={timed ? endsAt : allDayEnd}
            disabled={!canEdit}
            onChange={(event) => {
              if (timed) setEndsAt(event.target.value);
              else setAllDayEnd(event.target.value);
              setTimeError(false);
            }}
          />
        </label>
      </div>
      {timeError ? (
        <p role="alert" className="text-destructive text-xs">
          Choose valid start and end times in your calendar timezone.
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
