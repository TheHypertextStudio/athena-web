'use client';
import type { JSX } from 'react';
import { Field, Input, Select } from '@docket/ui/primitives';
import { LabelsPicker } from '@docket/ui/components';
import { TemplateDraft } from '@docket/work/template-contract';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Edit the same starting values the ordinary work composer already understands. */
export function WorkTemplateSampleFields({
  orgId,
  form,
}: {
  orgId: string;
  form: WorkTemplateFormState;
}): JSX.Element {
  const payload = form.definition.payload;
  const disabled = form.pending || !form.canEdit;
  const change = (patch: Readonly<Record<string, unknown>>): void => {
    form.setDefinition((value) => ({
      ...value,
      payload: TemplateDraft.parse({ ...value.payload, ...patch }),
    }));
  };
  const title = payload.targetType === 'task' ? payload.title : payload.name;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Field
        label={payload.targetType === 'task' ? 'Starting title' : 'Starting name'}
        description="Leave empty for the person creating work to supply."
      >
        <Input
          value={title ?? ''}
          disabled={disabled}
          onChange={(event) => {
            change({ [payload.targetType === 'task' ? 'title' : 'name']: event.target.value });
          }}
        />
      </Field>
      {payload.targetType !== 'task' ? (
        <Field label="Starting summary">
          <Input
            value={payload.summary ?? ''}
            maxLength={280}
            disabled={disabled}
            onChange={(event) => {
              change({ summary: event.target.value });
            }}
          />
        </Field>
      ) : null}
      <SampleProperties orgId={orgId} payload={payload} disabled={disabled} change={change} />
    </div>
  );
}

function SampleProperties({
  orgId,
  payload,
  disabled,
  change,
}: {
  orgId: string;
  payload: TemplateDraft;
  disabled: boolean;
  change: (patch: Readonly<Record<string, unknown>>) => void;
}): JSX.Element {
  return (
    <>
      {payload.targetType === 'task' || payload.targetType === 'initiative' ? (
        <Field label="Starting priority">
          <Select
            value={payload.priority ?? ''}
            disabled={disabled}
            onChange={(event) => {
              change({ priority: event.target.value || undefined });
            }}
          >
            <option value="">No default</option>
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            {payload.targetType === 'task' ? <option value="urgent">Urgent</option> : null}
          </Select>
        </Field>
      ) : null}
      {payload.targetType !== 'task' ? (
        <Field label="Starting health">
          <Select
            value={payload.health ?? ''}
            disabled={disabled}
            onChange={(event) => {
              change({ health: event.target.value || undefined });
            }}
          >
            <option value="">No default</option>
            <option value="on_track">On track</option>
            <option value="at_risk">At risk</option>
            <option value="off_track">Off track</option>
          </Select>
        </Field>
      ) : (
        <SampleLabels
          orgId={orgId}
          value={payload.labelIds ?? []}
          disabled={disabled}
          change={change}
        />
      )}
      <OngoingDefaults payload={payload} disabled={disabled} change={change} />
    </>
  );
}

function SampleLabels({
  orgId,
  value,
  disabled,
  change,
}: {
  orgId: string;
  value: readonly string[];
  disabled: boolean;
  change: (patch: Readonly<Record<string, unknown>>) => void;
}): JSX.Element {
  const options = useComposerOptions(orgId, ['labels'], true);
  return (
    <Field label="Starting labels">
      <LabelsPicker
        options={options.labelOptions}
        value={value}
        onToggle={(id) => {
          change({
            labelIds: value.includes(id) ? value.filter((item) => item !== id) : [...value, id],
          });
        }}
        disabled={disabled || options.loading}
      />
    </Field>
  );
}

function OngoingDefaults({
  payload,
  disabled,
  change,
}: {
  payload: TemplateDraft;
  disabled: boolean;
  change: (patch: Readonly<Record<string, unknown>>) => void;
}): JSX.Element {
  return (
    <>
      {payload.targetType === 'program' ? (
        <Field label="Starting work visibility">
          <Select
            value={payload.visibility ?? ''}
            disabled={disabled}
            onChange={(event) => {
              change({ visibility: event.target.value || undefined });
            }}
          >
            <option value="">Workspace default</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </Select>
        </Field>
      ) : null}
      {payload.targetType === 'initiative' ? (
        <Field label="Starting update cadence">
          <Select
            value={payload.updateCadence ?? ''}
            disabled={disabled}
            onChange={(event) => {
              change({ updateCadence: event.target.value || undefined });
            }}
          >
            <option value="">Workspace default</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every two weeks</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="none">None</option>
          </Select>
        </Field>
      ) : null}
    </>
  );
}
