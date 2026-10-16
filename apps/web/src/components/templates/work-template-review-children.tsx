'use client';
import type { JSX } from 'react';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { useVocabulary } from '@docket/ui/hooks';
import {
  blueprintOutlineNodes,
  blueprintStepName,
  type BlueprintOutlineNode,
} from './work-template-blueprint-edit';
import { blueprintStepTiming } from './work-template-blueprint-timing';
import {
  WorkTemplateReviewChildDetails,
  WorkTemplateReviewNestedVersion,
} from './work-template-review-child-details';
import { WorkTemplateReviewChildStartingDetails } from './work-template-review-child-starting-details';
import type { WorkTemplateFormState } from './use-work-template-form';

interface ReviewContext {
  readonly blueprint: Blueprint;
  readonly rootName: string;
  readonly rootKind: WorkTemplateFormState['kind'];
  readonly orgId: string;
  readonly templates: readonly WorkTemplateOut[];
  readonly rootId?: string | undefined;
}
/** Read the same authored hierarchy as the editor, with responsibility and constraints in context. */
export function WorkTemplateReviewChildren(props: ReviewContext): JSX.Element {
  return (
    <ReviewBranch
      nodes={blueprintOutlineNodes(props.blueprint)}
      context={props}
      depth={0}
      label="Included work review"
    />
  );
}
function ReviewBranch({
  nodes,
  context,
  depth,
  label,
}: {
  readonly nodes: readonly BlueprintOutlineNode[];
  readonly context: ReviewContext;
  readonly depth: number;
  readonly label: string;
}): JSX.Element {
  return (
    <ol
      aria-label={label}
      className={`flex min-w-0 flex-col gap-5 ${depth > 0 && depth <= 3 ? 'mt-4 pl-4' : ''}`}
    >
      {nodes.map(({ step, children }) => (
        <li key={step.key} className="flex min-w-0 flex-col gap-2">
          <ReviewChild step={step} {...context} />
          {children.length ? (
            <ReviewBranch
              nodes={children}
              context={context}
              depth={depth + 1}
              label={`Included under ${blueprintStepName(step)}`}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
function ReviewChild({
  step,
  blueprint,
  rootName,
  rootKind,
  orgId,
  templates,
  rootId,
}: ReviewContext & { readonly step: BlueprintStep }): JSX.Element {
  const kind = useVocabulary(step.kind === 'milestone' ? 'task' : step.kind);
  const hasDates = Object.values(step.dates).some((rule) => rule && rule.kind !== 'none');
  return (
    <>
      <div>
        <h3 className="text-title-small break-words">{blueprintStepName(step)}</h3>
        <p className="text-body-small text-on-surface-variant">
          {step.kind === 'milestone' ? 'Milestone' : kind}
          {step.optional.enabled
            ? ` · Optional${step.optional.selectedByDefault ? '' : ' (unchecked)'}`
            : ''}
        </p>
      </div>
      {hasDates ? (
        <p className="text-body-small text-on-surface-variant">
          {blueprintStepTiming(step, blueprint, rootName, rootKind)}
        </p>
      ) : null}
      <ReviewResponsibility step={step} blueprint={blueprint} rootKind={rootKind} />
      <WorkTemplateReviewChildDetails step={step} blueprint={blueprint} />
      {step.template ? (
        <WorkTemplateReviewNestedVersion
          orgId={orgId}
          returnTo={rootId}
          template={step.template}
          selected={templates.find(
            (value) => value.id === step.template?.workTypeId && value.targetType === step.kind,
          )}
          name={
            templates.find((value) => value.id === step.template?.workTypeId)?.definition.name ??
            'Selected template'
          }
        />
      ) : null}
      <WorkTemplateReviewChildStartingDetails orgId={orgId} step={step} />
    </>
  );
}
function ReviewResponsibility({
  step,
  blueprint,
  rootKind,
}: Pick<ReviewContext, 'blueprint' | 'rootKind'> & {
  readonly step: BlueprintStep;
}): JSX.Element | null {
  const parent = responsibleParent(step, blueprint);
  const kind = parent?.kind ?? rootKind;
  const noun = useVocabulary(kind === 'milestone' ? rootKind : kind);
  const team = useVocabulary('team').toLocaleLowerCase();
  if (step.kind === 'milestone') return null;
  const label = parent ? blueprintStepName(parent) : noun;
  const role = kind === 'task' ? 'assignee' : kind === 'project' ? 'lead' : 'owner';
  const actors = {
    creator: 'Person creating work',
    parent_responsible: `${label} ${role}`,
    athena: 'Athena',
    unassigned: 'Unassigned',
  };
  const teams = {
    creation_team: `Selected ${team}`,
    parent_team: `Same ${team} as ${label}, or the ${team} chosen for new work`,
    none: `No ${team}`,
  };
  return (
    <p className="text-body-small text-on-surface-variant">
      {actors[step.actorRule]} · {teams[step.teamRule]}
    </p>
  );
}
function responsibleParent(step: BlueprintStep, blueprint: Blueprint): BlueprintStep | undefined {
  let parent = blueprint.steps.find((value) => value.key === step.parentStepKey);
  const visited = new Set<string>();
  while (parent?.kind === 'milestone' && !visited.has(parent.key)) {
    visited.add(parent.key);
    parent = blueprint.steps.find((value) => value.key === parent?.parentStepKey);
  }
  return parent?.kind === 'milestone' ? undefined : parent;
}
