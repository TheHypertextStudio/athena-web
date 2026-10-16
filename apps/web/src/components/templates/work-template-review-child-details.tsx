'use client';
import type { JSX } from 'react';
import type { Blueprint, BlueprintStep } from '@docket/work/work-template-blueprint';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Button } from '@docket/ui/primitives';
import { useApiQuery } from '@/lib/query';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import Link from '@/components/docket-link';
import { sectionHref } from '@/components/settings/settings-registry';
import { pendingTemplateReference } from './work-template-pending-reference';
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
  selected,
}: {
  orgId: string;
  template: NonNullable<BlueprintStep['template']>;
  name: string;
  selected?: WorkTemplateOut | undefined;
}): JSX.Element {
  const selection = template.selection;
  const pending = pendingTemplateReference(template, selected);
  const versions = useApiQuery({
    ...workTemplateVersionsDef(orgId, template.workTypeId),
    enabled: selection.kind === 'pinned' && !pending,
  });
  const number =
    selection.kind === 'pinned'
      ? versions.data?.items.find((value) => value.id === selection.workTypeVersionId)?.number
      : undefined;
  if (pending)
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Badge variant="outline" className="max-w-full break-words whitespace-normal">
          Unpublished {pending.definition.name} — publish this definition before its parent
        </Badge>
        {pending.canEdit ? (
          <Button asChild variant="ghost" className="min-h-10 self-start">
            <Link href={`${sectionHref(orgId, 'templates')}/${pending.id}?section=review`}>
              Review {pending.definition.name}
            </Link>
          </Button>
        ) : null}
      </div>
    );
  return (
    <Badge variant="outline" className="max-w-full break-words whitespace-normal">
      {name} ·{' '}
      {selection.kind === 'latest'
        ? 'Latest publication when work is created'
        : number
          ? `Fixed at Version ${number}`
          : versions.isPending
            ? 'Checking publication'
            : 'Publication unavailable — review required'}
    </Badge>
  );
}
