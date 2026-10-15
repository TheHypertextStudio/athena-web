'use client';
import type { JSX } from 'react';
import type { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import { useVocabulary } from '@docket/ui/hooks';
import { Button } from '@docket/ui/primitives';
import { calendarRecurrenceSummary } from '@/components/recurrence/repeat-task-control';

/** Recurring work is a branch of the Program definition's ordered work outline. */
export function ProgramDefaultScheduleOutline({
  values,
  selectedKey,
  disabled,
  onSelect,
  onAdd,
}: {
  readonly values: readonly ProgramDefaultSchedule[];
  readonly selectedKey: string | null;
  readonly disabled: boolean;
  readonly onSelect: (key: string) => void;
  readonly onAdd: () => void;
}): JSX.Element {
  const program = useVocabulary('program');
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Program recurring work">
      <h3 className="text-title-medium">Recurring work</h3>
      {values.length ? (
        <ol aria-label="Recurring work outline" className="flex min-w-0 flex-col gap-1">
          {values.map((value) => (
            <li key={value.key} className="min-w-0">
              <Button
                id={`routine-outline-${value.key}`}
                type="button"
                variant={selectedKey === value.key ? 'secondary' : 'ghost'}
                aria-pressed={selectedKey === value.key}
                aria-label={`Edit routine ${value.name}`}
                className="h-auto min-h-12 w-full justify-start py-2 text-left"
                onClick={() => {
                  onSelect(value.key);
                }}
              >
                <span className="flex min-w-0 flex-col gap-1 whitespace-normal">
                  <span className="text-label-large break-words">
                    {value.name || 'Unnamed routine'}
                  </span>
                  <span className="text-body-small text-on-surface-variant break-words">
                    {calendarRecurrenceSummary(value.cadence)}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-body-small text-on-surface-variant">
          Routines that each new {program} will carry forward.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={disabled || values.length >= 20}
        onClick={onAdd}
      >
        Add schedule
      </Button>
      {values.length >= 20 ? (
        <p className="text-body-small text-on-surface-variant">
          This definition has the maximum of 20 routines.
        </p>
      ) : null}
    </section>
  );
}
