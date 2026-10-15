'use client';
import { useState, type JSX } from 'react';
import type { ProgramDefaultSchedulePreview } from '@docket/work/work-template-blueprint';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Surface } from '@docket/ui/primitives';

/** Review independent Program schedule copies without hiding their destination or first run. */
export function BlueprintDefaultScheduleReview({
  schedules,
}: {
  readonly schedules: readonly ProgramDefaultSchedulePreview[];
}): JSX.Element | null {
  const [limit, setLimit] = useState(20);
  const program = useVocabulary('program');
  const project = useVocabulary('project');
  const task = useVocabulary('task');
  if (schedules.length === 0) return null;
  return (
    <Surface tone="card" shape="medium" pad="roomy" className="flex min-w-0 flex-col gap-3">
      <div>
        <h3 className="text-title-medium">Independent schedules</h3>
        <p className="text-body-medium text-on-surface-variant mt-1">
          {schedules.length} {schedules.length === 1 ? 'routine comes' : 'routines come'} with this
          work. Each {program} keeps its own editable copy in Schedules.
        </p>
      </div>
      <ul className="flex min-w-0 flex-col gap-3">
        {schedules.slice(0, limit).map((schedule) => (
          <li
            key={`${JSON.stringify(schedule.programPath)}:${schedule.key}`}
            className="flex min-w-0 flex-col gap-1"
          >
            <p className="text-title-small break-words">{schedule.name}</p>
            <p className="text-body-medium text-on-surface-variant break-words">
              {schedule.programName} · {schedule.targetType === 'project' ? project : task} ·{' '}
              {cadenceLabel(schedule)}
            </p>
            <p className="text-body-small text-on-surface-variant">
              First run {schedule.firstRunDate} · {schedule.timezone}
            </p>
            <p className="text-body-small text-on-surface-variant break-words">
              Titles: {schedule.titlePattern}
            </p>
          </li>
        ))}
      </ul>
      {limit < schedules.length ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setLimit((current) => current + 20);
          }}
        >
          More schedules ({schedules.length - limit} remaining)
        </Button>
      ) : null}
    </Surface>
  );
}
function cadenceLabel(schedule: ProgramDefaultSchedulePreview): string {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[
    schedule.cadenceKind
  ];
  return schedule.interval === 1 ? `Every ${unit}` : `Every ${schedule.interval} ${unit}s`;
}
