'use client';
import type { JSX } from 'react';
import { Button } from '@docket/ui/primitives';
import {
  WorkTemplateCreate,
  WorkTemplateDefinition,
  type WorkTemplateOut,
} from '@docket/work/work-template-contract';
import type { WorkTemplateFormState } from './use-work-template-form';
import type { TemplateDefinitionSection } from './use-template-section-navigation';
import { TEMPLATE_SECTIONS } from './template-definition-navigation';

/** Validate authored values with the same semantic contracts used by persistence. */
export function templateSectionError(
  form: WorkTemplateFormState,
  section?: TemplateDefinitionSection,
): string | null {
  const parsed = WorkTemplateDefinition.safeParse(form.definition);
  const issue = parsed.success
    ? undefined
    : parsed.error.issues.find((item) => {
        if (!section) return true;
        const field = item.path[0];
        if (section === 'purpose') return field === 'name';
        if (section === 'work') return field === 'payload' || field === 'defaultStatusKey';
        return field === 'blueprint' || field === 'defaultSchedules';
      });
  if (issue) {
    if (issue.path[0] === 'name') return 'Enter a template name before continuing.';
    return section === 'structure'
      ? 'Check the included work before continuing.'
      : 'Check the starting work before continuing.';
  }
  if (section === 'purpose' && form.scope === 'team' && !form.teamId)
    return 'Choose the team that can read this draft before continuing.';
  if (section) return null;
  return WorkTemplateCreate.safeParse({
    targetType: form.kind,
    scope: form.scope,
    definition: form.definition,
    offeredTeamIds: form.offeredTeamIds,
    ...(form.scope === 'team' ? { teamId: form.teamId } : {}),
  }).success
    ? null
    : 'Check the template’s availability and starting work before saving.';
}

/** Header saving stays secondary during creation and primary during ordinary editing. */
export function TemplateDefinitionAction({
  form,
  initial,
  section,
  mode = 'edit',
}: {
  form: WorkTemplateFormState;
  initial: WorkTemplateOut | null;
  section: TemplateDefinitionSection;
  mode?: 'create' | 'edit';
}): JSX.Element {
  const visible = form.canEdit && form.dirty && (mode === 'edit' || section !== 'review');
  const invalid = templateSectionError(form) !== null;
  const label = mode === 'create' ? 'Save draft' : 'Save changes';
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {visible && (mode === 'edit' || !invalid) ? (
        <Button
          type="button"
          variant={mode === 'create' ? 'secondary' : 'default'}
          disabled={form.pending || invalid}
          onClick={() => {
            void form.save();
          }}
        >
          {form.pending ? 'Saving…' : label}
        </Button>
      ) : null}
      <TemplateSaveStatus form={form} saved={initial !== null} />
    </div>
  );
}

function TemplateSaveStatus({
  form,
  saved,
}: {
  form: WorkTemplateFormState;
  saved: boolean;
}): JSX.Element {
  const visibility = form.dirty || form.pending ? '' : 'sr-only';
  return (
    <span role="status" className={`text-body-small text-on-surface-variant ${visibility}`}>
      {saveStatus(form, saved)}
    </span>
  );
}

/** Keep creation actions outside the scroll owner without coupling them to mutation state. */
export function TemplateCreationFooter({
  form,
  initial,
  section,
  onNext,
  onBack,
  onFinish,
  publicationBlocked,
}: {
  form: WorkTemplateFormState;
  initial: WorkTemplateOut | null;
  section: TemplateDefinitionSection;
  onNext: () => void;
  onBack: () => void;
  onFinish: () => void;
  publicationBlocked: boolean;
}): JSX.Element {
  const index = TEMPLATE_SECTIONS.findIndex((item) => item.value === section);
  return (
    <div className="mx-auto flex w-full max-w-[1120px] min-w-0 flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="ghost" disabled={form.pending} onClick={onBack}>
        Back
      </Button>
      {section !== 'review' ? (
        <Button
          type="button"
          aria-label={`Continue to ${TEMPLATE_SECTIONS[index + 1]?.label.toLowerCase()}`}
          disabled={form.pending}
          onClick={onNext}
        >
          Continue
        </Button>
      ) : (
        <div className="flex min-w-0 flex-wrap justify-end gap-2">
          {!form.dirty && initial ? (
            <Button type="button" variant="ghost" disabled={form.pending} onClick={onFinish}>
              Finish with private draft
            </Button>
          ) : null}
          <TemplateReviewAction
            form={form}
            initial={initial}
            mode="create"
            publicationBlocked={publicationBlocked}
          />
        </div>
      )}
    </div>
  );
}

/** Save and publish are distinct deliberate operations; unsaved edits always take precedence. */
export function TemplateReviewAction({
  form,
  initial,
  mode,
  publicationBlocked,
}: {
  form: WorkTemplateFormState;
  initial: WorkTemplateOut | null;
  mode: 'create' | 'edit';
  publicationBlocked: boolean;
}): JSX.Element | null {
  if (!form.canEdit || initial?.status === 'archived') return null;
  const save = form.dirty || !initial;
  if (save && mode === 'edit') return null;
  const label = reviewActionLabel(save, initial);
  return (
    <Button
      type="button"
      className="self-start"
      disabled={
        form.pending || templateSectionError(form) !== null || (!save && publicationBlocked)
      }
      onClick={() => {
        void (save ? form.save() : form.publish());
      }}
    >
      {form.pending ? (save ? 'Saving…' : 'Publishing…') : label}
    </Button>
  );
}

/** Place the sharing consequence next to the deliberate publication action. */
export function TemplatePublicationConsequence({
  form,
  initial,
  section,
}: {
  form: WorkTemplateFormState;
  initial: WorkTemplateOut | null;
  section: TemplateDefinitionSection;
}): JSX.Element | null {
  if (section !== 'review' || !form.canEdit || initial?.status === 'archived') return null;
  return (
    <p className="text-body-medium text-on-surface-variant">
      {form.dirty || !initial ? 'Save a private draft first. ' : ''}Publishing shares this template
      with everyone in the workspace. Existing work keeps its saved version and content.
    </p>
  );
}

function saveStatus(form: WorkTemplateFormState, existing: boolean): string {
  if (form.pending) return 'Saving…';
  if (form.dirty) return 'Unsaved changes';
  if (form.saved) return 'Saved';
  return existing ? 'Saved draft' : 'Not yet saved';
}

function reviewActionLabel(save: boolean, initial: WorkTemplateOut | null): string {
  if (save) return 'Save draft';
  return initial?.status === 'published' ? 'Publish next version' : 'Publish to workspace';
}
