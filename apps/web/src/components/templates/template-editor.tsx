'use client';

/**
 * Author reusable work through Basics, Work, and Review without changing ordinary composers.
 * Metadata stays separate from the work defaults stored by the existing template API.
 */
import type { Health, Visibility } from '@docket/work/capability-contract';
import type {
  InitiativePriority,
  InitiativeStatus,
  InitiativeUpdateCadence,
} from '@docket/work/initiative-contract';
import type { ProgramStatus } from '@docket/work/program-contract';
import type { ProjectStatus } from '../../lib/contracts/project';
import type {
  TemplateDraft,
  TemplateOut,
  TemplateTargetType,
} from '@docket/work/template-contract';
import type { Priority } from '@docket/work/task-contract';
import { LabelsPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { type JSX, type ReactNode, useCallback, useId, useState } from 'react';

import { TemplateWorkflowShell } from './template-workflow-shell';
import { TemplateBasicsFields } from './template-basics-fields';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { useComposerDraft } from '@/components/composer/use-composer-draft';
import { useDefaultedStatus } from '@/components/entity-display/use-work-status';
import { InitiativeComposerPickers } from '@/components/initiatives/initiative-form-pickers';
import { ProgramComposerPickers } from '@/components/programs/program-form-pickers';
import { ProjectComposerPickers } from '@/components/projects/project-form-pickers';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { TaskTemplatePickers } from '@/components/tasks/task-template-pickers';
import { userErrorMessage } from '@/lib/problem';

import { useCreateTemplate, useUpdateTemplate } from './queries';

/** Fields a task template holds. */
interface TaskTemplateFields {
  title: string;
  description: string;
  priority: Priority;
  labelIds: NonNullable<Extract<TemplateDraft, { targetType: 'task' }>['labelIds']>;
}

/** Fields a project template holds. */
interface ProjectTemplateFields {
  name: string;
  summary: string;
  description: string;
  status: ProjectStatus;
  health: Health | null;
}

/** Fields an initiative template holds. */
interface InitiativeTemplateFields {
  name: string;
  summary: string;
  description: string;
  status: InitiativeStatus;
  priority: InitiativePriority;
  updateCadence: InitiativeUpdateCadence;
  health: Health | null;
}

/** Fields a program template holds. */
interface ProgramTemplateFields {
  name: string;
  summary: string;
  description: string;
  status: ProgramStatus;
  health: Health | null;
  visibility: Visibility;
}

/**
 * Drop the empty strings and nulls a form produces but a payload should not carry.
 *
 * @remarks
 * A form field is always present — an untouched text input holds `''`, an untouched health picker
 * holds `null`. A template payload's fields are all optional, and "absent" means "this template
 * does not assert anything here", which is what lets an apply be a merge rather than a
 * replacement. Writing `''` instead would make every template silently clear the fields it does
 * not care about.
 *
 * The return type drops `null` from every field, which is the whole reason a form can hold
 * `health: null` while a payload's `health` is `Health | undefined`.
 *
 * @param fields - The form's current values.
 * @returns the same object with empty and null values removed.
 */
function present<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], null> } {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) => value !== null && value !== '' && (!Array.isArray(value) || value.length > 0),
    ),
  ) as { [K in keyof T]?: Exclude<T[K], null> };
}

/** Props for {@link TemplateEditorDialog}. */
export interface TemplateEditorDialogProps {
  /** The org the template belongs to (from the route). */
  orgId: string;
  /** The kind the template creates. Fixed for the life of a template. */
  targetType: TemplateTargetType;
  /** The template being edited, or null to author a new one. */
  template: TemplateOut | null;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed. */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that a template was saved, so it can close and refresh. */
  onSaved: () => void;
}

/**
 * The template editor dialog.
 *
 * @param props - The {@link TemplateEditorDialogProps}.
 * @returns the rendered editor.
 */
