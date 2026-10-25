'use client';
import type { JSX } from 'react';
import { Button, Field, Select } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { QueryLoadFailure } from '@/components/feedback';
import Link from '@/components/docket-link';
import { workTemplateHref } from '../work-template-navigation';
import { useApiQuery } from '@/lib/query';
import { useActiveOrg } from '@/components/active-org';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { workTemplateDef, workTemplateVersionsDef } from '../work-template-queries';
import { captureAuthoringPolicyDef } from '../work-template-capture-queries';
import { sourceCopyChoices, type SourceCopyMemory } from './source-copy-session';

/** Validate current source access and selected destination policy through existing typed readers. */
export function useSourceCopyOptions(memory: SourceCopyMemory, enabled: boolean) {
  const source = memory.source;
  const sourceOrg = source.organizationId;
  const id = source.workTypeId;
  const template = useApiQuery({
    ...workTemplateDef(sourceOrg, id),
    enabled: enabled && Boolean(id),
  });
  const history = useApiQuery({
    ...workTemplateVersionsDef(sourceOrg, id),
    enabled: enabled && Boolean(template.data?.latestVersion),
  });
  const orgId = memory.destinationOrgId ?? '';
  const policy = useApiQuery({
    ...captureAuthoringPolicyDef(orgId),
    enabled: enabled && Boolean(orgId),
  });
  const permission = useCanManageOrg(orgId, { enabled });
  const choices = availableChoices(template.data, history.data?.items);
  const selectedChoice = choices.find(
    (choice) => JSON.stringify(choice.source) === JSON.stringify(memory.source),
  );
  const allowed = canCopyToWorkspace(
    policy.data?.workTemplateAuthoring,
    permission,
    Boolean(policy.data),
  );
  const ready = [
    enabled,
    Boolean(orgId),
    Boolean(selectedChoice),
    allowed,
    !policy.isPending,
    !permission.loading,
    !history.isFetching,
  ].every(Boolean);
  return {
    template,
    history,
    choices,
    selected: Boolean(selectedChoice),
    selectedChoice,
    policy,
    permission,
    allowed,
    ready,
  };
}
function availableChoices(
  template: Parameters<typeof sourceCopyChoices>[0] | undefined,
  history: Parameters<typeof sourceCopyChoices>[1],
) {
  return template ? sourceCopyChoices(template, history) : [];
}
function canCopyToWorkspace(
  policy: 'contributors' | 'admins' | undefined,
  permission: ReturnType<typeof useCanManageOrg>,
  loaded: boolean,
): boolean {
  return loaded && (policy === 'admins' ? permission.canManage : permission.canContribute);
}
interface OptionsProps {
  readonly memory: SourceCopyMemory;
  readonly options: ReturnType<typeof useSourceCopyOptions>;
  readonly locked: boolean;
  readonly onChange: (value: SourceCopyMemory) => void;
  readonly onReview: () => void;
  readonly onCheck: () => void;
}

/** Two explicit choices before the ordinary checked-copy review, without another gallery. */
export function SourceCopyOptions(props: OptionsProps): JSX.Element {
  const { options, locked } = props;
  return (
    <section aria-label="Copy choices" className="flex min-w-0 flex-col gap-4 px-3 sm:px-0">
      <h1 className="text-title-large sm:text-headline-medium">Copy a work template</h1>
      {options.template.isError ? (
        <QueryLoadFailure title="Saved template" query={options.template} />
      ) : options.template.data && !options.choices.length && !options.history.isFetching ? (
        <>
          <p className="text-body-medium">This saved template is no longer available to copy.</p>
          <Button wrapLabel asChild className="self-start">
            <Link href={workTemplateHref(props.memory.source.organizationId)}>
              View work templates
            </Link>
          </Button>
        </>
      ) : (
        <>
          <SourceVersionChoice {...props} />
          <SourceDestinationChoice {...props} />
          {locked ? (
            <>
              <p className="text-body-medium">
                Check whether this copy was saved before changing its choices.
              </p>
              <Button wrapLabel onClick={props.onCheck}>
                Check copy result
              </Button>
            </>
          ) : null}
          <Button
            wrapLabel
            className="self-start"
            disabled={!options.ready || locked}
            onClick={props.onReview}
          >
            Review copy
          </Button>
        </>
      )}
    </section>
  );
}
function SourceVersionChoice({ memory, options, locked, onChange }: OptionsProps): JSX.Element {
  const sourceKey = JSON.stringify(memory.source);
  return (
    <>
      <p className="text-title-medium break-words">
        {options.selectedChoice?.name ??
          options.template.data?.definition.name ??
          'Loading saved template…'}
      </p>
      {options.choices.length === 1 && options.selectedChoice ? (
        <dl className="text-body-medium">
          <dt className="text-body-small text-on-surface-variant">Copy from</dt>
          <dd>{options.selectedChoice.label}</dd>
        </dl>
      ) : (
        <Field label="Copy from">
          <Select
            value={sourceKey}
            disabled={locked || options.template.isPending || options.history.isFetching}
            onChange={(event) => {
              const selected = options.choices.find(
                (choice) => JSON.stringify(choice.source) === event.target.value,
              );
              if (selected) onChange({ ...memory, source: selected.source });
            }}
          >
            {!options.selected ? <option value={sourceKey}>Choose a saved source</option> : null}
            {options.choices.map((choice) => (
              <option key={JSON.stringify(choice.source)} value={JSON.stringify(choice.source)}>
                {choice.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <p className="text-body-small text-on-surface-variant">
        Copies saved content. Unsaved editor changes are not included.
      </p>
      {options.history.isError ? (
        <QueryLoadFailure title="Published versions" query={options.history} />
      ) : null}
    </>
  );
}
function SourceDestinationChoice({ memory, options, locked, onChange }: OptionsProps): JSX.Element {
  const { orgs } = useActiveOrg();
  const refused =
    memory.destinationOrgId &&
    !options.policy.isPending &&
    !options.permission.loading &&
    !options.allowed;
  return (
    <>
      <Field label="Destination workspace">
        <Select
          value={memory.destinationOrgId ?? ''}
          disabled={locked}
          onChange={(event) => {
            onChange({
              ...memory,
              destinationOrgId: orgs.find((org) => org.id === event.target.value)?.id ?? null,
            });
          }}
        >
          <option value="">Choose a workspace</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      </Field>
      {options.policy.isError ? (
        <QueryLoadFailure title="Template permissions" query={options.policy} />
      ) : refused ? (
        <InlineBanner tone="warning" title="Choose another workspace">
          You do not have permission to add templates here.
        </InlineBanner>
      ) : null}
    </>
  );
}
