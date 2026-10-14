'use client';
import type { JSX } from 'react';
import { Surface } from '@docket/ui/primitives';
import type { PickerOption } from '@docket/ui/components';
import type { TemplateWorkflowProps } from './template-workflow-shell';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useStatusRegistry, type StatusRegistry } from '@/components/statuses/status-registry';
/** Summarize the values that the existing template API will persist. */
export function TemplateReview({ props }: { props: TemplateWorkflowProps }): JSX.Element {
  const registry = useStatusRegistry();
  const options = useComposerOptions(props.mentionOrgId ?? '', ['labels', 'teams'], props.open);
  const rows = Object.entries(props.payload).filter(
    ([key]) => key !== 'targetType' && key !== 'description',
  );
  const sharing =
    props.templateScope === 'personal'
      ? 'Only you'
      : props.templateScope === 'team'
        ? (options.teamOptions.find((team) => team.value === props.templateTeamId)?.label ??
          'This team')
        : 'Everyone in this workspace';
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-title-large break-words">{props.templateName.trim()}</h2>
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <ReviewValue
            label="When to use it"
            value={props.templateDescription.trim() || 'No description'}
          />
          <ReviewValue label="Shared with" value={sharing} />
        </dl>
      </div>
      <Surface tone="card" shape="medium" pad="comfortable" className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-label-large">{props.workNoun} details</h3>
          {props.title ? (
            <p className="text-title-large break-words">{props.title}</p>
          ) : (
            <p className="text-body-medium text-on-surface-variant">
              Name added when you create the {props.workNoun.toLowerCase()}
            </p>
          )}
          {props.summary ? (
            <p className="text-body-medium text-on-surface-variant">{props.summary}</p>
          ) : null}
        </div>
        <section className="flex min-w-0 flex-col gap-2" aria-label="Starting settings">
          <h3 className="text-label-large">Starting settings</h3>
          <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            {rows
              .filter(([key]) => !['title', 'name', 'summary'].includes(key))
              .map(([key, value]) => (
                <ReviewValue
                  key={key}
                  label={fieldLabel(key)}
                  value={reviewValue(key, value, props, registry, options.labelOptions)}
                />
              ))}
          </dl>
        </section>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-label-large">Description</h3>
          {props.body ? (
            <StaticMarkdown value={props.body} />
          ) : (
            <p className="text-body-medium text-on-surface-variant">No description</p>
          )}
        </div>
      </Surface>
    </div>
  );
}

function ReviewValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-label-large text-on-surface-variant">{label}</dt>
      <dd className="text-body-medium break-words">{value}</dd>
    </div>
  );
}

function fieldLabel(key: string): string {
  if (key === 'labelIds') return 'Labels';
  return key === 'updateCadence' ? 'Update cadence' : readableValue(key);
}

function readableValue(value: string): string {
  const words = value.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function reviewValue(
  key: string,
  value: unknown,
  props: TemplateWorkflowProps,
  registry: StatusRegistry,
  labels: readonly PickerOption[],
): string {
  if (key === 'status')
    return registry.statusOf(props.targetType, String(value))?.name ?? String(value);
  if (key === 'labelIds' && Array.isArray(value))
    return value
      .map((id) => labels.find((label) => label.value === id)?.label ?? 'Unavailable label')
      .join(', ');
  return readableValue(String(value));
}
