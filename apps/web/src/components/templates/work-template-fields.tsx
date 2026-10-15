'use client';
import type { JSX } from 'react';
import { Field, Input, Select, Surface, fieldSurface } from '@docket/ui/primitives';
import { EntityMultiPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { TemplateTargetType } from '@docket/work/template-contract';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { WorkTemplateGlyphField } from './work-template-glyph-field';
import { TemplateDisclosure } from './template-disclosure';
import {
  WorkTemplateSampleFields,
  WorkTemplateSampleProperties,
} from './work-template-sample-fields';
import { WorkTemplateBlueprintFields } from './work-template-blueprint-fields';
import type { useWorkTemplateForm } from './use-work-template-form';

type Form = ReturnType<typeof useWorkTemplateForm>;

/** Edit the reusable document and status default without creating a second status system. */
export function WorkTemplateFields({
  orgId,
  form,
  isBase,
}: {
  orgId: string;
  form: Form;
  isBase: boolean;
}): JSX.Element {
  const disabled = form.pending || !form.canEdit;
  const options = useComposerOptions(orgId, ['teams'], true);
  const statusRegistry = useStatusRegistry();
  const statuses = statusRegistry.statusesFor(form.kind);
  const set = form.setDefinition;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <TemplateSampleWork orgId={orgId} form={form} />
        <WorkTemplateBlueprintFields orgId={orgId} form={form} />
      </div>
      <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2">
        <WorkTemplateSampleProperties orgId={orgId} form={form} />
        <TemplateDisclosure title="Template settings">
          <Field
            label="Starting status"
            description="If this status is removed, new work uses its normal starting status."
          >
            <Select
              value={form.definition.defaultStatusKey ?? ''}
              disabled={disabled}
              onChange={(event) => {
                set((value) => ({ ...value, defaultStatusKey: event.target.value || null }));
              }}
            >
              <option value="">Workspace default</option>
              {statuses.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.name}
                </option>
              ))}
            </Select>
          </Field>
          {!isBase && (form.kind === 'project' || form.kind === 'task') ? (
            <TeamOfferingField
              orgId={orgId}
              form={form}
              teams={options.teamOptions}
              loading={options.loading}
            />
          ) : null}
        </TemplateDisclosure>
      </div>
    </div>
  );
}

function TemplateSampleWork({ orgId, form }: { orgId: string; form: Form }): JSX.Element {
  const disabled = form.pending || !form.canEdit;
  const set = form.setDefinition;
  return (
    <Surface
      as="section"
      tone="floating"
      shape="extra-large"
      pad="roomy"
      aria-label="Sample work"
      id="template-outline"
      tabIndex={-1}
      className="flex min-w-0 scroll-mt-48 flex-col gap-5 sm:p-6"
    >
      <div>
        <h2 tabIndex={-1} className="text-title-large">
          Sample work
        </h2>
        <p className="text-body-small text-on-surface-variant">
          The starting outline for every new item.
        </p>
      </div>
      <WorkTemplateSampleFields orgId={orgId} form={form} />
      <Surface tone="well" shape="large" pad="roomy">
        <Field label="Starting document">
          <FreeformTextEditor
            value={form.definition.payload.description ?? ''}
            onChange={(description) => {
              set((value) =>
                (value.payload.description ?? '') === description
                  ? value
                  : { ...value, payload: { ...value.payload, description } },
              );
            }}
            disabled={disabled}
            readOnly={!form.canEdit}
            placeholder="Write the structure people should start with…"
            ariaLabel="Starting document"
            mentionOrgId={orgId}
            className={`${fieldSurface({ variant: 'plain', controlSize: 'md', multiline: true, ringOn: 'within' })} min-h-24 max-w-none`}
          />
        </Field>
      </Surface>
    </Surface>
  );
}

