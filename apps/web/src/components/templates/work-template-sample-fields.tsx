'use client';
import type { JSX } from 'react';
import { Field, Input, Select } from '@docket/ui/primitives';
import { LabelsPicker } from '@docket/ui/components';
import { CanonicalTemplateDraft } from '@docket/work/template-contract';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { TemplateDisclosure } from './template-disclosure';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Edit the same starting values the ordinary work composer already understands. */
export function WorkTemplateSampleFields({
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
      payload: CanonicalTemplateDraft.parse({ ...value.payload, ...patch }),
    }));
  };
  const title = payload.targetType === 'task' ? payload.title : payload.name;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Field
        label="Name for new work"
        description={
          title?.trim() ? undefined : 'Leave empty for the person creating work to supply.'
        }
      >
        <Input
          value={title ?? ''}
          disabled={disabled}
          onChange={(event) => {
            change({ [payload.targetType === 'task' ? 'title' : 'name']: event.target.value });
          }}
        />
      </Field>
    </div>
  );
}

/** An optional summary follows the main starting document without competing with it. */
export function WorkTemplateSampleSummary({
  form,
}: {
  readonly form: WorkTemplateFormState;
}): JSX.Element {
  const payload = form.definition.payload;
  return (
    <TemplateDisclosure
      title={payload.summary ? 'Starting summary' : 'Add a starting summary'}
      defaultOpen={Boolean(payload.summary?.trim())}
    >
      <Input
        aria-label="Starting summary"
        variant="plain"
        value={payload.summary ?? ''}
        maxLength={payload.targetType === 'task' ? 200 : 280}
        disabled={form.pending || !form.canEdit}
        onChange={(event) => {
          form.setDefinition((value) => ({
            ...value,
            payload: CanonicalTemplateDraft.parse({
              ...value.payload,
              summary: event.target.value,
            }),
          }));
        }}
      />
    </TemplateDisclosure>
  );
}

/** Less frequent starting values reuse the canonical sample payload. */
export function WorkTemplateSampleProperties({
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
      payload: CanonicalTemplateDraft.parse({ ...value.payload, ...patch }),
    }));
  };
  return (
    <TemplateDisclosure title="Starting properties">
      {payload.targetType !== 'program' ? (
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
            {payload.targetType !== 'initiative' ? <option value="urgent">Urgent</option> : null}
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
      {payload.targetType === 'task' ? (
        <SampleEffort payload={payload} disabled={disabled} change={change} />
      ) : null}
      <OngoingDefaults payload={payload} disabled={disabled} change={change} />
    </TemplateDisclosure>
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
  payload: CanonicalTemplateDraft;
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

function SampleEffort({
  payload,
  disabled,
  change,
}: {
  payload: Extract<CanonicalTemplateDraft, { targetType: 'task' }>;
  disabled: boolean;
  change: (patch: Readonly<Record<string, unknown>>) => void;
}): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Starting point estimate">
        <Input
          type="number"
          min={0}
          step={1}
          value={payload.estimate ?? ''}
          disabled={disabled}
          onChange={(event) => {
            const estimate = event.target.value ? Number(event.target.value) : undefined;
            if (estimate === undefined || (Number.isInteger(estimate) && estimate >= 0))
              change({ estimate });
          }}
        />
      </Field>
      <Field label="Starting time estimate (minutes)">
        <Input
          type="number"
          min={0}
          step={1}
          value={payload.estimateMinutes ?? ''}
          disabled={disabled}
          onChange={(event) => {
            const estimateMinutes = event.target.value ? Number(event.target.value) : null;
            if (
              estimateMinutes === null ||
              (Number.isInteger(estimateMinutes) && estimateMinutes >= 0)
            )
              change({ estimateMinutes });
          }}
        />
      </Field>
    </div>
  );
}
