import type { JSX } from 'react';
import { Badge, Field, Select } from '@docket/ui/primitives';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { useApiQuery } from '@/lib/query';
import { QueryLoadFailure } from '@/components/feedback';
import { workTemplateVersionsDef } from './work-template-queries';

type Reference = NonNullable<BlueprintStep['template']>;
interface ReferenceProps {
  step: Exclude<BlueprintStep, { kind: 'milestone' }>;
  reference: Reference;
  disabled: boolean;
  selected: WorkTemplateOut | undefined;
  versions: readonly { id: string; number: number }[];
  pending: boolean;
  onChange: (step: BlueprintStep) => void;
}
/** Select a same-kind published child template and explicitly retain latest or an exact publication. */
export function WorkTemplateBlueprintReferenceFields({
  orgId,
  step,
  templates,
  disabled,
  onChange,
}: {
  orgId: string;
  step: BlueprintStep;
  templates: readonly WorkTemplateOut[];
  disabled: boolean;
  onChange: (step: BlueprintStep) => void;
}): JSX.Element | null {
  const reference = step.template;
  const versions = useBlueprintVersions(orgId, reference);
  if (step.kind === 'milestone') return null;
  const choices = publishedChoices(templates, step.kind);
  const selected = choices.find((item) => item.id === reference?.workTypeId);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field
        label="Nested template"
        description="Inline children use the blank template's starting fields. A selected template also contributes its own children."
      >
        <Select
          disabled={disabled}
          value={reference?.workTypeId ?? ''}
          onChange={(event) => {
            onChange({
              ...step,
              template: event.target.value
                ? {
                    workTypeId: WorkTypeId.parse(event.target.value),
                    selection: { kind: 'latest' },
                  }
                : null,
            });
          }}
        >
          <option value="">Inline child</option>
          {reference && !selected ? (
            <option value={reference.workTypeId}>Retained template</option>
          ) : null}
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.definition.name}
            </option>
          ))}
        </Select>
      </Field>
      {reference ? (
        <SelectedReference
          step={step}
          reference={reference}
          selected={selected}
          versions={versions.data?.items ?? []}
          pending={versions.isPending}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
      {reference && versions.isError ? (
        <QueryLoadFailure title="Published versions" query={versions} />
      ) : null}
    </div>
  );
}
function SelectedReference(props: ReferenceProps): JSX.Element {
  const { reference, selected } = props;
  const latest = selected?.latestVersion?.id ?? props.versions[0]?.id;
  return (
    <>
      <Badge variant="outline">
        {selected?.definition.name ?? 'Retained template'} ·{' '}
        {reference.selection.kind === 'latest' ? 'Latest published' : 'Pinned publication'}
      </Badge>
      <Field label="Template version">
        <Select
          disabled={props.disabled}
          value={reference.selection.kind}
          onChange={(event) => {
            if (event.target.value === 'latest')
              props.onChange({
                ...props.step,
                template: { ...reference, selection: { kind: 'latest' } },
              });
            else if (latest)
              props.onChange({
                ...props.step,
                template: {
                  ...reference,
                  selection: { kind: 'pinned', workTypeVersionId: WorkTypeVersionId.parse(latest) },
                },
              });
          }}
        >
          <option value="latest">Use latest when creating work</option>
          <option value="pinned" disabled={!latest}>
            Pin a published version
          </option>
        </Select>
      </Field>
      {reference.selection.kind === 'pinned' ? (
        <PinnedReference {...props} pinnedId={reference.selection.workTypeVersionId} />
      ) : null}
    </>
  );
}
function PinnedReference({
  step,
  reference,
  disabled,
  pending,
  versions,
  onChange,
  pinnedId,
}: ReferenceProps & { pinnedId: string }): JSX.Element {
  return (
    <Field label="Pinned version">
      <Select
        disabled={disabled || pending}
        value={pinnedId}
        onChange={(event) => {
          onChange({
            ...step,
            template: {
              ...reference,
              selection: {
                kind: 'pinned',
                workTypeVersionId: WorkTypeVersionId.parse(event.target.value),
              },
            },
          });
        }}
      >
        {!versions.some((version) => version.id === pinnedId) ? (
          <option value={pinnedId}>Retained published version</option>
        ) : null}
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            Version {version.number}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function publishedChoices(
  templates: readonly WorkTemplateOut[],
  kind: BlueprintStep['kind'],
): WorkTemplateOut[] {
  return templates.filter(
    (item) =>
      item.targetType === kind && item.status === 'published' && item.latestVersion !== null,
  );
}

function useBlueprintVersions(orgId: string, reference: Reference | null) {
  return useApiQuery({
    ...workTemplateVersionsDef(orgId, reference?.workTypeId ?? ''),
    enabled: reference !== null,
  });
}
