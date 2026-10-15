'use client';
import type { JSX } from 'react';
import { RecurrenceWeekday } from '@docket/work/recurrence';
import { Button } from '@docket/ui/primitives';

/** Choose at least one calendar weekday in either an absolute or reusable cadence. */
export function RepeatWeekdaySelection({
  value,
  onChange,
}: {
  readonly value: readonly RecurrenceWeekday[];
  readonly onChange: (value: RecurrenceWeekday[]) => void;
}): JSX.Element {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-label-medium">On</legend>
      <div className="grid min-w-0 grid-cols-4 gap-1 sm:grid-cols-7">
        {RecurrenceWeekday.options.map((day) => {
          const selected = value.includes(day);
          return (
            <Button
              key={day}
              type="button"
              variant={selected ? 'secondary' : 'ghost'}
              size="sm"
              className="min-w-0 px-0"
              aria-label={day.slice(0, 1).toUpperCase() + day.slice(1)}
              aria-pressed={selected}
              onClick={() => {
                if (selected && value.length === 1) return;
                onChange(
                  selected
                    ? value.filter((item) => item !== day)
                    : RecurrenceWeekday.options.filter(
                        (item) => value.includes(item) || item === day,
                      ),
                );
              }}
            >
              {day[0]?.toUpperCase()}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