export const TemplateEditorDialog = withComposerReset(function TemplateEditor({
  orgId,
  targetType,
  template,
  open,
  onOpenChange,
  onSaved,
}: TemplateEditorDialogProps): JSX.Element {
  const noun = useVocabulary(targetType);
  const nameFieldId = useId();
  const descriptionFieldId = useId();

  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [scope, setScope] = useState<TemplateOut['scope']>(template?.scope ?? 'organization');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateTemplate(orgId);
  const update = useUpdateTemplate(orgId);

  const persist = useCallback(
    async (payload: TemplateDraft): Promise<void> => {
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      setSaving(true);
      setError(null);
      try {
        const shared = {
          name: trimmed,
          description: description.trim(),
          scope,
          payload,
          ...(scope === 'team' && template?.teamId ? { teamId: template.teamId } : {}),
        };
        if (template) {
          await update.mutateAsync({ id: template.id, ...shared });
        } else {
          await create.mutateAsync({ targetType, ...shared });
        }
        onOpenChange(false);
        onSaved();
      } catch (caught) {
        setError(userErrorMessage(caught, 'Could not save the template.'));
      } finally {
        setSaving(false);
      }
    },
    [name, description, scope, template, targetType, create, update, onOpenChange, onSaved],
  );

  // The per-kind bodies hand this to a click handler, which must not be given a promise to drop
  // on the floor — the failure is already reported through `error`, so nothing downstream awaits.
  const save = useCallback(
    (payload: TemplateDraft): void => {
      void persist(payload);
    },
    [persist],
  );

  const leadingFields = (
    <TemplateBasicsFields
      name={name}
      description={description}
      scope={scope}
      saving={saving}
      nameFieldId={nameFieldId}
      descriptionFieldId={descriptionFieldId}
      onNameChange={setName}
      onDescriptionChange={setDescription}
      onScopeChange={setScope}
      teamScoped={template?.scope === 'team'}
    />
  );

  const shared = {
    open,
    onOpenChange,
    mentionOrgId: orgId,
    heading: template ? template.name : `New ${noun.toLowerCase()} template`,
    workNoun: noun,
    leadingFields,
    templateName: name,
    templateDescription: description,
    templateScope: scope,
    targetType,
    editing: template !== null,
    metadataDirty: metadataChanged(template, name, description, scope),
    originalPayload: template?.payload,
    templateTeamId: template?.teamId ?? null,
    error,
    creating: saving,
    canSubmit: name.trim().length > 0,
    submitLabel: template ? 'Save changes' : 'Create template',
  };

  const Body = TEMPLATE_BODIES[targetType];
  return <Body shared={shared} template={template} noun={noun} onSave={save} />;
});

/** The shell props every per-kind body forwards unchanged. */
interface SharedBodyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mentionOrgId: string;
  heading: string;
  workNoun: string;
  leadingFields: ReactNode;
  error: string | null;
  creating: boolean;
  canSubmit: boolean;
  submitLabel: string;
  templateName: string;
  templateDescription: string;
  templateScope: TemplateOut['scope'];
  targetType: TemplateTargetType;
  editing: boolean;
  metadataDirty: boolean;
  originalPayload: TemplateDraft | undefined;
  templateTeamId: string | null;
}

/** Props every per-kind editor body takes. */
interface KindBodyProps {
  shared: SharedBodyProps;
  template: TemplateOut | null;
  noun: string;
  onSave: (payload: TemplateDraft) => void;
}

function TaskTemplateBody({ shared, template, noun, onSave }: KindBodyProps): JSX.Element {
  const stored = template?.payload.targetType === 'task' ? template.payload : null;
  const { draft, setField } = useComposerDraft<TaskTemplateFields>({
    title: stored?.title ?? '',
    description: stored?.description ?? '',
    priority: stored?.priority ?? 'none',
    labelIds: stored?.labelIds ?? [],
  });
  const options = useComposerOptions(shared.mentionOrgId, ['labels'], shared.open);

  return (
    <TemplateWorkflowShell
      {...shared}
      payload={{ targetType: 'task', ...present(draft) }}
      title={draft.title}
      onTitleChange={(next) => {
        setField('title', next);
      }}
      titlePlaceholder={`${noun} title (optional)`}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Description…"
      onSubmit={() => {
        onSave({ targetType: 'task', ...present(draft) });
      }}
    >
      <TaskTemplatePickers
        priority={draft.priority}
        onPriorityChange={(next) => {
          setField('priority', next);
        }}
        disabled={shared.creating}
      />
      <EntityMetadataItem priority={1}>
        <LabelsPicker
          options={options.labelOptions}
          value={draft.labelIds}
          disabled={shared.creating}
          placeholder="No labels"
          ariaLabel="Labels"
          onToggle={(id) => {
            const chosen = options.labels.find((label) => label.id === id);
            if (!chosen) return;
            setField(
              'labelIds',
              draft.labelIds.includes(chosen.id)
                ? draft.labelIds.filter((value) => value !== chosen.id)
                : [...draft.labelIds, chosen.id],
            );
          }}
        />
      </EntityMetadataItem>
    </TemplateWorkflowShell>
  );
}

