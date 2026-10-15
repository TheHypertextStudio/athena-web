'use client';
import type { JSX, ReactNode } from 'react';
import type { CanonicalTemplateDraft } from '@docket/work/template-contract';
import { TemplateDisclosure } from './template-disclosure';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { useComposerOptions } from '@/components/pickers/use-composer-options';

/** Read back the actual starting values, using workspace status and label names. */
export function WorkTemplateReviewStartingValues({
  orgId,
  payload,
  defaultStatusKey,
  heading = 'Each item starts with',
  compactProperties = false,
  children,
}: {
  orgId: string;
  payload: CanonicalTemplateDraft;
  defaultStatusKey?: string | null;
  heading?: string | false;
  compactProperties?: boolean;
  children?: ReactNode;
}): JSX.Element {
  const { title, defaults } = useTemplateStartingValues(orgId, payload, defaultStatusKey);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {heading ? <h3 className="text-title-medium">{heading}</h3> : null}
      <p className="text-title-large break-words">
        {title?.trim() ? title : 'A name supplied when creating work'}
      </p>
      {payload.summary ? <p className="text-body-medium break-words">{payload.summary}</p> : null}
      {payload.targetType === 'program' && payload.visibility === 'private' ? (
        <p className="text-body-small">Private work — access must be granted explicitly.</p>
      ) : null}
      {children}
      {compactProperties ? (
        defaults.length ? (
          <TemplateDisclosure title="Starting properties">
            <p className="text-body-small text-on-surface-variant">{defaults.join(' · ')}</p>
          </TemplateDisclosure>
        ) : null
      ) : (
        <p className="text-body-small text-on-surface-variant">
          {defaults.length ? defaults.join(' · ') : 'Workspace starting defaults'}
        </p>
      )}
    </div>
  );
}

function useTemplateStartingValues(
  orgId: string,
  payload: CanonicalTemplateDraft,
  defaultStatusKey?: string | null,
) {
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
  return { title, defaults };
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
