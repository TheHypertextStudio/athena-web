import type { JSX } from 'react';
import { Badge, Button, Field, Select } from '@docket/ui/primitives';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { useApiQuery } from '@/lib/query';
import { QueryLoadFailure } from '@/components/feedback';
import Link from '@/components/docket-link';
import { workTemplateHref } from './work-template-navigation';
import { pendingTemplateReference } from './work-template-pending-reference';
import { workTemplateVersionsDef } from './work-template-queries';

type Reference = NonNullable<BlueprintStep['template']>;
interface ReferenceProps {
  orgId: string;
  pendingDraft: WorkTemplateOut | undefined;
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
  const authorized = templates.find(
    (item) => item.id === reference?.workTypeId && item.targetType === step.kind,
  );
  const pendingDraft = pendingTemplateReference(reference, authorized);
  const versions = useBlueprintVersions(orgId, pendingDraft ? null : reference);
  if (step.kind === 'milestone') return null;
  const choices = publishedChoices(templates, step.kind);
  const selected = pendingDraft ?? choices.find((item) => item.id === reference?.workTypeId);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ReferencePicker
        step={step}
        reference={reference}
        pendingDraft={pendingDraft}
        selected={selected}
        choices={choices}
        disabled={disabled}
        onChange={onChange}
      />
      {reference ? (
        <SelectedReference
          orgId={orgId}
          pendingDraft={pendingDraft}
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
function ReferencePicker({
  step,
  reference,
  pendingDraft,
  selected,
  choices,
  disabled,
  onChange,
}: Pick<ReferenceProps, 'step' | 'pendingDraft' | 'selected' | 'disabled' | 'onChange'> & {
  readonly reference: Reference | null;
  readonly choices: readonly WorkTemplateOut[];
}): JSX.Element {
  return (
    <Field
      label="Nested template"
      description="Inline children use the blank template's starting fields. A selected template also contributes its own children."
    >
      <Select
        disabled={disabled}
        value={reference?.workTypeId ?? ''}
        onChange={(event) => {
          if (pendingDraft?.id === event.target.value) return;
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
        {pendingDraft ? (
          <option value={pendingDraft.id}>Unpublished {pendingDraft.definition.name}</option>
        ) : null}
        {choices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.definition.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
function SelectedReference(props: ReferenceProps): JSX.Element {
  const { reference, selected } = props;
  if (props.pendingDraft)
    return <PendingReference orgId={props.orgId} draft={props.pendingDraft} />;
  const latest = selected?.latestVersion?.id ?? props.versions[0]?.id;
  return (
    <>
      <Badge variant="outline">
        {selected?.definition.name ?? 'Retained template'} ·{' '}
        {reference.selection.kind === 'latest'
          ? 'Use latest publication'
          : props.versions.some(
                (version) =>
                  reference.selection.kind === 'pinned' &&
                  version.id === reference.selection.workTypeVersionId,
              )
            ? 'Pinned publication'
            : props.pending
              ? 'Checking publication'
              : 'Publication unavailable — review required'}
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
          <option value={pinnedId}>Publication unavailable — review required</option>
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

function PendingReference({
  orgId,
  draft,
}: {
  readonly orgId: string;
  readonly draft: WorkTemplateOut;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Badge variant="outline">Unpublished {draft.definition.name}</Badge>
      <p className="text-body-small text-on-surface-variant">
        Publish this definition before publishing its parent. This reference keeps the reserved
        first publication.
      </p>
      {draft.canEdit ? (
        <Button asChild variant="ghost" className="min-h-10 self-start">
          <Link href={`${workTemplateHref(orgId)}/${draft.id}?section=review`}>
            Review {draft.definition.name}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
