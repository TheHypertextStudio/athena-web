'use client';
import type { JSX } from 'react';
import { Field, Input, Select, Surface, Textarea, fieldSurface } from '@docket/ui/primitives';
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
  WorkTemplateSampleSummary,
} from './work-template-sample-fields';
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
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      <Surface tone="card" shape="medium" pad="comfortable" className="sm:p-4">
        <TemplateSampleWork orgId={orgId} form={form} />
      </Surface>
      <div className="min-w-0 px-3 sm:px-0">
        <TemplateDisclosure title="Defaults and availability">
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
    <section
      aria-label="Sample work"
      id="template-outline"
      tabIndex={-1}
      className="flex min-w-0 scroll-mt-48 flex-col gap-4 sm:gap-5"
    >
      <div>
        <h2 tabIndex={-1} className="text-title-large">
          Starting work
        </h2>
        <p className="text-body-medium text-on-surface-variant">
          Set the starting contents of one new item. Add the work that comes with it in the next
          step.
        </p>
      </div>
      <WorkTemplateSampleFields orgId={orgId} form={form} />
      <Surface tone="well" shape="medium" pad="none" className="contents sm:block sm:p-4">
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
      <WorkTemplateSampleSummary form={form} />
      <WorkTemplateSampleProperties orgId={orgId} form={form} />
    </section>
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
    <div className="flex max-w-2xl min-w-0 flex-col gap-4 sm:gap-5">
      <div>
        <h2 tabIndex={-1} className="text-title-large">
          Name a kind of work
        </h2>
        <p className="text-body-medium text-on-surface-variant">
          Give a kind of work a shared name, such as Event, client engagement, or volunteer
          onboarding.
        </p>
      </div>
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
        <Textarea
          aria-label="When to use it"
          rows={2}
          value={form.definition.description ?? ''}
          disabled={disabled}
          placeholder="What makes a piece of work an example of this?"
          onChange={(event) => {
            set((value) => ({ ...value, description: event.target.value }));
          }}
        />
      </Field>
      <TemplateKindField form={form} existing={existing} />
      {!existing ? (
        <TemplateDisclosure
          title={form.scope === 'team' ? 'Draft privacy · A team' : 'Draft privacy · Only you'}
        >
          <p className="text-body-medium text-on-surface-variant">
            Choose who can review the draft. Publishing it for your workspace is a separate action.
          </p>
          <DraftPrivacyFields form={form} teams={options.teamOptions} />
        </TemplateDisclosure>
      ) : null}
      <TemplateDisclosure title="Icon">
        <WorkTemplateGlyphField orgId={orgId} form={form} isBase={isBase} />
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
        form.definition.blueprint.steps.length || form.definition.defaultSchedules.length
          ? 'Remove included and repeating work before changing the kind.'
          : {
              initiative: 'Connects related programs around an outcome.',
              program: 'Organizes an ongoing area of work, including repeating work.',
              project: 'Organizes work toward a result with a finish.',
              task: 'Defines a single action and any subtasks.',
            }[form.kind]
      }
    >
      <Select
        value={form.kind}
        disabled={
          existing ||
          disabled ||
          form.definition.blueprint.steps.length > 0 ||
          form.definition.defaultSchedules.length > 0
        }
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
