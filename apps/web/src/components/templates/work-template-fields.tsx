'use client';
import type { JSX } from 'react';
import { Field, Input, Select, fieldSurface } from '@docket/ui/primitives';
import { EntityMultiPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { TemplateTargetType } from '@docket/work/template-contract';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { WorkTemplateGlyphField } from './work-template-glyph-field';
import { WorkTemplateSampleFields } from './work-template-sample-fields';
import type { useWorkTemplateForm } from './use-work-template-form';

type Form = ReturnType<typeof useWorkTemplateForm>;

/** Edit the reusable document and status default without creating a second status system. */
export function WorkTemplateFields({
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
  const disabled = form.pending || !form.canEdit;
  const options = useComposerOptions(orgId, ['teams'], true);
  const statusRegistry = useStatusRegistry();
  const statuses = statusRegistry.statusesFor(form.kind);
  const set = form.setDefinition;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <WorkTemplateBasics form={form} existing={existing} isBase={isBase} />
      <WorkTemplateGlyphField orgId={orgId} form={form} isBase={isBase} />
      {!existing ? <DraftPrivacyFields form={form} teams={options.teamOptions} /> : null}
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
      <WorkTemplateSampleFields orgId={orgId} form={form} />
      <Field label="Starting document">
        <FreeformTextEditor
          value={form.definition.payload.description ?? ''}
          onChange={(description) => {
            set((value) => ({ ...value, payload: { ...value.payload, description } }));
          }}
          disabled={disabled}
          readOnly={!form.canEdit}
          placeholder="Write the structure people should start with…"
          ariaLabel="Starting document"
          mentionOrgId={orgId}
          className={`${fieldSurface({ controlSize: 'md', multiline: true, ringOn: 'within' })} min-h-48 max-w-none`}
        />
      </Field>
    </div>
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

function WorkTemplateBasics({
  form,
  existing,
  isBase,
}: {
  form: Form;
  existing: boolean;
  isBase: boolean;
}): JSX.Element {
  const disabled = form.pending || !form.canEdit;
  const set = form.setDefinition;
  return (
    <>
      <Field label="Kind of work">
        <Select
          value={form.kind}
          disabled={existing || disabled}
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
      <Field label="Template name">
        <Input
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
          onChange={(event) => {
            set((value) => ({ ...value, description: event.target.value }));
          }}
        />
      </Field>
    </>
  );
}
