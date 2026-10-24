'use client';
import type { JSX } from 'react';
import { Field, Input, Select, Textarea, Surface, Text, fieldSurface } from '@docket/ui/primitives';
import { EntityMultiPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { TemplateTargetType } from '@docket/work/template-contract';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { TemplateStartingStructure } from './template-starting-structure';
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
  onEditStructure,
  active = true,
}: {
  orgId: string;
  form: Form;
  isBase: boolean;
  onEditStructure?: (() => void) | undefined;
  active?: boolean;
}): JSX.Element {
  const disabled = form.pending || !form.canEdit;
  const options = useComposerOptions(orgId, ['teams'], true);
  const statusRegistry = useStatusRegistry();
  const statuses = statusRegistry.statusesFor(form.kind);
  const set = form.setDefinition;
  return (
    <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_272px] lg:gap-10">
      <div className="flex min-w-0 flex-col gap-8">
        <TemplateSampleWork orgId={orgId} form={form} />
        {active ? (
          <TemplateStartingStructure orgId={orgId} form={form} onEdit={onEditStructure} />
        ) : null}
      </div>
      <Surface
        as="aside"
        tone="card"
        shape="medium"
        pad="comfortable"
        aria-label="Work defaults"
        className="flex flex-col gap-4"
      >
        <h2 className="text-title-medium">Defaults</h2>
        <WorkTemplateSampleSummary form={form} />
        <WorkTemplateSampleProperties orgId={orgId} form={form} expanded />
        <Field
          label="Starting status"
          description={
            form.definition.defaultStatusKey ? (
              <Text token="body-medium">
                If this status is removed, new work uses its normal starting status.
              </Text>
            ) : undefined
          }
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
      </Surface>
    </div>
  );
}

function TemplateSampleWork({ orgId, form }: { orgId: string; form: Form }): JSX.Element {
  const set = form.setDefinition;
  return (
    <section
      aria-label="Sample work"
      id="template-outline"
      tabIndex={-1}
      className="flex min-w-0 scroll-mt-48 flex-col gap-4 sm:gap-5"
    >
      <WorkTemplateSampleFields orgId={orgId} form={form} />
      <Field label="Document">
        <FreeformTextEditor
          value={form.definition.payload.description ?? ''}
          onChange={(description) => {
            set((value) =>
              (value.payload.description ?? '') === description
                ? value
                : { ...value, payload: { ...value.payload, description } },
            );
          }}
          disabled={form.pending}
          readOnly={!form.canEdit}
          placeholder="Add notes, instructions, or a checklist…"
          ariaLabel="Document"
          mentionOrgId={orgId}
          className={`${fieldSurface({ variant: 'filled', controlSize: 'md', multiline: true, ringOn: 'within' })} [&_.ProseMirror]:text-body-large min-h-48 max-w-none lg:min-h-64`}
        />
      </Field>
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
        <Text token="body-medium">
          {canManage
            ? 'Leave empty to offer throughout the workspace. Published templates are visible to everyone.'
            : 'Administrators choose team offerings. Published templates remain visible throughout the workspace.'}
        </Text>
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
      <Field label="Template name">
        <Input
          data-template-section-focus=""
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
          placeholder="Describe when this template is useful (optional)"
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
        <Text token="body-medium">
          {form.definition.blueprint.steps.length || form.definition.defaultSchedules.length
            ? 'Remove included and repeating work before changing the kind.'
            : {
                initiative: 'Connects related programs around an outcome.',
                program: 'Organizes an ongoing area of work, including repeating work.',
                project: 'Groups work with a shared goal and an end date.',
                task: 'Defines a single action and any subtasks.',
              }[form.kind]}
        </Text>
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
