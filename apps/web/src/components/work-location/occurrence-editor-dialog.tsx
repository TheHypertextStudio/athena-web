'use client';

/** One-occurrence editor kept separate from whole-series schedule changes. */
import type {
  WorkLocationAssertionOut,
  WorkLocationOccurrenceException,
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

import { DatePicker } from '@/components/date-picker';
import { scheduleInstantAt } from '@/components/scheduling';

type OccurrenceAction = 'cancel' | 'replace' | 'restore';

/** Props for {@link OccurrenceEditorDialog}. */
export interface OccurrenceEditorDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly assertion: WorkLocationAssertionOut | null;
  /** Visible occurrence selected from Calendar or Agenda. */
  readonly date?: string | null;
  readonly places: readonly WorkPlaceOut[];
  readonly pending: boolean;
  readonly onSet: (
    assertionId: WorkLocationAssertionOut['id'],
    date: string,
    input: WorkLocationOccurrenceException,
  ) => void;
  readonly onRestore: (assertionId: WorkLocationAssertionOut['id'], date: string) => void;
}

/** Render one date, one action choice, and one save action for a weekly occurrence. */
export function OccurrenceEditorDialog({
  open,
  onOpenChange,
  assertion,
  date: initialDate = null,
  places,
  pending,
  onSet,
  onRestore,
}: OccurrenceEditorDialogProps): JSX.Element {
  const [date, setDate] = useState('');
  const [action, setAction] = useState<OccurrenceAction>('replace');
  const [placeId, setPlaceId] = useState('');

  useEffect(() => {
    if (!open) return;
    setDate(initialDate ?? '');
    setAction('replace');
    setPlaceId(assertion?.placeId ?? places[0]?.id ?? '');
  }, [assertion, initialDate, open, places]);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!assertion || !date) return;
    if (action === 'restore') {
      onRestore(assertion.id, date);
      return;
    }
    if (action === 'cancel') {
      onSet(assertion.id, date, { action, date });
      return;
    }
    const place = places.find((candidate) => candidate.id === placeId);
    const series = assertion.schedule;
    if (!place || (series.type !== 'weekly_all_day' && series.type !== 'weekly_timed')) return;
    let schedule: Extract<WorkLocationOccurrenceException, { action: 'replace' }>['schedule'];
    if (series.type === 'weekly_all_day') {
      schedule = { type: 'one_off_all_day', date, timezone: series.timezone };
    } else {
      const startsAt = scheduleInstantAt(date, series.startMinute, series.timezone);
      const endsAt = scheduleInstantAt(date, series.endMinute, series.timezone);
      if (!startsAt || !endsAt) return;
      schedule = { type: 'one_off_timed', startsAt, endsAt, timezone: series.timezone };
    }
    onSet(assertion.id, date, { action: 'replace', date, placeId: place.id, schedule });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change one occurrence</DialogTitle>
          <DialogDescription>Leave the rest of this weekly schedule unchanged.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="text-on-surface-variant text-label-medium flex flex-col gap-1">
            <span>Date</span>
            <DatePicker
              ariaLabel="Occurrence date"
              placeholder="Pick a day"
              triggerVariant="outline"
              value={date || null}
              onChange={(nextDate) => {
                setDate(nextDate ?? '');
              }}
            />
          </div>
          <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
            Change
            <Select
              value={action}
              onChange={(event) => {
                setAction(event.target.value as OccurrenceAction);
              }}
            >
              <option value="replace">Work somewhere else</option>
              <option value="cancel">No expected location</option>
              <option value="restore">Restore the weekly schedule</option>
            </Select>
          </label>
          {action === 'replace' ? (
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
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!date || pending}>
              Save occurrence
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
