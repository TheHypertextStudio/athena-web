'use client';
import type { JSX } from 'react';
import { Button } from '@docket/ui/primitives';
import { Blueprint } from '@docket/work/work-template-blueprint';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { WorkTemplateFormState } from './use-work-template-form';
import type { TemplateDefinitionSection } from './use-template-section-navigation';

/** One persistent next action moves a private draft through saving, review and explicit sharing. */
export function TemplateDefinitionAction({
  form,
  initial,
  section,
  onReview,
  publicationBlocked = false,
}: {
  form: WorkTemplateFormState;
  initial: WorkTemplateOut | null;
  section: TemplateDefinitionSection;
  onReview: () => void;
  publicationBlocked?: boolean;
}): JSX.Element {
  const save = form.dirty || !initial;
  const publish = !save && section === 'review' && initial.status !== 'archived' && form.canEdit;
  const invalid =
    !form.definition.name.trim() || !Blueprint.safeParse(form.definition.blueprint).success;
  const label = actionLabel(save, publish, initial);
  const showAction = actionAvailable(save, publish, section);
  const action = (): void => {
    if (save) void form.save();
    else if (publish) void form.publish();
    else onReview();
  };
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {showAction ? (
        <Button
          type="button"
          aria-label={label}
          disabled={actionDisabled(form, save && invalid, save, publish && publicationBlocked)}
          onClick={action}
        >
          <span className="sm:hidden">{save ? 'Save draft' : publish ? 'Publish' : 'Review'}</span>
          <span className="hidden sm:inline">{label}</span>
        </Button>
      ) : null}
      <span role="status" className="text-body-small text-on-surface-variant">
        {saveStatus(form, initial !== null)}
      </span>
    </div>
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
    <p className="text-body-small text-on-surface-variant">
      {form.dirty || !initial ? 'Save a private draft first. ' : ''}
      Publishing shares this definition with everyone in the workspace. Existing work keeps its
      saved version and content.
    </p>
  );
}

function actionLabel(save: boolean, publish: boolean, initial: WorkTemplateOut | null): string {
  if (save) return 'Save draft';
  if (!publish) return 'Review definition';
  return initial?.status === 'published' ? 'Publish next version' : 'Publish to workspace';
}

function saveStatus(form: WorkTemplateFormState, existing: boolean): string {
  if (form.pending) return 'Saving…';
  if (form.dirty) return 'Unsaved changes';
  if (form.saved) return 'Saved';
  return existing ? 'Saved draft' : 'Not yet saved';
}

function actionAvailable(
  save: boolean,
  publish: boolean,
  section: TemplateDefinitionSection,
): boolean {
  return save || publish || section !== 'review';
}

function actionDisabled(
  form: WorkTemplateFormState,
  invalid: boolean,
  save: boolean,
  publicationBlocked: boolean,
): boolean {
  return form.pending || invalid || (save && !form.canEdit) || publicationBlocked;
}
