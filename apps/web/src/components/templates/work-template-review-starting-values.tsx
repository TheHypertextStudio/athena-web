'use client';
import type { JSX } from 'react';
import type { CanonicalTemplateDraft } from '@docket/work/template-contract';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { useComposerOptions } from '@/components/pickers/use-composer-options';

/** Read back the actual starting values, using workspace status and label names. */
export function WorkTemplateReviewStartingValues({
  orgId,
  payload,
  defaultStatusKey,
}: {
  orgId: string;
  payload: CanonicalTemplateDraft;
  defaultStatusKey?: string | null;
}): JSX.Element {
  const registry = useStatusRegistry();
  const options = useComposerOptions(orgId, ['labels'], payload.targetType === 'task');
  const title = payload.targetType === 'task' ? payload.title : payload.name;
  const statusKey =
    defaultStatusKey ?? (payload.targetType === 'task' ? payload.state : payload.status);
  const status = registry
    .statusesFor(payload.targetType)
    .find((value) => value.key === statusKey)?.name;
  const defaults = startingProperties(payload);
  if (statusKey) defaults.push(`${status ?? 'Unavailable starting status'} status`);
  const labels = startingLabels(payload, options.labelOptions);
  if (labels) defaults.push(labels);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-title-medium">Each item starts with</h3>
      <p className="text-title-large break-words">
        {title?.trim() ? title : 'A name supplied when creating work'}
      </p>
      {payload.summary ? <p className="text-body-medium break-words">{payload.summary}</p> : null}
      <p className="text-body-small text-on-surface-variant">
        {defaults.length ? defaults.join(' · ') : 'Workspace starting defaults'}
      </p>
    </div>
  );
}

function startingProperties(payload: CanonicalTemplateDraft): string[] {
  const values: string[] = [];
  if ('priority' in payload && payload.priority)
    values.push(`${sentence(payload.priority)} priority`);
  if ('health' in payload && payload.health) values.push(sentence(payload.health));
  if (payload.targetType === 'program' && payload.visibility)
    values.push(`${sentence(payload.visibility)} work`);
  if (payload.targetType === 'initiative' && payload.updateCadence) {
    const cadence = {
      weekly: 'Weekly updates',
      biweekly: 'Updates every two weeks',
      monthly: 'Monthly updates',
      quarterly: 'Quarterly updates',
      none: 'No scheduled updates',
    };
    values.push(cadence[payload.updateCadence]);
  }
  if (payload.targetType === 'task') {
    if (payload.estimate !== undefined) values.push(`${payload.estimate} points`);
    if (payload.estimateMinutes != null) values.push(`${payload.estimateMinutes} minutes`);
  }
  return values;
}

function sentence(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1).replaceAll('_', ' ');
}

function startingLabels(
  payload: CanonicalTemplateDraft,
  options: readonly { value: string; label: string }[],
): string | null {
  if (payload.targetType !== 'task' || !payload.labelIds?.length) return null;
  return `Labels: ${payload.labelIds.map((id) => options.find((value) => value.value === id)?.label ?? 'Unavailable label').join(', ')}`;
}
