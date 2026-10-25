import { useState, type JSX } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import { Checkbox, Field, Input, Select } from '@docket/ui/primitives';
import type { BlueprintDateRule, BlueprintStep } from '@docket/work/work-template-blueprint';
import { blueprintStepName } from './work-template-blueprint-edit';

interface DateProps {
  label: string;
  parentDateLabel?: string;
  value: BlueprintDateRule | undefined;
  siblings: readonly BlueprintStep[];
  disabled: boolean;
  onChange: (value: BlueprintDateRule) => void;
}
function ruleKind(rule: BlueprintDateRule | undefined): string {
  if (!rule || rule.kind === 'none') return 'none';
  if (rule.kind === 'after_completion') return rule.kind;
  return rule.anchor.kind === 'parent' ? 'parent' : `milestone:${rule.anchor.stepKey}`;
}
function changeKind(kind: string, value: BlueprintDateRule | undefined): BlueprintDateRule {
  const offset =
    value && value.kind !== 'none' ? value.offset : { days: 0, unit: 'calendar' as const };
  const snap = value && value.kind !== 'none' ? value.snap : undefined;
  if (kind === 'none') return { kind: 'none' };
  if (kind === 'after_completion')
    return { kind, stepKeys: [], offset: { ...offset, days: Math.max(0, offset.days) }, snap };
  return {
    kind: 'anchor',
    anchor: kind === 'parent' ? { kind: 'parent' } : { kind: 'milestone', stepKey: kind.slice(10) },
    offset,
    snap,
  };
}
/** Relative civil-date controls; no absolute dates or concrete work IDs enter reusable steps. */
export function WorkTemplateBlueprintDateFields(props: DateProps): JSX.Element {
  const tasks = useVocabulary('task', { plural: true });
  const {
    label,
    value,
    siblings,
    disabled,
    onChange,
    parentDateLabel = 'The containing work’s target date',
  } = props;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field label={label === 'Start' ? 'Starts' : label === 'Due' ? 'Is due' : 'Target date'}>
        <Select
          value={ruleKind(value)}
          disabled={disabled}
          onChange={(event) => {
            onChange(changeKind(event.target.value, value));
          }}
        >
          <option value="none">Choose later</option>
          <option value="parent">{parentDateLabel}</option>
          {siblings
            .filter((step) => step.kind === 'milestone')
            .map((step) => (
              <option key={step.key} value={`milestone:${step.key}`}>
                {blueprintStepName(step)}’s target date
              </option>
            ))}
          {siblings.some((step) => step.kind === 'task') ? (
            <option value="after_completion">After other {tasks} finish</option>
          ) : null}
        </Select>
      </Field>
      {value && value.kind !== 'none' ? <TimingDetails {...props} value={value} /> : null}
    </div>
  );
}
function TimingDetails({
  label,
  value,
  siblings,
  disabled,
  onChange,
}: DateProps & { value: Exclude<BlueprintDateRule, { kind: 'none' }> }): JSX.Element {
  return (
    <>
      <CompletionFields
        label={label}
        value={value}
        siblings={siblings}
        disabled={disabled}
        onChange={onChange}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <OffsetDays
          key={ruleKind(value)}
          label={label}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
        <Field label={`${label}: count days as`}>
          <Select
            disabled={disabled}
            value={value.offset.unit}
            onChange={(event) => {
              onChange({
                ...value,
                offset: {
                  ...value.offset,
                  unit: event.target.value === 'working' ? 'working' : 'calendar',
                },
              });
            }}
          >
            <option value="calendar">Calendar days</option>
            <option value="working">Working days</option>
          </Select>
        </Field>
      </div>
      <WeekdayFields label={label} value={value} disabled={disabled} onChange={onChange} />
    </>
  );
}
function WeekdayFields({
  label,
  value,
  disabled,
  onChange,
}: Omit<DateProps, 'siblings'> & {
  value: Exclude<BlueprintDateRule, { kind: 'none' }>;
}): JSX.Element {
  return (
    <>
      <Field label={`${label}: move to a weekday`}>
        <Select
          disabled={disabled}
          value={value.snap?.direction ?? ''}
          onChange={(event) => {
            if (!event.target.value) {
              const { snap: _snap, ...rest } = value;
              onChange(rest);
            } else
              onChange({
                ...value,
                snap: {
                  weekday: value.snap?.weekday ?? 1,
                  inclusive: value.snap?.inclusive ?? false,
                  direction: event.target.value === 'previous' ? 'previous' : 'next',
                },
              });
          }}
        >
          <option value="">Keep calculated date</option>
          <option value="next">Move to next weekday</option>
          <option value="previous">Move to previous weekday</option>
        </Select>
      </Field>
      {value.snap ? (
        <>
          <Field label={`${label}: weekday`}>
            <Select
              disabled={disabled}
              value={value.snap.weekday}
              onChange={(event) => {
                onChange({
                  ...value,
                  snap: {
                    ...(value.snap ?? { direction: 'next', weekday: 1, inclusive: false }),
                    weekday: Number(event.target.value),
                  },
                });
              }}
            >
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
                (day, index) => (
                  <option key={day} value={index + 1}>
                    {day}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <label className="text-body-medium flex min-h-10 items-center gap-2 sm:min-h-0">
            <Checkbox
              disabled={disabled}
              checked={value.snap.inclusive}
              onChange={(event) => {
                onChange({
                  ...value,
                  snap: {
                    ...(value.snap ?? { direction: 'next', weekday: 1, inclusive: false }),
                    inclusive: event.target.checked,
                  },
                });
              }}
            />
            {label}: allow the same day
          </label>
        </>
      ) : null}
    </>
  );
}

function CompletionFields({
  label,
  value,
  siblings,
  disabled,
  onChange,
}: DateProps & { value: Exclude<BlueprintDateRule, { kind: 'none' }> }): JSX.Element {
  return (
    <>
      {value.kind === 'after_completion' ? (
        <div className="flex flex-col gap-2">
          <p className="text-body-small text-on-surface-variant">
            This work is created now. Its date is set after all the chosen work finishes.
          </p>
          {siblings
            .filter((step) => step.kind === 'task')
            .map((step) => (
              <label
                key={step.key}
                className="text-body-medium flex min-h-10 items-center gap-2 sm:min-h-0"
              >
                <Checkbox
                  disabled={disabled}
                  checked={value.stepKeys.includes(step.key)}
                  onChange={(event) => {
                    onChange({
                      ...value,
                      stepKeys: event.target.checked
                        ? [...value.stepKeys, step.key]
                        : value.stepKeys.filter((key) => key !== step.key),
                    });
                  }}
                />
                {label}: after {blueprintStepName(step)} finishes
              </label>
            ))}
        </div>
      ) : null}
    </>
  );
}

function parseOffset(raw: string, minimum: number): number | undefined {
  if (!raw.trim()) return undefined;
  const days = Number(raw);
  return Number.isInteger(days) && days >= minimum && days <= 36500 ? days : undefined;
}
function OffsetDays({
  label,
  value,
  disabled,
  onChange,
}: Omit<DateProps, 'siblings'> & {
  value: Exclude<BlueprintDateRule, { kind: 'none' }>;
}): JSX.Element {
  const [raw, setRaw] = useState(String(value.offset.days));
  const minimum = value.kind === 'after_completion' ? 0 : -36500;
  const invalid = raw !== '' && parseOffset(raw, minimum) === undefined;
  return (
    <Field
      label={
        minimum === 0 ? `${label}: days after finishing` : `${label}: days before (−) or after (+)`
      }
      description={
        minimum === 0
          ? 'Number of days after the chosen work finishes.'
          : 'Use a negative number for days before, zero for the same day, or a positive number for days after.'
      }
      {...(invalid
        ? {
            error:
              minimum === 0
                ? 'Enter a whole number of days from 0 to 36500.'
                : 'Enter a whole number of days between −36500 and 36500.',
          }
        : {})}
    >
      <Input
        type="number"
        min={minimum}
        max={36500}
        step={1}
        disabled={disabled}
        value={raw}
        aria-invalid={invalid}
        onBlur={() => {
          setRaw(String(value.offset.days));
        }}
        onChange={(event) => {
          setRaw(event.target.value);
          const days = parseOffset(event.target.value, minimum);
          if (days !== undefined) onChange({ ...value, offset: { ...value.offset, days } });
        }}
      />
    </Field>
  );
}
