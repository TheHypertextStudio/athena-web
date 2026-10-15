import type {
  Blueprint,
  BlueprintDateRule,
  BlueprintStep,
} from '@docket/work/work-template-blueprint';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { blueprintStepName } from './work-template-blueprint-edit';

function ruleAnchor(
  rule: Exclude<BlueprintDateRule, { kind: 'none' }>,
  blueprint: Blueprint,
  parentDate: string,
): string {
  if (rule.kind === 'after_completion') {
    const names = rule.stepKeys
      .map((key) => blueprint.steps.find((step) => step.key === key))
      .filter((step) => step !== undefined)
      .map(blueprintStepName);
    return `${names.length ? names.join(' and ') : 'selected work'} complete`;
  }
  if (rule.anchor.kind === 'parent') return parentDate;
  const key = rule.anchor.stepKey;
  const anchor = blueprint.steps.find((step) => step.key === key);
  return anchor ? blueprintStepName(anchor) : 'Milestone date';
}

function describeRule(
  rule: Exclude<BlueprintDateRule, { kind: 'none' }>,
  blueprint: Blueprint,
  parentDate: string,
): string {
  const anchor = ruleAnchor(rule, blueprint, parentDate);
  const days = Math.abs(rule.offset.days);
  const unit = rule.offset.unit === 'working' ? 'working days' : days === 1 ? 'day' : 'days';
  const offset =
    days === 0
      ? `On ${anchor}`
      : `${days} ${unit} ${rule.offset.days < 0 ? 'before' : 'after'} ${anchor}`;
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return (
    offset +
    (rule.snap
      ? `, then ${rule.snap.direction === 'next' ? 'next' : 'previous'} ${weekdays[rule.snap.weekday - 1]}${rule.snap.inclusive ? ' (including that day)' : ''}`
      : '')
  );
}

/** Human-readable date rules let people scan the child hierarchy before choosing an editor. */
export function blueprintStepTiming(
  step: BlueprintStep,
  blueprint: Blueprint,
  rootName = 'parent',
  rootKind: TemplateTargetType = 'project',
): string {
  const parent = blueprint.steps.find((value) => value.key === step.parentStepKey);
  const parentDate =
    parent?.kind === 'milestone'
      ? blueprintStepName(parent)
      : `${parent ? blueprintStepName(parent) : rootName}${(parent?.kind ?? rootKind) === 'program' ? ' creation' : ''} date`;
  const labels: Readonly<Record<string, string>> = {
    startDate: 'Starts',
    dueDate: 'Due',
    targetDate: 'Target',
  };
  const dates = Object.entries(step.dates).flatMap(([field, rule]) =>
    rule && rule.kind !== 'none'
      ? [`${labels[field]} ${describeRule(rule, blueprint, parentDate).replace(/^On /, 'on ')}`]
      : [],
  );
  return dates.length ? dates.join(' · ') : 'No dates set';
}
