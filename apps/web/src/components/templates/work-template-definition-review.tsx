'use client';
import type { JSX } from 'react';
import { Surface } from '@docket/ui/primitives';
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
}: {
  orgId: string;
  form: WorkTemplateFormState;
}): JSX.Element {
  const templates = useApiQuery(workTemplatesDef(orgId, { includeDrafts: true }));
  const blueprint = form.definition.blueprint;
  return (
    <section
      aria-label="Work definition review"
      className="grid min-w-0 items-start gap-5 xl:grid-cols-2"
    >
      <Surface
        as="section"
        tone="card"
        shape="large"
        pad="roomy"
        aria-label="Starting work"
        className="flex min-w-0 flex-col gap-4"
      >
        <h2 tabIndex={-1} className="text-title-large">
          Starting work
        </h2>
        {form.definition.description?.trim() ? (
          <p className="text-body-medium text-on-surface-variant">{form.definition.description}</p>
        ) : null}
        <WorkTemplateReviewStartingValues
          orgId={orgId}
          payload={form.definition.payload}
          defaultStatusKey={form.definition.defaultStatusKey}
          heading={false}
          compactProperties
        >
          {form.definition.payload.description ? (
            <StaticMarkdown value={form.definition.payload.description} />
          ) : (
            <p className="text-body-small text-on-surface-variant">
              Starts with an empty document.
            </p>
          )}
        </WorkTemplateReviewStartingValues>
      </Surface>
      <div className="flex min-w-0 flex-col gap-5">
        <Surface
          as="section"
          tone="card"
          shape="large"
          pad="roomy"
          aria-label="Included work"
          className="flex min-w-0 flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-title-large">Included work</h2>
            <WorkTemplateBlueprintSummary blueprint={blueprint} />
          </div>
          {blueprint.steps.length ? (
            <WorkTemplateReviewChildren
              blueprint={blueprint}
              rootName={form.definition.name}
              rootKind={form.kind}
              orgId={orgId}
              templates={templates.data?.items ?? []}
            />
          ) : (
            <p className="text-body-medium text-on-surface-variant">
              Creates this item without child work.
            </p>
          )}
        </Surface>
        <ProgramDefaultScheduleReview
          orgId={orgId}
          values={form.definition.defaultSchedules}
          templates={templates.data?.items ?? []}
        />
      </div>
    </section>
  );
}