/** Administrators control creation offerings independently of workspace-wide publication visibility. */
function TeamOfferingField({
  orgId,
  form,
  teams,
  loading,
}: {
  orgId: string;
  form: Form;
  teams: readonly { value: string; label: string }[];
  loading: boolean;
}): JSX.Element {
  const { canManage } = useCanManageOrg(orgId);
  const disabled = form.pending || !form.canEdit || loading || !canManage;
  return (
    <Field
      label="Offer to teams"
      description={
        canManage
          ? 'Leave empty to offer throughout the workspace. Published templates are visible to everyone.'
          : 'Administrators choose team offerings. Published templates remain visible throughout the workspace.'
      }
    >
      <EntityMultiPicker
        options={teams}
        value={form.offeredTeamIds}
        singularLabel="team"
        pluralLabel="teams"
        onToggle={(id) => {
          form.setOfferedTeamIds((ids) =>
            ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
          );
        }}
        placeholder="Every team"
        ariaLabel="Offer to teams"
        disabled={disabled}
      />
    </Field>
  );
}

function KindOption({ kind }: { kind: TemplateTargetType }): JSX.Element {
  const noun = useVocabulary(kind);
  return <option value={kind}>{noun}</option>;
}

function DraftPrivacyFields({
  form,
  teams,
}: {
  form: Form;
  teams: readonly { value: string; label: string }[];
}): JSX.Element {
  return (
    <>
      <Field label="Draft visible to">
        <Select
          value={form.scope}
          disabled={form.pending}
          onChange={(event) => {
            form.setScope(event.target.value === 'team' ? 'team' : 'personal');
          }}
        >
          <option value="personal">Only you</option>
          <option value="team">A team</option>
        </Select>
      </Field>
      {form.scope === 'team' ? (
        <Field label="Private draft team">
          <Select
            value={form.teamId}
            disabled={form.pending}
            onChange={(event) => {
              form.setTeamId(event.target.value);
            }}
          >
            <option value="">Choose a team</option>
            {teams.map((team) => (
              <option key={team.value} value={team.value}>
                {team.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </>
  );
}

/** Name the actual work this organization repeats before shaping its reusable structure. */
export function WorkTemplatePurposeFields({
  orgId,
  form,
  existing,
  isBase,
}: {
  orgId: string;
  form: Form;
  existing: boolean;
  isBase: boolean;
}): JSX.Element {
  const options = useComposerOptions(orgId, ['teams'], true);
  const disabled = form.pending || !form.canEdit;
  const set = form.setDefinition;
  return (
    <div className="flex max-w-2xl min-w-0 flex-col gap-5">
      <div>
        <h2 tabIndex={-1} className="text-title-large">
          What kind of work is this?
        </h2>
        <p className="text-body-medium text-on-surface-variant">
          Give a kind of work a shared name, such as Event, client engagement, or volunteer
          onboarding.
        </p>
      </div>
      <TemplateKindField form={form} existing={existing} />
      <Field label="Template name">
        <Input
          variant="plain"
          className="text-title-large"
          placeholder="Name this template"
          value={form.definition.name}
          disabled={disabled || isBase}
          onChange={(event) => {
            set((value) => ({ ...value, name: event.target.value }));
          }}
        />
      </Field>
      <Field label="When to use it">
        <Input
          value={form.definition.description ?? ''}
          disabled={disabled}
          placeholder="What makes a piece of work an example of this?"
          onChange={(event) => {
            set((value) => ({ ...value, description: event.target.value }));
          }}
        />
      </Field>
      <TemplateDisclosure title="Icon and draft visibility">
        <WorkTemplateGlyphField orgId={orgId} form={form} isBase={isBase} />
        {!existing ? <DraftPrivacyFields form={form} teams={options.teamOptions} /> : null}
      </TemplateDisclosure>
    </div>
  );
}

function TemplateKindField({ form, existing }: { form: Form; existing: boolean }): JSX.Element {
  const disabled = form.pending || !form.canEdit;
  const set = form.setDefinition;
  return (
    <Field
      label="Kind of work"
      description={
        form.definition.blueprint.steps.length
          ? 'Remove child work before changing the root kind.'
          : undefined
      }
    >
      <Select
        value={form.kind}
        disabled={existing || disabled || form.definition.blueprint.steps.length > 0}
        onChange={(event) => {
          const kind = TemplateTargetType.parse(event.target.value);
          form.setKind(kind);
          set((value) => ({
            ...value,
            defaultStatusKey: null,
            payload: { targetType: kind, description: value.payload.description ?? '' },
          }));
        }}
      >
        <KindOption kind="initiative" />
        <KindOption kind="program" />
        <KindOption kind="project" />
        <KindOption kind="task" />
      </Select>
    </Field>
  );
}
