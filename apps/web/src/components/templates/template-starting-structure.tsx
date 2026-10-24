'use client';
import type { JSX } from 'react';
import { Button } from '@docket/ui/primitives';
import { useApiQuery } from '@/lib/query';
import { workTemplatesDef } from './work-template-queries';
import { WorkTemplateReviewChildren } from './work-template-review-children';
import { ProgramDefaultScheduleReview } from './program-default-schedule-review';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Keep the real included work beside its starting document without adding another editor. */
export function TemplateStartingStructure({
  orgId,
  form,
  onEdit,
}: {
  orgId: string;
  form: WorkTemplateFormState;
  onEdit?: (() => void) | undefined;
}): JSX.Element {
  const templates = useApiQuery(workTemplatesDef(orgId, { includeDrafts: true }));
  const payload = form.definition.payload;
  const name = payload.targetType === 'task' ? payload.title : payload.name;
  return (
    <section aria-label="Starting work structure" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title-medium">Included work</h2>
        <IncludedWorkAction form={form} onEdit={onEdit} />
      </div>
      {form.definition.blueprint.steps.length ? (
        <WorkTemplateReviewChildren
          compact
          blueprint={form.definition.blueprint}
          rootName={name?.trim() ? name : 'New work'}
          rootKind={form.kind}
          orgId={orgId}
          templates={templates.data?.items ?? []}
        />
      ) : (
        <p className="text-body-medium text-on-surface-variant">No included work.</p>
      )}
      <ProgramDefaultScheduleReview
        orgId={orgId}
        values={form.definition.defaultSchedules}
        templates={templates.data?.items ?? []}
      />
    </section>
  );
}

function IncludedWorkAction({
  form,
  onEdit,
}: {
  form: WorkTemplateFormState;
  onEdit?: (() => void) | undefined;
}): JSX.Element | null {
  const count = form.definition.blueprint.steps.length;
  if (!onEdit || (!form.canEdit && count === 0)) return null;
  const label = !form.canEdit
    ? 'View included work'
    : count > 0
      ? 'Edit included work'
      : 'Add included work';
  return (
    <Button type="button" variant="ghost" size="sm" disabled={form.pending} onClick={onEdit}>
      {label}
    </Button>
  );
}
