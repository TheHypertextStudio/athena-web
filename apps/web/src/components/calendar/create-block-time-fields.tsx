'use client';

import type { JSX } from 'react';

import type { CalendarTimeDraft } from './calendar-time-draft';
import { CalendarTimeField } from './calendar-time-field';
import type { LocalInputOccurrence } from './datetime-input';

interface CreateBlockTimeFieldsProps {
  readonly draft: CalendarTimeDraft;
  readonly displayTimezone: string;
  readonly error: string | null;
  readonly errorId: string;
  readonly onStartChange: (value: string) => void;
  readonly onEndChange: (value: string) => void;
  readonly onStartOccurrenceChange: (occurrence: LocalInputOccurrence) => void;
  readonly onEndOccurrenceChange: (occurrence: LocalInputOccurrence) => void;
}

/** Render quick-create wall-time fields and their shared validation message. */
export function CreateBlockTimeFields({
  draft,
  displayTimezone,
  error,
  errorId,
  onStartChange,
  onEndChange,
  onStartOccurrenceChange,
  onEndOccurrenceChange,
}: CreateBlockTimeFieldsProps): JSX.Element {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <CalendarTimeField
          label="Starts"
          value={draft.startsAt}
          displayTimezone={displayTimezone}
          occurrence={draft.startsOccurrence}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
          onValueChange={onStartChange}
          onOccurrenceChange={onStartOccurrenceChange}
        />
        <CalendarTimeField
          label="Ends"
          value={draft.endsAt}
          displayTimezone={displayTimezone}
          occurrence={draft.endsOccurrence}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
          onValueChange={onEndChange}
          onOccurrenceChange={onEndOccurrenceChange}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </>
  );
}
