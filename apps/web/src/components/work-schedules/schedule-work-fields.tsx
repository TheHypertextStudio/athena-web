'use client';
import type { JSX } from 'react';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { WorkScheduleUsedTemplate } from '@docket/work/work-schedule-management';
import { Button, Field, Input, Select } from '@docket/ui/primitives';
import { EnumPicker } from '@docket/ui/components';
import { WorkTemplatePicker } from '@/components/composer/work-template-picker';
import { WorkspaceActorPicker } from '@/components/people/workspace-actor-picker';
import type { ComposerOptions } from '@/components/pickers/use-composer-options';
import { TemplateDisclosure } from '@/components/templates/template-disclosure';
import type { ScheduleAuthoringDraft } from './schedule-draft';
import { scheduleTitleExample } from './schedule-draft';
import { useScheduleRetainedIdentity } from './schedule-retained-identity';

/** One deliberate work identity, title rule and location-specific responsibility. */
export function ScheduleWorkFields({
  orgId,
  draft,
  onChange,
  onTemplate,
  template,
  disabled,
  retainedTemplate,
}: {
  readonly orgId: string;
  readonly draft: ScheduleAuthoringDraft;
  readonly onChange: (draft: ScheduleAuthoringDraft) => void;
  readonly onTemplate: (template: WorkTemplateOut) => void;
  readonly options: ComposerOptions;
  readonly template: WorkTemplateOut | undefined;
  readonly disabled: boolean;
  readonly retainedTemplate?: WorkScheduleUsedTemplate | null | undefined;
  readonly exampleTitle?: string | undefined;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ScheduleIdentity
        {...{ orgId, draft, onChange, onTemplate, template, disabled, retainedTemplate }}
      />
      <Field label="Schedule name" description="A name for this routine, such as Community dinner.">
        <Input
          aria-label="Schedule name"
          value={draft.name}
          maxLength={120}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...draft, name: event.target.value });
          }}
          placeholder="Community dinner"
        />
      </Field>
    </div>
  );
}

function ScheduleTitleField({
  draft,
  onChange,
  disabled,
  exampleTitle,
}: {
  readonly draft: ScheduleAuthoringDraft;
  readonly onChange: (value: ScheduleAuthoringDraft) => void;
  readonly disabled: boolean;
  readonly exampleTitle?: string | undefined;
}): JSX.Element | null {
  if (!draft.document) return null;
  const document = draft.document;
  const example = exampleTitle ?? scheduleTitleExample(draft);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field
        label="Title of each new item"
        description="Use {month}, {day}, {year}, {month_number} or {quarter} to include the run date."
      >
        <Input
          aria-label="Title of each new item"
          value={document.titlePattern}
          maxLength={256}
          disabled={disabled}
          aria-invalid={!example}
          onChange={(event) => {
            onChange({ ...draft, document: { ...document, titlePattern: event.target.value } });
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-1" aria-label="Insert date in title">
        {['month', 'day', 'year', 'quarter'].map((token) => (
          <Button
            key={token}
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onChange({
                ...draft,
                document: { ...document, titlePattern: `${document.titlePattern}{${token}}` },
              });
            }}
          >{`{${token}}`}</Button>
        ))}
      </div>
      <p
        className={`text-body-medium break-words ${example ? 'text-on-surface-variant' : 'text-error'}`}
        aria-live="polite"
      >
        {example
          ? `For example: ${example}`
          : 'Use a title with supported date tokens and balanced braces.'}
      </p>
    </div>
  );
}
function ScheduleVersionField({
  draft,
  onChange,
  template,
  disabled,
}: {
  readonly draft: ScheduleAuthoringDraft;
  readonly onChange: (value: ScheduleAuthoringDraft) => void;
  readonly template: WorkTemplateOut | undefined;
  readonly disabled: boolean;
}): JSX.Element | null {
  const document = draft.document;
  if (!document) return null;
  const selection = document.template.selection;
  return (
    <Field label="Template updates">
      <Select
        aria-label="Template updates"
        value={selection.kind}
        disabled={disabled}
        onChange={(event) => {
          const next =
            event.target.value === 'pinned' && template?.latestVersion
              ? { kind: 'pinned' as const, workTypeVersionId: template.latestVersion.id }
              : { kind: 'latest' as const };
          onChange({
            ...draft,
            document: { ...document, template: { ...document.template, selection: next } },
          });
        }}
      >
        <option value="latest">Use the latest published version</option>
        <option value="pinned" disabled={!template?.latestVersion && selection.kind !== 'pinned'}>
          Keep this version
        </option>
      </Select>
      <p className="text-body-small text-on-surface-variant">
        {selection.kind === 'latest'
          ? 'New runs use the latest publication. Past runs keep the version they used.'
          : template?.latestVersion?.id === selection.workTypeVersionId
            ? `Version ${template.latestVersion.number} will be used for every run.`
            : 'The saved version will be used for every run.'}
      </p>
    </Field>
  );
}
function ScheduleRootAssignments({
  orgId,
  draft,
  options,
  disabled,
  onChange,
}: {
  readonly orgId: string;
  readonly draft: ScheduleAuthoringDraft;
  readonly options: ComposerOptions;
  readonly disabled: boolean;
  readonly onChange: (value: ScheduleAuthoringDraft) => void;
}): JSX.Element | null {
  const document = draft.document;
  if (!document) return null;
  const root = document.root;
  const update = (next: typeof root): void => {
    onChange({ ...draft, document: { ...document, root: next } });
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Field label="Team">
        <EnumPicker
          options={options.teamOptions}
          value={root.teamId ?? null}
          onChange={(id) => {
            update({ ...root, teamId: id ? TeamId.parse(id) : null });
          }}
          ariaLabel="Schedule team"
          placeholder="No team override"
          clearLabel="Use template team"
          disabled={disabled || options.loading}
        />
      </Field>
      <Field label={root.kind === 'project' ? 'Lead' : 'Assignee'}>
        <WorkspaceActorPicker
          orgId={orgId}
          options={root.kind === 'project' ? options.memberOptions : options.actorOptions}
          value={root.responsibleActorId ?? null}
          onChange={(id) => {
            update({ ...root, responsibleActorId: id ? ActorId.parse(id) : null });
          }}
          ariaLabel="Schedule responsibility"
          placeholder="No responsibility override"
          clearLabel="Unassigned"
          disabled={disabled || options.loading}
        />
      </Field>
      <Field label="Summary">
        <Input
          aria-label="Scheduled work summary"
          value={root.fields.summary ?? ''}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => {
            update({ ...root, fields: { ...root.fields, summary: event.target.value || null } });
          }}
        />
      </Field>
      <p className="text-body-small text-on-surface-variant">
        These choices belong to this schedule. The reusable template stays unchanged.
      </p>
    </div>
  );
}

