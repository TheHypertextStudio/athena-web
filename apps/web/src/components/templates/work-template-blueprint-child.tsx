'use client';
import type { JSX } from 'react';
import { Surface } from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
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
    <Surface
      tone="prominent"
      shape="medium"
      pad="roomy"
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
      <section className="flex flex-col gap-2" aria-label="Child inclusion">
        <h4 className="text-label-large">Inclusion</h4>
        <OptionalFields step={step} disabled={disabled} onChange={update} />
      </section>
      <TemplateDisclosure title="Dates">
        <ChildDates step={step} siblings={siblings} disabled={disabled} onChange={update} />
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
      <TemplateDisclosure title="Template and placement">
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
    </Surface>
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
    <div className="flex min-w-0 items-center justify-between gap-2">
      <h3 className="text-title-large min-w-0 break-words">{blueprintStepName(step)}</h3>
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        Back to outline
      </Button>
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
      <label className="text-body-medium flex items-center gap-2">
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
        Optional child
      </label>
      {step.optional.enabled ? (
        <label className="text-body-medium flex items-center gap-2">
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
          Selected by default
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
    <Field label="Child parent">
      <Select
        value={step.parentStepKey ?? ''}
        disabled={disabled}
        onChange={(event) => {
          onChange(reparentBlueprintChild(blueprint, step.key, event.target.value || null));
        }}
      >
        {blueprintChildKinds(rootKind).includes(step.kind) ? (
          <option value="">Root item</option>
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
  siblings,
  disabled,
  onChange,
}: {
  step: BlueprintStep;
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
          disabled={disabled}
          onClick={() => {
            onChange(removeBlueprintChild(blueprint, step.key));
          }}
        >
          Remove child and descendants
        </Button>
      </div>
    </>
  );
}