function ProjectTemplateBody({ shared, template, noun, onSave }: KindBodyProps): JSX.Element {
  const stored = template?.payload.targetType === 'project' ? template.payload : null;
  const { draft, setField } = useComposerDraft<ProjectTemplateFields>({
    name: stored?.name ?? '',
    summary: stored?.summary ?? '',
    description: stored?.description ?? '',
    status: stored?.status ?? '',
    health: stored?.health ?? null,
  });

  // A template stored under a status the workspace has since renamed or removed still opens; the
  // editor moves it to wherever a Project starts now rather than showing an empty status chip.
  useDefaultedStatus('project', draft.status, (key) => {
    setField('status', key);
  });

  return (
    <TemplateWorkflowShell
      {...shared}
      payload={{ targetType: 'project', ...present(draft) }}
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${noun} name (optional)`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="Short description (optional)"
      summaryMaxLength={280}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Description…"
      onSubmit={() => {
        onSave({ targetType: 'project', ...present(draft) });
      }}
    >
      <ProjectComposerPickers
        status={draft.status}
        onStatusChange={(next) => {
          setField('status', next);
        }}
        health={draft.health}
        onHealthChange={(next) => {
          setField('health', next);
        }}
        disabled={shared.creating}
      />
    </TemplateWorkflowShell>
  );
}

function InitiativeTemplateBody({ shared, template, noun, onSave }: KindBodyProps): JSX.Element {
  const stored = template?.payload.targetType === 'initiative' ? template.payload : null;
  const { draft, setField } = useComposerDraft<InitiativeTemplateFields>({
    name: stored?.name ?? '',
    summary: stored?.summary ?? '',
    description: stored?.description ?? '',
    status: stored?.status ?? '',
    priority: stored?.priority ?? 'none',
    updateCadence: stored?.updateCadence ?? 'monthly',
    health: stored?.health ?? null,
  });

  useDefaultedStatus('initiative', draft.status, (key) => {
    setField('status', key);
  });

  return (
    <TemplateWorkflowShell
      {...shared}
      payload={{ targetType: 'initiative', ...present(draft) }}
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${noun} name (optional)`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="Short description (optional)"
      summaryMaxLength={280}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Description…"
      onSubmit={() => {
        onSave({ targetType: 'initiative', ...present(draft) });
      }}
    >
      <InitiativeComposerPickers
        actorOptions={[]}
        status={draft.status}
        onStatusChange={(next) => {
          setField('status', next);
        }}
        health={draft.health}
        onHealthChange={(next) => {
          setField('health', next);
        }}
        priority={draft.priority}
        onPriorityChange={(next) => {
          setField('priority', next);
        }}
        updateCadence={draft.updateCadence}
        onUpdateCadenceChange={(next) => {
          setField('updateCadence', next);
        }}
        disabled={shared.creating}
      />
    </TemplateWorkflowShell>
  );
}

function ProgramTemplateBody({ shared, template, noun, onSave }: KindBodyProps): JSX.Element {
  const stored = template?.payload.targetType === 'program' ? template.payload : null;
  const { draft, setField } = useComposerDraft<ProgramTemplateFields>({
    name: stored?.name ?? '',
    summary: stored?.summary ?? '',
    description: stored?.description ?? '',
    status: stored?.status ?? '',
    health: stored?.health ?? null,
    visibility: stored?.visibility ?? 'public',
  });

  useDefaultedStatus('program', draft.status, (key) => {
    setField('status', key);
  });

  return (
    <TemplateWorkflowShell
      {...shared}
      payload={{ targetType: 'program', ...present(draft) }}
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${noun} name (optional)`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="Short description (optional)"
      summaryMaxLength={280}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Description…"
      onSubmit={() => {
        onSave({ targetType: 'program', ...present(draft) });
      }}
    >
      <ProgramComposerPickers
        actorOptions={[]}
        status={draft.status}
        onStatusChange={(next) => {
          setField('status', next);
        }}
        health={draft.health}
        onHealthChange={(next) => {
          setField('health', next);
        }}
        visibility={draft.visibility}
        onVisibilityChange={(next) => {
          setField('visibility', next);
        }}
        disabled={shared.creating}
      />
    </TemplateWorkflowShell>
  );
}

function metadataChanged(
  template: TemplateOut | null,
  name: string,
  description: string,
  scope: TemplateOut['scope'],
): boolean {
  return (
    name !== (template?.name ?? '') ||
    description !== (template?.description ?? '') ||
    scope !== (template?.scope ?? 'organization')
  );
}

const TEMPLATE_BODIES = {
  task: TaskTemplateBody,
  project: ProjectTemplateBody,
  initiative: InitiativeTemplateBody,
  program: ProgramTemplateBody,
};
