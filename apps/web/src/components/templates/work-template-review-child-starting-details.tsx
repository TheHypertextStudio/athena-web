'use client';
import type { JSX } from 'react';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import { CanonicalTemplateDraft } from '@docket/work/template-contract';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { TemplateDisclosure } from './template-disclosure';
import { blueprintStepName } from './work-template-blueprint-edit';
import { WorkTemplateReviewStartingValues } from './work-template-review-starting-values';

/** Inspect authored child documents and defaults without expanding every field during review. */
export function WorkTemplateReviewChildStartingDetails({
  orgId,
  step,
}: {
  orgId: string;
  step: BlueprintStep;
}): JSX.Element | null {
  const meaningful = Object.entries(step.fields).some(
    ([key, value]) => key !== 'title' && key !== 'name' && value !== undefined,
  );
  if (!meaningful) return null;
  return (
    <TemplateDisclosure title={`Starting details for ${blueprintStepName(step)}`}>
      {step.template ? (
        <p className="text-body-medium text-on-surface-variant">
          These details replace the matching details from the selected template.
        </p>
      ) : null}
      {step.kind !== 'milestone' ? (
        <WorkTemplateReviewStartingValues
          orgId={orgId}
          payload={CanonicalTemplateDraft.parse({ ...step.fields, targetType: step.kind })}
        />
      ) : null}
      {step.fields.description ? (
        <StaticMarkdown value={step.fields.description} className="text-body-large" />
      ) : (
        <p className="text-body-medium text-on-surface-variant">No starting document.</p>
      )}
    </TemplateDisclosure>
  );
}
