'use client';
import type { JSX } from 'react';
import type { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import { Surface } from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { calendarRecurrenceSummary } from '@/components/recurrence/repeat-task-control';
import { WorkTemplateReviewNestedVersion } from './work-template-review-child-details';

/** Read back the independent reusable routines each newly created Program receives. */
export function ProgramDefaultScheduleReview({
  orgId,
  values,
  templates,
}: {
  readonly orgId: string;
  readonly values: readonly ProgramDefaultSchedule[];
  readonly templates: readonly WorkTemplateOut[];
}): JSX.Element | null {
  const program = useVocabulary('program');
  const team = useVocabulary('team').toLocaleLowerCase();
  if (!values.length) return null;
  return (
    <Surface
      as="section"
      tone="card"
      shape="large"
      pad="roomy"
      className="flex min-w-0 flex-col gap-4"
      aria-label="Recurring work review"
    >
      <h2 className="text-title-large">Recurring work</h2>
      <p className="text-body-medium text-on-surface-variant">
        Each new {program} keeps its own schedules. Later definition changes leave existing copies
        intact.
      </p>
      <ol className="flex min-w-0 flex-col gap-4">
        {values.map((value) => (
          <li key={value.key} className="flex min-w-0 flex-col gap-1">
            <h3 className="text-title-small break-words">{value.name}</h3>
            <p className="text-body-medium">{calendarRecurrenceSummary(value.cadence)}</p>
            <p className="text-body-small text-on-surface-variant">
              {relativeStart(value.cadence.startOffsetDays, program)} ·{' '}
              {value.cadence.end.kind === 'after_count'
                ? `${value.cadence.end.count} runs`
                : 'No end'}
            </p>
            <p className="text-body-small text-on-surface-variant break-words">
              Run title: {value.titlePattern}
            </p>
            <WorkTemplateReviewNestedVersion
              orgId={orgId}
              template={value.template}
              name={
                templates.find((item) => item.id === value.template.workTypeId)?.definition.name ??
                'Selected work template'
              }
            />
            <p className="text-body-small text-on-surface-variant">
              {actorRule(value.actorRule, program)} · {teamRule(value.teamRule, program, team)}
            </p>
          </li>
        ))}
      </ol>
    </Surface>
  );
}
function relativeStart(days: number, program: string): string {
  if (days === 0) return `Begins when the ${program} is created`;
  return `Begins ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days < 0 ? 'before' : 'after'} ${program} creation`;
}
function actorRule(value: ProgramDefaultSchedule['actorRule'], program: string): string {
  return {
    creator: `Person creating the ${program}`,
    parent_responsible: `${program} owner`,
    athena: 'Athena',
    unassigned: 'Unassigned',
  }[value];
}
function teamRule(
  value: ProgramDefaultSchedule['teamRule'],
  program: string,
  team: string,
): string {
  return {
    parent_team: `${program} ${team}, otherwise selected ${team}`,
    creation_team: `Selected ${team}`,
    none: `No inherited ${team}`,
  }[value];
}