function ScheduleIdentity({
  orgId,
  draft,
  onChange,
  onTemplate,
  template,
  disabled,
  retainedTemplate,
}: Omit<Parameters<typeof ScheduleWorkFields>[0], 'options'>): JSX.Element {
  const document = draft.document;
  const retained = useScheduleRetainedIdentity(orgId, retainedTemplate);
  return (
    <section aria-label="Selected work template" className="flex min-w-0 flex-col gap-3">
      <h2 tabIndex={-1} className="text-title-large outline-none">
        {document
          ? retainedTemplate
            ? (retained.data?.name ?? 'Saved archived version')
            : (template?.definition.name ?? 'Loading template…')
          : 'Choose the work'}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-32 shrink-0">
          <Select
            aria-label="Scheduled work kind"
            value={draft.kind}
            disabled={disabled}
            className="w-auto"
            onChange={(event) => {
              onChange({
                ...draft,
                kind: event.target.value as 'task' | 'project',
                document: null,
              });
            }}
          >
            <option value="project">Project</option>
            <option value="task">Task</option>
          </Select>
        </div>
        <WorkTemplatePicker
          orgId={orgId}
          kind={draft.kind}
          teamId={document?.root.teamId ?? null}
          selectedId={document?.template.workTypeId}
          selectedLabel={
            retainedPickerLabel(Boolean(retainedTemplate), retained.data) ??
            schedulePickerLabel(draft, template)
          }
          selectedVersionId={pinnedScheduleVersion(draft)}
          onSelect={onTemplate}
          disabled={disabled}
        />
      </div>
      <ScheduleIdentityDetails
        draft={draft}
        template={template}
        retainedTemplate={retainedTemplate}
        onChange={onChange}
        disabled={disabled}
      />
    </section>
  );
}

function schedulePickerLabel(
  draft: ScheduleAuthoringDraft,
  template: WorkTemplateOut | undefined,
): string {
  if (!draft.document) return 'Choose template';
  return `${template?.definition.name ?? 'Saved template'}${template?.status === 'archived' ? ' · Archived' : ''}`;
}
function pinnedScheduleVersion(draft: ScheduleAuthoringDraft): string | undefined {
  const selection = draft.document?.template.selection;
  return selection?.kind === 'pinned' ? selection.workTypeVersionId : undefined;
}

function retainedPickerLabel(
  retained: boolean,
  identity: { name: string; versionNumber: number } | undefined,
): string | undefined {
  if (!retained) return undefined;
  return identity
    ? `${identity.name} · Version ${identity.versionNumber} · Archived`
    : 'Saved archived version';
}
function ScheduleIdentityDetails({
  draft,
  template,
  retainedTemplate,
  onChange,
  disabled,
}: Pick<
  Parameters<typeof ScheduleWorkFields>[0],
  'draft' | 'template' | 'retainedTemplate' | 'onChange' | 'disabled'
>): JSX.Element {
  if (!draft.document)
    return (
      <p className="text-body-medium text-on-surface-variant">
        Select a published template to start. Its included work and timing come with it.
      </p>
    );
  return (
    <>
      <p className="text-body-medium text-on-surface-variant">
        {template?.definition.description ??
          'Each run creates an independent copy with its included work.'}
      </p>
      {retainedTemplate ? (
        <p className="text-body-medium text-on-surface-variant">
          This archived template continues with the exact saved version. Choose a published template
          to change its structure.
        </p>
      ) : (
        <TemplateDisclosure title="Template version">
          <ScheduleVersionField
            draft={draft}
            template={template}
            onChange={onChange}
            disabled={disabled}
          />
        </TemplateDisclosure>
      )}
    </>
  );
}

/** Contextual title and private starting details follow the included-work decisions. */
export function ScheduleWorkStartingFields({
  orgId,
  draft,
  onChange,
  disabled,
  options,
  exampleTitle,
}: Pick<
  Parameters<typeof ScheduleWorkFields>[0],
  'orgId' | 'draft' | 'onChange' | 'disabled' | 'options' | 'exampleTitle'
>): JSX.Element | null {
  const document = draft.document;
  if (!document) return null;
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Scheduled work starting details">
      <h3 className="text-title-large">Title and starting details</h3>
      <>
        <ScheduleTitleField
          draft={draft}
          disabled={disabled}
          onChange={onChange}
          exampleTitle={exampleTitle}
        />
        <TemplateDisclosure title="Responsibility and starting details">
          <ScheduleRootAssignments
            orgId={orgId}
            draft={draft}
            options={options}
            disabled={disabled}
            onChange={onChange}
          />
        </TemplateDisclosure>
      </>
    </section>
  );
}
