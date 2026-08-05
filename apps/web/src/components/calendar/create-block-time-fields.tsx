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
      {/*
        Stacked, not side by side: a native `datetime-local` renders a full localized date AND time
        (`08/02/2026, 02:00 AM`), which clipped mid-value in half the popover's 320px width. A
        two-up grid saves a little height and costs the value being readable, which is the wrong
        trade for the field the whole form exists to set — and it breaks again in any locale with a
        longer date format.
      */}
      <div className="grid grid-cols-1 gap-2">
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
        <p id={errorId} role="alert" className="text-error text-body-small">
          {error}
        </p>
      ) : null}
    </>
  );
}
