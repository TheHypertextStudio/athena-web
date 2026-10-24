'use client';
import type { JSX } from 'react';
import { useApiQuery } from '@/lib/query';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { workTemplatesDef } from './work-template-queries';
import { WorkTemplateReviewStartingValues } from './work-template-review-starting-values';
import { WorkTemplateReviewChildren } from './work-template-review-children';
import { WorkTemplateBlueprintSummary } from './work-template-blueprint-summary';
import { ProgramDefaultScheduleReview } from './program-default-schedule-review';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Review starting work, the included hierarchy and reusable routines before publication. */
export function WorkTemplateDefinitionReview({
  form,
  orgId,
  templateId,
}: {
  orgId: string;
  form: WorkTemplateFormState;
  templateId?: string | undefined;
}): JSX.Element {
  const templates = useApiQuery(workTemplatesDef(orgId, { includeDrafts: true }));
  const blueprint = form.definition.blueprint;
  const payload = form.definition.payload;
  const name = payload.targetType === 'task' ? payload.title : payload.name;
  return (
    <section
      aria-label="Work definition review"
      className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10"
    >
      <StartingWorkReview form={form} orgId={orgId} />
      <div className="flex min-w-0 flex-col gap-5">
        <section aria-label="Included work" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 tabIndex={-1} className="text-title-large">
              Included work
            </h2>
            <WorkTemplateBlueprintSummary blueprint={blueprint} />
          </div>
          {blueprint.steps.length ? (
            <WorkTemplateReviewChildren
              blueprint={blueprint}
              rootName={name?.trim() ? name : form.definition.name}
              rootKind={form.kind}
              orgId={orgId}
              templates={templates.data?.items ?? []}
              rootId={templateId}
            />
          ) : (
            <p className="text-body-medium text-on-surface-variant">
              Creates this item without child work.
            </p>
          )}
        </section>
        <ProgramDefaultScheduleReview
          orgId={orgId}
          values={form.definition.defaultSchedules}
          templates={templates.data?.items ?? []}
        />
      </div>
    </section>
  );
}

function StartingWorkReview({
  form,
  orgId,
}: {
  form: WorkTemplateFormState;
  orgId: string;
}): JSX.Element {
  return (
    <section aria-label="Starting work" className="flex min-w-0 flex-col gap-4">
      <h2 tabIndex={-1} className="text-title-large">
        Starting work
      </h2>
      <WorkTemplateReviewStartingValues
        orgId={orgId}
        payload={form.definition.payload}
        defaultStatusKey={form.definition.defaultStatusKey}
        heading={false}
        compactProperties
      >
        {form.definition.payload.description ? (
          <div className="min-w-0" aria-label="Starting document">
            <StaticMarkdown
              value={form.definition.payload.description}
              className="text-body-large"
            />
          </div>
        ) : (
          <p className="text-body-medium text-on-surface-variant">Starts with an empty document.</p>
        )}
      </WorkTemplateReviewStartingValues>
    </section>
  );
}
