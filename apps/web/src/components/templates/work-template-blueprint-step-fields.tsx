import type { JSX } from 'react';
import { Field, Input, Select, fieldSurface } from '@docket/ui/primitives';
import { LabelsPicker } from '@docket/ui/components';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import { patchBlueprintStepFields } from './work-template-blueprint-edit';
import { LabelId } from '@docket/work/ids';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { TemplateDisclosure } from './template-disclosure';
import { FreeformTextEditor } from '@/components/editor/freeform-text';

interface StepProps {
  orgId: string;
  step: BlueprintStep;
  disabled: boolean;
  onChange: (step: BlueprintStep) => void;
}
/** Ordinary reusable child fields, with the existing Markdown editor and shared property controls. */
export function WorkTemplateBlueprintStepFields({
  orgId,
  step,
  disabled,
  onChange,
}: StepProps): JSX.Element {
  const title = step.kind === 'task' ? step.fields.title : step.fields.name;
  const patch = (fields: Readonly<Record<string, unknown>>): void => {
    onChange(patchBlueprintStepFields(step, fields));
  };
  return (
    <>
      <Field label={step.kind === 'task' ? 'Child title' : 'Child name'}>
        <Input
          autoFocus
          disabled={disabled}
          value={title}
          onChange={(event) => {
            patch({ [step.kind === 'task' ? 'title' : 'name']: event.target.value });
          }}
        />
      </Field>
      {step.kind !== 'milestone' ? (
        <Field label="Child summary">
          <Input
            disabled={disabled}
            value={step.fields.summary ?? ''}
            maxLength={step.kind === 'task' ? 200 : 280}
            onChange={(event) => {
              patch({ summary: event.target.value });
            }}
          />
        </Field>
      ) : null}
      <Field label="Child document">
        <FreeformTextEditor
          value={step.fields.description ?? ''}
          onChange={(description) => {
            if ((step.fields.description ?? '') !== description) patch({ description });
          }}
          disabled={disabled}
          readOnly={disabled}
          ariaLabel="Child document"
          mentionOrgId={orgId}
          placeholder="Write the structure this child starts with…"
          className={`${fieldSurface({ variant: 'plain', controlSize: 'md', multiline: true, ringOn: 'within' })} min-h-24 max-w-none`}
        />
      </Field>
      <TemplateDisclosure title="Child properties">
        <ChildProperties orgId={orgId} step={step} disabled={disabled} onChange={onChange} />
      </TemplateDisclosure>
    </>
  );
}
function ChildProperties({ orgId, step, disabled, onChange }: StepProps): JSX.Element | null {
  const registry = useStatusRegistry();
  if (step.kind === 'milestone') return null;
  const patch = (fields: Readonly<Record<string, unknown>>): void => {
    onChange(patchBlueprintStepFields(step, fields));
  };
  return (
    <>
      <Field label="Child starting status">
        <Select
          disabled={disabled}
          value={step.kind === 'task' ? (step.fields.state ?? '') : (step.fields.status ?? '')}
          onChange={(event) => {
            patch({ [step.kind === 'task' ? 'state' : 'status']: event.target.value || undefined });
          }}
        >
          <option value="">Use template or workspace default</option>
          {registry.statusesFor(step.kind).map((status) => (
            <option key={status.key} value={status.key}>
              {status.name}
            </option>
          ))}
        </Select>
      </Field>
      {step.kind !== 'program' ? (
        <Field label="Child priority">
          <Select
            disabled={disabled}
            value={step.fields.priority ?? ''}
            onChange={(event) => {
              patch({ priority: event.target.value || undefined });
            }}
          >
            <option value="">Use template default</option>
            {['none', 'low', 'medium', 'high', 'urgent'].map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {step.kind === 'task' ? (
        <TaskEffortFields orgId={orgId} step={step} disabled={disabled} onChange={onChange} />
      ) : (
        <Field label="Child health">
          <Select
            disabled={disabled}
            value={step.fields.health ?? ''}
            onChange={(event) => {
              patch({ health: event.target.value || undefined });
            }}
          >
            <option value="">Use template default</option>
            <option value="on_track">On track</option>
            <option value="at_risk">At risk</option>
            <option value="off_track">Off track</option>
          </Select>
        </Field>
      )}
      {step.kind === 'program' ? (
        <Field label="Child visibility">
          <Select
            disabled={disabled}
            value={step.fields.visibility ?? ''}
            onChange={(event) => {
              patch({ visibility: event.target.value || undefined });
            }}
          >
            <option value="">Use template or workspace default</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </Select>
        </Field>
      ) : null}
    </>
  );
}
function TaskEffortFields({
  orgId,
  step,
  disabled,
  onChange,
}: StepProps & { step: Extract<BlueprintStep, { kind: 'task' }> }): JSX.Element {
  const options = useComposerOptions(orgId, ['labels'], true);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Child point estimate">
          <Input
            type="number"
            min={0}
            step={1}
            disabled={disabled}
            value={step.fields.estimate ?? ''}
            onChange={(event) => {
              onChange({
                ...step,
                fields: {
                  ...step.fields,
                  estimate: event.target.value ? Number(event.target.value) : undefined,
                },
              });
            }}
          />
        </Field>
        <Field label="Child time estimate (minutes)">
          <Input
            type="number"
            min={0}
            step={1}
            disabled={disabled}
            value={step.fields.estimateMinutes ?? ''}
            onChange={(event) => {
              onChange({
                ...step,
                fields: {
                  ...step.fields,
                  estimateMinutes: event.target.value ? Number(event.target.value) : null,
                },
              });
            }}
          />
        </Field>
      </div>
      <Field label="Child labels">
        <LabelsPicker
          options={options.labelOptions}
          value={step.fields.labelIds ?? []}
          disabled={disabled || options.loading}
          onToggle={(id) => {
            const labels = step.fields.labelIds ?? [];
            onChange({
              ...step,
              fields: {
                ...step.fields,
                labelIds: labels.includes(LabelId.parse(id))
                  ? labels.filter((value) => value !== id)
                  : [...labels, LabelId.parse(id)],
              },
            });
          }}
        />
      </Field>
    </>
  );
}
