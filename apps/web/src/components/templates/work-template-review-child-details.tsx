'use client';
import type { JSX } from 'react';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge } from '@docket/ui/primitives';
import { useApiQuery } from '@/lib/query';
import { workTemplateVersionsDef } from './work-template-queries';
import { blueprintStepName } from './work-template-blueprint-edit';

/** Human-readable authored blockers and cycle choices are part of the publication decision. */
export function WorkTemplateReviewChildDetails({
  step,
  blueprint,
}: {
  step: BlueprintStep;
  blueprint: Blueprint;
}): JSX.Element | null {
  const cycle = useVocabulary('cycle').toLocaleLowerCase();
  const team = useVocabulary('team').toLocaleLowerCase();
  const task = useVocabulary('task').toLocaleLowerCase();
  if (step.kind !== 'task') return null;
  const blockers = blueprint.dependencies
    .filter((edge) => edge.blockedStepKey === step.key)
    .flatMap((edge) => blueprint.steps.find((value) => value.key === edge.blockerStepKey) ?? [])
    .map(blueprintStepName);
  const cycles = {
    none: `No ${cycle}`,
    parent_cycle: `Nearest parent ${task}’s ${cycle}`,
    current_cycle: `Current ${cycle} for the selected ${team}`,
  };
  return (
    <>
      {blockers.length ? (
        <p className="text-body-small text-on-surface-variant">
          Blocked by {blockers.join(' and ')}
        </p>
      ) : null}
      {step.cycleRule !== 'none' ? (
        <p className="text-body-small text-on-surface-variant">{cycles[step.cycleRule]}</p>
      ) : null}
    </>
  );
}

/** Show whether future work follows new publications or stays at one reviewed version. */
export function WorkTemplateReviewNestedVersion({
  orgId,
  template,
  name,
}: {
  orgId: string;
  template: NonNullable<BlueprintStep['template']>;
  name: string;
}): JSX.Element {
  const selection = template.selection;
  const versions = useApiQuery({
    ...workTemplateVersionsDef(orgId, template.workTypeId),
    enabled: selection.kind === 'pinned',
  });
  const number =
    selection.kind === 'pinned'
      ? versions.data?.items.find((value) => value.id === selection.workTypeVersionId)?.number
      : undefined;
  return (
    <Badge variant="outline" className="max-w-full break-words whitespace-normal">
      {name} ·{' '}
      {selection.kind === 'latest'
        ? 'Latest publication when work is created'
        : number
          ? `Fixed at Version ${number}`
          : 'Fixed publication'}
    </Badge>
  );
}
