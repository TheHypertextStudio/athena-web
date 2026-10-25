'use client';
import type { JSX } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft } from '@docket/ui/icons';
import { Button, Checkbox, Field, Select } from '@docket/ui/primitives';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import type { BlueprintWorkKind } from '@docket/work/blueprints';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import {
  blueprintChildKinds,
  blueprintStepName,
  moveBlueprintChild,
  removeBlueprintChild,
  reparentBlueprintChild,
  withBlueprintStepDates,
} from './work-template-blueprint-edit';
import { TemplateDisclosure } from './template-disclosure';
import {
  WorkTemplateBlueprintStepFields,
  WorkTemplateBlueprintStartingProperties,
} from './work-template-blueprint-step-fields';
import { WorkTemplateBlueprintReferenceFields } from './work-template-blueprint-reference-fields';
import { blueprintParentDateLabel } from './work-template-blueprint-timing';
import { WorkTemplateBlueprintDateFields } from './work-template-blueprint-date-fields';
import {
  WorkTemplateBlueprintDependencies,
  WorkTemplateBlueprintRules,
} from './work-template-blueprint-relations';

/** Shared controlled authoring context; every edit stays in the canonical draft. */
export interface BlueprintEditorProps {
  orgId: string;
  blueprint: Blueprint;
  rootKind: BlueprintWorkKind;
  templates: readonly WorkTemplateOut[];
  disabled: boolean;
  onChange: (blueprint: Blueprint) => void;
  onAdd: (kind: BlueprintStep['kind'], parent: string | null) => void;
}
/** Add an allowed child kind through the existing controlled definition. */
export function BlueprintAddChildren({
  kind,
  disabled,
  onAdd,
}: {
  kind: BlueprintWorkKind;
  disabled: boolean;
  onAdd: (kind: BlueprintStep['kind']) => void;
}): JSX.Element {
  const labels = {
    program: useVocabulary('program').toLocaleLowerCase(),
    project: useVocabulary('project').toLocaleLowerCase(),
    task: useVocabulary('task').toLocaleLowerCase(),
    milestone: 'milestone',
  };
  return (
    <div className="flex flex-wrap gap-2">
      {blueprintChildKinds(kind).map((childKind) => (
        <Button
          key={childKind}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onAdd(childKind);
          }}
        >
          Add{' '}
          {kind === 'task'
            ? labels.task === 'task'
              ? 'subtask'
              : `child ${labels.task}`
            : labels[childKind]}
        </Button>
      ))}
    </div>
  );
}
/** One authored child with accessible fields and explicit descendant actions. */
export function BlueprintChildCard(
  props: BlueprintEditorProps & {
    step: BlueprintStep;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  },
): JSX.Element {
  const { step, blueprint, disabled, onChange } = props;
  const update = (next: BlueprintStep): void => {
    onChange({
      ...blueprint,
      steps: blueprint.steps.map((value) => (value.key === step.key ? next : value)),
    });
  };
  const siblings = blueprint.steps.filter(
    (value) => value.key !== step.key && value.parentStepKey === step.parentStepKey,
  );
  return (
    <section
      id={`blueprint-child-${step.key}`}
      role="group"
      aria-label={`Child work: ${blueprintStepName(step)}`}
      className="flex scroll-mt-48 flex-col gap-4"
    >
      <ChildEditorHeading
        step={step}
        onClose={() => {
          props.onOpenChange(false);
        }}
      />
      <WorkTemplateBlueprintStepFields
        orgId={props.orgId}
        step={step}
        disabled={disabled}
        onChange={update}
      />
      <section className="flex flex-col gap-2" aria-label="Include this work">
        <h4 className="text-label-large">Include this work</h4>
        <OptionalFields step={step} disabled={disabled} onChange={update} />
      </section>
      <TemplateDisclosure title="Dates">
        <ChildDates
          step={step}
          blueprint={blueprint}
          rootKind={props.rootKind}
          siblings={siblings}
          disabled={disabled}
          onChange={update}
        />
        <WorkTemplateBlueprintDependencies
          blueprint={blueprint}
          step={step}
          disabled={disabled}
          onChange={onChange}
        />
      </TemplateDisclosure>
      <TemplateDisclosure title="Responsibility">
        <WorkTemplateBlueprintRules step={step} disabled={disabled} onChange={update} />
      </TemplateDisclosure>
      <WorkTemplateBlueprintStartingProperties
        orgId={props.orgId}
        step={step}
        disabled={disabled}
        onChange={update}
      />
      <TemplateDisclosure title="Template and location">
        <WorkTemplateBlueprintReferenceFields
          orgId={props.orgId}
          step={step}
          templates={props.templates}
          disabled={disabled}
          onChange={update}
        />
        <ParentField {...props} />
      </TemplateDisclosure>
      <ChildActions {...props} />
    </section>
  );
}

