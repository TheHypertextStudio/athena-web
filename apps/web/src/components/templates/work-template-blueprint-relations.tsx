import type { JSX } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import { Checkbox, Field, Select } from '@docket/ui/primitives';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import { blueprintStepName } from './work-template-blueprint-edit';

/** Parent-relative responsibility, team and cycle choices without literal person/team/cycle IDs. */
export function WorkTemplateBlueprintRules({
  step,
  disabled,
  onChange,
}: {
  step: BlueprintStep;
  disabled: boolean;
  onChange: (step: BlueprintStep) => void;
}): JSX.Element | null {
  const team = useVocabulary('team');
  const cycle = useVocabulary('cycle');
  const task = useVocabulary('task');
  if (step.kind === 'milestone') return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <WorkTemplateAssignmentRules
        value={step}
        disabled={disabled}
        onChange={(patch) => {
          onChange({ ...step, ...patch });
        }}
      />
      {step.kind === 'task' ? (
        <Field label={`${cycle} rule`}>
          <Select
            disabled={disabled}
            value={step.cycleRule}
            onChange={(event) => {
              onChange({
                ...step,
                cycleRule: event.target.value as 'none' | 'parent_cycle' | 'current_cycle',
              });
            }}
          >
            <option value="none">No {cycle.toLocaleLowerCase()}</option>
            <option value="parent_cycle">
              Nearest parent {task}'s {cycle.toLocaleLowerCase()}
            </option>
            <option value="current_cycle">
              Current {cycle.toLocaleLowerCase()} for the selected {team.toLocaleLowerCase()}
            </option>
          </Select>
        </Field>
      ) : null}
    </div>
  );
}
/** Reusable parent-relative assignment controls without literal people or team identifiers. */
export function WorkTemplateAssignmentRules({
  value,
  onChange,
  disabled,
  parentLabel = 'Parent',
}: {
  readonly value: Pick<Exclude<BlueprintStep, { kind: 'milestone' }>, 'actorRule' | 'teamRule'>;
  readonly onChange: (
    patch: Partial<Pick<Exclude<BlueprintStep, { kind: 'milestone' }>, 'actorRule' | 'teamRule'>>,
  ) => void;
  readonly disabled: boolean;
  readonly parentLabel?: string;
}): JSX.Element {
  const team = useVocabulary('team');
  return (
    <>
      {' '}
      <Field label="Responsible person">
        <Select
          disabled={disabled}
          value={value.actorRule}
          onChange={(event) => {
            onChange({ actorRule: event.target.value as typeof value.actorRule });
          }}
        >
          <option value="unassigned">Unassigned</option>
          <option value="parent_responsible">{parentLabel}'s responsible person</option>
          <option value="creator">Person creating the work</option>
          <option value="athena">Athena</option>
        </Select>
      </Field>
      <Field label={`${team} rule`}>
        <Select
          disabled={disabled}
          value={value.teamRule}
          onChange={(event) => {
            onChange({ teamRule: event.target.value as typeof value.teamRule });
          }}
        >
          <option value="parent_team">
            {parentLabel}'s {team.toLocaleLowerCase()}, otherwise creation{' '}
            {team.toLocaleLowerCase()}
          </option>
          <option value="creation_team">Creation {team.toLocaleLowerCase()}</option>
          <option value="none">No inherited {team.toLocaleLowerCase()}</option>
        </Select>
      </Field>
    </>
  );
}
/** Dependencies remain explicit between authored sibling Tasks. */
export function WorkTemplateBlueprintDependencies({
  blueprint,
  step,
  disabled,
  onChange,
}: {
  blueprint: Blueprint;
  step: BlueprintStep;
  disabled: boolean;
  onChange: (blueprint: Blueprint) => void;
}): JSX.Element | null {
  if (step.kind !== 'task') return null;
  const siblings = blueprint.steps.filter(
    (other) =>
      other.kind === 'task' && other.parentStepKey === step.parentStepKey && other.key !== step.key,
  );
  if (!siblings.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-label-large">Sibling dependencies</h4>
      {siblings.map((other) => (
        <label key={other.key} className="text-body-medium flex items-center gap-2">
          <Checkbox
            disabled={disabled}
            checked={blueprint.dependencies.some(
              (edge) => edge.blockerStepKey === other.key && edge.blockedStepKey === step.key,
            )}
            onChange={(event) => {
              const remaining = blueprint.dependencies.filter(
                (edge) => edge.blockerStepKey !== other.key || edge.blockedStepKey !== step.key,
              );
              onChange({
                ...blueprint,
                dependencies: event.target.checked
                  ? [...remaining, { blockerStepKey: other.key, blockedStepKey: step.key }]
                  : remaining,
              });
            }}
          />
          Blocked by {blueprintStepName(other)}
        </label>
      ))}
    </div>
  );
}
