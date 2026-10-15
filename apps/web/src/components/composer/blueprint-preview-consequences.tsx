import type { JSX } from 'react';
import type {
  BlueprintPreviewWarning,
  BlueprintWarningCode,
} from '@docket/work/work-template-blueprint';

const countLabel = (count: number): string => (count > 500 ? '500+' : String(count));
const items = (count: number): string => `${countLabel(count)} ${count === 1 ? 'item' : 'items'}`;
const COPY: Record<BlueprintWarningCode, (count: number) => string> = {
  actor_unavailable: (count) => `${items(count)} will be unassigned.`,
  athena_unavailable: (count) => `Athena is unavailable; ${items(count)} will be unassigned.`,
  cycle_unavailable: (count) => `${items(count)} will have no cycle.`,
  missing_anchor: (count) =>
    `${items(count)} ${count === 1 ? 'needs' : 'need'} a date anchor. Set their parent or milestone dates.`,
  waiting_completion: (count) =>
    `${items(count)} will receive dates after prerequisite completion.`,
  label_unavailable: (count) => `${items(count)} will omit unavailable labels.`,
  capture_actor: (count) =>
    `${countLabel(count)} person ${count === 1 ? 'assignment was' : 'assignments were'} replaced with reusable responsibility rules.`,
  capture_team: (count) =>
    `${countLabel(count)} team ${count === 1 ? 'assignment was' : 'assignments were'} replaced with reusable team rules.`,
  capture_cycle: (count) =>
    `${countLabel(count)} cycle ${count === 1 ? 'choice was' : 'choices were'} replaced with reusable cycle rules.`,
  capture_dependency: (count) =>
    `${countLabel(count)} external ${count === 1 ? 'dependency was' : 'dependencies were'} omitted.`,
  capture_schedule_assignment: (count) =>
    `${countLabel(count)} schedule ${count === 1 ? 'assignment was' : 'assignments were'} replaced with parent-relative rules.`,
  capture_schedule_provider: (count) =>
    `${countLabel(count)} provider-triggered ${count === 1 ? 'routine was' : 'routines were'} omitted; choose a reusable calendar rhythm.`,
  capture_schedule_cadence: (count) =>
    `${countLabel(count)} ${count === 1 ? 'routine needs' : 'routines need'} a reusable calendar rhythm.`,
  capture_schedule_draft: (count) =>
    `${countLabel(count)} unpublished ${count === 1 ? 'routine was' : 'routines were'} omitted.`,
  warning_overflow: () =>
    'Additional consequences are not listed. Review the affected template rules.',
};

/** Concrete, bounded outcomes from stable preview codes; valid unresolved work is not an alarm. */
export function BlueprintPreviewConsequences({
  warnings,
  assignmentLocation,
}: {
  readonly warnings: readonly BlueprintPreviewWarning[];
  readonly assignmentLocation?: 'Work' | undefined;
}): JSX.Element | null {
  if (!warnings.length) return null;
  const unassigned = warnings.some(
    (value) => value.code === 'actor_unavailable' || value.code === 'athena_unavailable',
  );
  return (
    <div
      role="status"
      className="text-body-small text-on-surface-variant flex min-w-0 flex-col gap-2"
    >
      <ul aria-label="Work creation consequences" className="flex min-w-0 flex-col gap-1">
        {warnings.map((warning) => (
          <li key={warning.code}>{COPY[warning.code](warning.count)}</li>
        ))}
      </ul>
      {unassigned ? (
        <p>
          {assignmentLocation
            ? 'Set responsibility in Work to assign them.'
            : 'Choose responsibility before creating the work to assign them.'}
        </p>
      ) : null}
    </div>
  );
}