function ChildEditorHeading({
  step,
  onClose,
}: {
  readonly step: BlueprintStep;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col items-start gap-3">
      <Button type="button" variant="ghost" size="sm" className="px-0 sm:px-3" onClick={onClose}>
        <ChevronLeft aria-hidden className="size-4" />
        Back to included work
      </Button>
      <h3 tabIndex={-1} className="text-title-large min-w-0 break-words outline-none">
        {blueprintStepName(step)}
      </h3>
    </div>
  );
}
function OptionalFields({
  step,
  disabled,
  onChange,
}: {
  step: BlueprintStep;
  disabled: boolean;
  onChange: (step: BlueprintStep) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-4">
      <label className="text-body-medium flex min-h-10 items-center gap-2 sm:min-h-0">
        <Checkbox
          checked={step.optional.enabled}
          disabled={disabled}
          onChange={(event) => {
            onChange({
              ...step,
              optional: {
                enabled: event.target.checked,
                selectedByDefault: event.target.checked ? step.optional.selectedByDefault : true,
              },
            });
          }}
        />
        Make optional
      </label>
      {step.optional.enabled ? (
        <label className="text-body-medium flex min-h-10 items-center gap-2 sm:min-h-0">
          <Checkbox
            disabled={disabled}
            checked={step.optional.selectedByDefault}
            onChange={(event) => {
              onChange({
                ...step,
                optional: { ...step.optional, selectedByDefault: event.target.checked },
              });
            }}
          />
          Include by default
        </label>
      ) : null}
    </div>
  );
}
function ParentField({
  blueprint,
  step,
  rootKind,
  disabled,
  onChange,
}: BlueprintEditorProps & {
  step: BlueprintStep;
}): JSX.Element {
  const descendants = new Set([step.key]);
  let count = 0;
  while (count !== descendants.size) {
    count = descendants.size;
    for (const other of blueprint.steps)
      if (other.parentStepKey && descendants.has(other.parentStepKey)) descendants.add(other.key);
  }
  const choices = blueprint.steps.filter(
    (other) => !descendants.has(other.key) && blueprintChildKinds(other.kind).includes(step.kind),
  );
  return (
    <Field label="Included under">
      <Select
        value={step.parentStepKey ?? ''}
        disabled={disabled}
        onChange={(event) => {
          onChange(reparentBlueprintChild(blueprint, step.key, event.target.value || null));
        }}
      >
        {blueprintChildKinds(rootKind).includes(step.kind) ? (
          <option value="">This work</option>
        ) : null}
        {choices.map((other) => (
          <option key={other.key} value={other.key}>
            {blueprintStepName(other)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
function ChildDates({
  step,
  blueprint,
  rootKind,
  siblings,
  disabled,
  onChange,
}: {
  step: BlueprintStep;
  blueprint: Blueprint;
  rootKind: BlueprintWorkKind;
  siblings: readonly BlueprintStep[];
  disabled: boolean;
  onChange: (step: BlueprintStep) => void;
}): JSX.Element {
  const fields =
    step.kind === 'program'
      ? []
      : step.kind === 'milestone'
        ? (['targetDate'] as const)
        : step.kind === 'task'
          ? (['startDate', 'dueDate'] as const)
          : (['startDate', 'targetDate'] as const);
  return (
    <>
      {fields.map((field) => (
        <WorkTemplateBlueprintDateFields
          key={field}
          parentDateLabel={blueprintParentDateLabel(
            step,
            blueprint,
            'The containing work',
            rootKind,
          )}
          label={field === 'startDate' ? 'Start' : field === 'dueDate' ? 'Due' : 'Target'}
          value={field in step.dates ? step.dates[field as keyof typeof step.dates] : undefined}
          siblings={siblings}
          disabled={disabled}
          onChange={(value) => {
            onChange(withBlueprintStepDates(step, { ...step.dates, [field]: value }));
          }}
        />
      ))}
    </>
  );
}
function ChildActions({
  blueprint,
  step,
  disabled,
  onChange,
  onAdd,
}: BlueprintEditorProps & { step: BlueprintStep }): JSX.Element {
  const siblings = blueprint.steps
    .filter((other) => other.parentStepKey === step.parentStepKey)
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const position = siblings.findIndex((other) => other.key === step.key);
  return (
    <>
      <BlueprintAddChildren
        kind={step.kind}
        disabled={disabled || blueprint.steps.length >= 499}
        onAdd={(kind) => {
          onAdd(kind, step.key);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-0 sm:px-3"
          disabled={disabled || position === 0}
          onClick={() => {
            onChange(moveBlueprintChild(blueprint, step.key, -1));
          }}
        >
          Move earlier
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-0 sm:px-3"
          disabled={disabled || position === siblings.length - 1}
          onClick={() => {
            onChange(moveBlueprintChild(blueprint, step.key, 1));
          }}
        >
          Move later
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-0 sm:px-3"
          disabled={disabled}
          onClick={() => {
            onChange(removeBlueprintChild(blueprint, step.key));
          }}
        >
          Remove work and its included items
        </Button>
      </div>
    </>
  );
}
