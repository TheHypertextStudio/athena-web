'use client';

import { Button, Row, Stack } from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { CalendarTimeField } from '@/components/calendar/calendar-time-field';
import {
  fromLocalInputValue,
  type LocalInputOccurrence,
  localInputOccurrenceForInstant,
  localInputResolutionError,
  toLocalInputValue,
} from '@/components/calendar/datetime-input';

import { type AgendaEntry, isTimeboxed, useAgenda } from './agenda-context';

/** Props for the Agenda timebox editor. */
export interface AgendaTimeboxFormProps {
  readonly entry: AgendaEntry;
  readonly date: string;
  readonly onDone: () => void;
}

/** Return the Hub-zone clock value shown by one exact seed. */
function clockSeed(instant: string | null, timezone: string, fallback: string): string {
  return instant ? toLocalInputValue(instant, timezone).slice(11) : fallback;
}

/** Start/end time-only editor with explicit DST-fold occurrence choices. */
export function AgendaTimeboxForm({ entry, date, onDone }: AgendaTimeboxFormProps): JSX.Element {
  const { displayTimezone, setTimebox } = useAgenda();
  const timeboxedEntry = isTimeboxed(entry) ? entry : null;
  const startSeed = timeboxedEntry?.startsAt ?? null;
  const endSeed = timeboxedEntry?.endsAt ?? null;
  const [start, setStart] = useState(() => clockSeed(startSeed, displayTimezone, '09:00'));
  const [end, setEnd] = useState(() => clockSeed(endSeed, displayTimezone, '10:00'));
  const [startEdited, setStartEdited] = useState(false);
  const [endEdited, setEndEdited] = useState(false);
  const [startOccurrence, setStartOccurrence] = useState<LocalInputOccurrence | null>(() =>
    startSeed ? localInputOccurrenceForInstant(startSeed, displayTimezone) : null,
  );
  const [endOccurrence, setEndOccurrence] = useState<LocalInputOccurrence | null>(() =>
    endSeed ? localInputOccurrenceForInstant(endSeed, displayTimezone) : null,
  );
  const errorId = useId();
  const startValue = `${date}T${start}`;
  const endValue = `${date}T${end}`;
  const startError = startEdited
    ? localInputResolutionError(startValue, displayTimezone, startOccurrence, 'start')
    : null;
  const endError = endEdited
    ? localInputResolutionError(endValue, displayTimezone, endOccurrence, 'end')
    : null;
  const startsAt =
    !startEdited && startSeed
      ? startSeed
      : fromLocalInputValue(startValue, displayTimezone, startOccurrence);
  const endsAt =
    !endEdited && endSeed ? endSeed : fromLocalInputValue(endValue, displayTimezone, endOccurrence);
  const validWallTimes = startsAt !== null && endsAt !== null;
  const ordered = validWallTimes && Date.parse(endsAt) > Date.parse(startsAt);
  const error =
    startError ??
    endError ??
    (!validWallTimes
      ? 'Choose valid times in your calendar timezone.'
      : !ordered
        ? 'End time must be after the start time.'
        : null);
  const valid = error === null;

  return (
    <Stack
      as="form"
      gap={3}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !startsAt || !endsAt) return;
        setTimebox(entry, startsAt, endsAt);
        onDone();
      }}
    >
      <Row gap={2} align="start">
        <div className="min-w-0 flex-1">
          <CalendarTimeField
            label="Start"
            value={start}
            inputType="time"
            date={date}
            displayTimezone={displayTimezone}
            occurrence={startOccurrence}
            invalid={Boolean(startError)}
            describedBy={startError ? errorId : undefined}
            onValueChange={(value) => {
              setStartEdited(true);
              setStartOccurrence(null);
              setStart(value);
            }}
            onOccurrenceChange={(occurrence) => {
              setStartEdited(true);
              setStartOccurrence(occurrence);
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <CalendarTimeField
            label="End"
            value={end}
            inputType="time"
            date={date}
            displayTimezone={displayTimezone}
            occurrence={endOccurrence}
            invalid={Boolean(endError)}
            describedBy={endError ? errorId : undefined}
            onValueChange={(value) => {
              setEndEdited(true);
              setEndOccurrence(null);
              setEnd(value);
            }}
            onOccurrenceChange={(occurrence) => {
              setEndEdited(true);
              setEndOccurrence(occurrence);
            }}
          />
        </div>
      </Row>
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={!valid}>
        Set timebox
      </Button>
    </Stack>
  );
}
