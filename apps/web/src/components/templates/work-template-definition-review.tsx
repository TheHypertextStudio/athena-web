'use client';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import type { JSX } from 'react';
import { useVocabulary } from '@docket/ui/hooks';
import { Surface } from '@docket/ui/primitives';
import { useApiQuery } from '@/lib/query';
import { workTemplatesDef } from './work-template-queries';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { orderedBlueprintChildren, blueprintStepName } from './work-template-blueprint-edit';
import { WorkTemplateReviewChildStartingDetails } from './work-template-review-child-starting-details';
import { blueprintStepTiming } from './work-template-blueprint-timing';
import { WorkTemplateReviewStartingValues } from './work-template-review-starting-values';
import {
  WorkTemplateReviewChildDetails,
  WorkTemplateReviewNestedVersion,
} from './work-template-review-child-details';
import type { WorkTemplateFormState } from './use-work-template-form';

/** Read back the current organization work definition before sharing it with the workspace. */
export function WorkTemplateDefinitionReview({
  form,
  orgId,
}: {
  orgId: string;
  form: WorkTemplateFormState;
}): JSX.Element {
  const noun = useVocabulary(form.kind);
  const templates = useApiQuery(workTemplatesDef(orgId));
  const team = useVocabulary('team').toLocaleLowerCase();
  const blueprint = form.definition.blueprint;
  return (
    <Surface
      as="section"
      tone="card"
      shape="extra-large"
      pad="roomy"
      aria-label="Work definition review"
      className="flex min-w-0 flex-col gap-5 sm:p-6"
    >
      <div>
        <p className="text-label-medium text-on-surface-variant">{noun} definition</p>
        <h2 tabIndex={-1} className="text-title-large break-words">
          {form.definition.name.trim() ? form.definition.name : 'Unnamed work'}
        </h2>
        <p className="text-body-medium text-on-surface-variant">
          {form.definition.description?.trim()
            ? form.definition.description
            : 'No usage guidance added.'}
        </p>
      </div>
      <WorkTemplateReviewStartingValues
        orgId={orgId}
        payload={form.definition.payload}
        defaultStatusKey={form.definition.defaultStatusKey}
      />
      <div>
        <h3 className="text-title-medium">Starting outline</h3>
        {form.definition.payload.description ? (
          <StaticMarkdown value={form.definition.payload.description} />
        ) : (
          <p className="text-body-medium text-on-surface-variant">
            Each item starts with an empty document.
          </p>
        )}
      </div>
      <div>
        <h3 className="text-title-medium">Included work</h3>
        {blueprint.steps.length ? (
          <ol className="mt-3 flex min-w-0 flex-col gap-4">
            {orderedBlueprintChildren(blueprint).map((step) => (
              <ReviewChild
                key={step.key}
                step={step}
                blueprint={blueprint}
                team={team}
                rootName={form.definition.name}
                rootKind={form.kind}
                orgId={orgId}
                templates={templates.data?.items ?? []}
              />
            ))}
          </ol>
        ) : (
          <p className="text-body-medium text-on-surface-variant">
            No child work is created with this item.
          </p>
        )}
      </div>
    </Surface>
  );
}

function ReviewChild({
  step,
  blueprint,
  team,
  rootName,
  rootKind,
  orgId,
  templates,
}: {
  step: BlueprintStep;
  blueprint: Blueprint;
  team: string;
  rootName: string;
  rootKind: WorkTemplateFormState['kind'];
  orgId: string;
  templates: readonly WorkTemplateOut[];
}): JSX.Element {
  const kind = useVocabulary(step.kind === 'milestone' ? 'task' : step.kind);
  const parent = blueprint.steps.find((value) => value.key === step.parentStepKey);
  const parentName = responsibilityParentName(step, blueprint, rootName);
  const actors = {
    creator: 'Assigned to the person creating work',
    parent_responsible: `Assigned to ${parentName}’s responsible person`,
    athena: 'Assigned to Athena',
    unassigned: 'Unassigned',
  };
  const teams = {
    creation_team: `Creation ${team}`,
    parent_team: `${parentName}’s ${team}, otherwise creation ${team}`,
    none: `No inherited ${team}`,
  };
  return (
    <li className="min-w-0">
      {step.template ? (
        <WorkTemplateReviewNestedVersion
          orgId={orgId}
          template={step.template}
          name={
            templates.find((value) => value.id === step.template?.workTypeId)?.definition.name ??
            'Nested definition'
          }
        />
      ) : null}
      <p className="text-label-large break-words">
        {step.parentStepKey ? '↳ ' : ''}
        {blueprintStepName(step)}
        {step.optional.enabled
          ? ` · Optional${step.optional.selectedByDefault ? '' : ', unchecked'}`
          : ''}
      </p>
      <p className="text-label-medium text-on-surface-variant">
        {step.kind === 'milestone' ? 'Milestone' : kind} · Under{' '}
        {parent ? blueprintStepName(parent) : rootName}
      </p>
      <p className="text-body-small text-on-surface-variant">
        {blueprintStepTiming(step, blueprint, rootName, rootKind)}
      </p>
      {step.kind !== 'milestone' ? (
        <p className="text-body-small text-on-surface-variant">
          {actors[step.actorRule]} · {teams[step.teamRule]}
        </p>
      ) : null}
      <WorkTemplateReviewChildDetails step={step} blueprint={blueprint} />
      <WorkTemplateReviewChildStartingDetails orgId={orgId} step={step} />
    </li>
  );
}

function responsibilityParentName(
  step: BlueprintStep,
  blueprint: Blueprint,
  rootName: string,
): string {
  let parent = blueprint.steps.find((value) => value.key === step.parentStepKey);
  const visited = new Set<string>();
  while (parent?.kind === 'milestone' && !visited.has(parent.key)) {
    visited.add(parent.key);
    const parentKey = parent.parentStepKey;
    parent = blueprint.steps.find((value) => value.key === parentKey);
  }
  return parent && parent.kind !== 'milestone' ? blueprintStepName(parent) : rootName;
}
