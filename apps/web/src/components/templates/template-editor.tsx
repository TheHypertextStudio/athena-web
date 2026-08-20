'use client';

/**
 * The template editor: the create composer, pointed at a template instead of an entity.
 *
 * @remarks
 * Authoring a template looks exactly like creating the thing it makes, because it *is* the same
 * shell and the same picker components. Only three things differ, and they all live above the
 * entity fields: the template's own name, its one-line description, and who it is shared with.
 *
 * That equivalence is the whole answer to "it is unclear how to create or edit templates". There
 * is nothing new to learn — fill in the dialog you already fill in, and the result is reusable.
 *
 * A template stores no reference to an actor, team, project, milestone, cycle or date. The picker
 * components take those axes as optional props for exactly this reason: the editor mounts them
 * without, so no control appears whose value would be silently dropped on save.
 */
import type {
  Health,
  InitiativePriority,
  InitiativeStatus,
  InitiativeUpdateCadence,
  ProgramStatus,
  ProjectStatus,
  TemplateDraft,
  TemplateOut,
  TemplateTargetType,
  Visibility,
} from '@docket/types';
import type { Priority } from '@docket/work/task-contract';
import { EnumPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Input } from '@docket/ui/primitives';
import { type JSX, type ReactNode, useCallback, useId, useState } from 'react';

import { ComposerShell } from '@/components/composer/composer-shell';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { useComposerDraft } from '@/components/composer/use-composer-draft';
import { useDefaultedStatus } from '@/components/entity-display/use-work-status';
import { InitiativeComposerPickers } from '@/components/initiatives/initiative-form-pickers';
import { ProgramComposerPickers } from '@/components/programs/program-form-pickers';
import { ProjectComposerPickers } from '@/components/projects/project-form-pickers';
import { TaskTemplatePickers } from '@/components/tasks/task-template-pickers';
import { userErrorMessage } from '@/lib/problem';

import { useCreateTemplate, useUpdateTemplate } from './queries';

/** The sharing scopes a template may take, in widening order. */
const SCOPE_OPTIONS = [
  { value: 'personal', label: 'Only you' },
  { value: 'organization', label: 'Everyone in this workspace' },
] as const;

/** Fields a task template holds. */
interface TaskTemplateFields {
  title: string;
  description: string;
  priority: Priority;
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
    Object.entries(fields).filter(([, value]) => value !== null && value !== ''),
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
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameFieldId} className="text-on-surface text-label-large">
          Template name
        </label>
        <Input
          id={nameFieldId}
          value={name}
          disabled={saving}
          placeholder="Bug report"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={descriptionFieldId} className="text-on-surface text-label-large">
          When to use it
        </label>
        <Input
          id={descriptionFieldId}
          value={description}
          disabled={saving}
          placeholder="Shown under the name in the picker"
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>
      <EnumPicker
        options={SCOPE_OPTIONS}
        value={scope}
        onChange={(next) => {
          if (next) setScope(next);
        }}
        placeholder="Shared with"
        ariaLabel="Shared with"
        disabled={saving}
      />
    </>
  );

  const shared = {
    open,
    onOpenChange,
    mentionOrgId: orgId,
    heading: template ? `Edit ${template.name}` : `New ${noun.toLowerCase()} template`,
    leadingFields,
    error,
    creating: saving,
    canSubmit: name.trim().length > 0,
    submitLabel: template ? 'Save template' : 'Create template',
  };

  switch (targetType) {
    case 'task':
      return <TaskTemplateBody shared={shared} template={template} noun={noun} onSave={save} />;
    case 'project':
      return <ProjectTemplateBody shared={shared} template={template} noun={noun} onSave={save} />;
    case 'initiative':
      return (
        <InitiativeTemplateBody shared={shared} template={template} noun={noun} onSave={save} />
      );
    case 'program':
      return <ProgramTemplateBody shared={shared} template={template} noun={noun} onSave={save} />;
  }
});

/** The shell props every per-kind body forwards unchanged. */
interface SharedBodyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mentionOrgId: string;
  heading: string;
  leadingFields: ReactNode;
  error: string | null;
  creating: boolean;
  canSubmit: boolean;
  submitLabel: string;
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
  });

  return (
    <ComposerShell
      {...shared}
      title={draft.title}
      onTitleChange={(next) => {
        setField('title', next);
      }}
      titlePlaceholder={`${noun} title this template starts from`}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="The outline this template fills in…"
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
    </ComposerShell>
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
    <ComposerShell
      {...shared}
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${noun} name this template starts from`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="The outline this template fills in…"
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
    </ComposerShell>
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
    <ComposerShell
      {...shared}
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${noun} name this template starts from`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="The outline this template fills in…"
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
    </ComposerShell>
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
    <ComposerShell
      {...shared}
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${noun} name this template starts from`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="The outline this template fills in…"
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
    </ComposerShell>
  );
}
