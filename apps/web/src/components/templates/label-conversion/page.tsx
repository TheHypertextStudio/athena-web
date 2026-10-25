'use client';
import type { JSX, ReactNode } from 'react';
import { WorkTemplateOut, WorkTemplateVersionOut } from '@docket/work/work-template-contract';
import { Button } from '@docket/ui/primitives';
import { QueryLoadFailure } from '@/components/feedback';
import { useSession } from '@/lib/auth-client';
import { useApiQuery } from '@/lib/query';
import { workTemplateDef, workTemplateVersionsDef } from '../work-template-queries';
import { useConversionCommand } from './use-command';
import { conversionChoices } from './selection';
import { ConversionLabelPicker } from './label-picker';
import { ConversionWorkPicker } from './work-picker';
import { ConversionReview } from './review';
import { useConversionSelection } from './use-selection';

import { ConversionFrame } from './frame';
import { ConversionActions, ConversionResultActions } from './actions';
import type { ConversionPageProps as Props, ConversionCommand as Command } from './types';

/** Isolate all private selection and asynchronous state to the actual account and session. */
export function LabelConversionPage(props: Props): JSX.Element {
  const session = useSession();
  return (
    <ConversionWorkspace
      key={JSON.stringify([session.data?.user.id, session.data?.session.id, props])}
      {...props}
    />
  );
}
function ConversionWorkspace(props: Props): JSX.Element {
  const command = useConversionCommand(props.orgId, props.templateId, props.versionId);
  if (command.ready && !command.receipt)
    return <ConversionSelection {...props} command={command} />;
  const footer = command.receipt ? (
    <ConversionResultActions command={command} />
  ) : command.phase === 'unknown' ? (
    <Button
      className="h-auto min-h-10 max-w-full whitespace-normal"
      disabled={command.pending}
      onClick={() => void command.check()}
    >
      Check again
    </Button>
  ) : undefined;
  return (
    <ConversionFrame {...props} command={command} footer={footer}>
      {command.receipt ? (
        <ConversionResult command={command} />
      ) : command.phase === 'unknown' ? (
        <div className="space-y-4">
          <h1 className="text-headline-small">Check your previous change</h1>
          <p className="text-body-medium">
            Your selection is saved in this tab. We need to check the previous outcome before
            starting another batch.
          </p>
        </div>
      ) : (
        <p role="status">Checking for a saved change…</p>
      )}
    </ConversionFrame>
  );
}
function usePublishedSource(props: Props) {
  const templateQuery = useApiQuery(workTemplateDef(props.orgId, props.templateId));
  const versionsQuery = useApiQuery(workTemplateVersionsDef(props.orgId, props.templateId));
  const parsedTemplate = WorkTemplateOut.safeParse(templateQuery.data);
  const parsedVersion = WorkTemplateVersionOut.safeParse(
    versionsQuery.data?.items.find((item) => item.id === props.versionId),
  );
  return {
    templateQuery,
    versionsQuery,
    template: parsedTemplate.success ? parsedTemplate.data : null,
    version: parsedVersion.success ? parsedVersion.data : null,
  };
}
function ConversionSelection(props: Props & { readonly command: Command }): JSX.Element {
  const source = usePublishedSource(props);
  const selection = useConversionSelection(props, props.command);
  const { label, selected, setSelected } = selection;
  const content = sourceFailure(source, selection.checking);
  if (content) return <ConversionFrame {...props}>{content}</ConversionFrame>;
  if (!source.template || !source.version)
    return (
      <ConversionFrame {...props}>
        <p>This published template is unavailable.</p>
      </ConversionFrame>
    );
  const choices = canReviewSelection(label, selected)
    ? conversionChoices(
        {
          ...label,
          kind: source.template.targetType,
          templateId: props.templateId,
          versionId: props.versionId,
        },
        selected,
      )
    : null;
  return (
    <ConversionFrame
      {...props}
      footer={
        <ConversionActions command={props.command} choices={choices} count={selected.length} />
      }
    >
      {selection.unavailable ? (
        <p role="status" className="text-body-medium text-on-surface-variant">
          {props.command.review
            ? 'The original label is unavailable. Go back to choose another label.'
            : 'The original label is unavailable. Choose a label to continue.'}
        </p>
      ) : null}
      <SelectionSteps
        {...props}
        template={source.template}
        version={source.version}
        label={label}
        selected={selected}
        setSelected={setSelected}
        choose={selection.choose}
      />
    </ConversionFrame>
  );
}
function sourceFailure(
  source: ReturnType<typeof usePublishedSource>,
  checkingLabel: boolean,
): ReactNode {
  if (source.templateQuery.isError)
    return <QueryLoadFailure title="Template" query={source.templateQuery} />;
  if (source.versionsQuery.isError)
    return <QueryLoadFailure title="Published template" query={source.versionsQuery} />;
  if (source.templateQuery.isPending || source.versionsQuery.isPending)
    return <p role="status">Loading the published template…</p>;
  if (checkingLabel) return <p role="status">Checking the original label…</p>;
  if (
    !source.template ||
    !source.version ||
    !source.template.canEdit ||
    source.template.status === 'archived'
  )
    return (
      <div className="space-y-2">
        <h1 className="text-headline-small">This template isn’t available to apply</h1>
        <p className="text-body-medium text-on-surface-variant">
          Return to the template to choose an available published version.
        </p>
      </div>
    );
  return null;
}

interface StepsProps extends Props {
  readonly command: Command;
  readonly template: WorkTemplateOut;
  readonly version: WorkTemplateVersionOut;
  readonly label: { readonly groupId: string; readonly labelId: string };
  readonly selected: readonly string[];
  readonly setSelected: (ids: readonly string[]) => void;
  readonly choose: (groupId: string, labelId: string) => void;
}
function SelectionSteps(props: StepsProps): JSX.Element {
  const { command, template, version } = props;
  if (command.review) return <ConversionReview review={command.review} />;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="space-y-2">
        <p className="text-label-large text-primary">1 of 2 · Choose work</p>
        <h1 className="text-headline-small break-words">
          Apply {version.definition.name} to existing work
        </h1>
        <p className="text-body-medium text-on-surface-variant">
          Choose the label you use for this kind of work, then select the items to update.
        </p>
        <p className="text-body-small text-on-surface-variant">
          Published version {version.number}
        </p>
      </header>
      <ConversionLabelPicker
        orgId={props.orgId}
        {...props.label}
        disabled={command.pending}
        onChoose={props.choose}
      />
      {props.label.labelId ? (
        <ConversionWorkPicker
          key={props.label.labelId}
          orgId={props.orgId}
          kind={template.targetType}
          labelId={props.label.labelId}
          selected={props.selected}
          disabled={command.pending}
          onChange={props.setSelected}
        />
      ) : null}
    </div>
  );
}
function ConversionResult({ command }: { readonly command: Command }): JSX.Element {
  const receipt = command.receipt;
  if (!receipt) return <></>;
  const undone = receipt.state === 'undone';
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-label-large text-primary">{undone ? 'Undone' : 'Applied'}</p>
        <h1 className="text-headline-small">
          {undone
            ? 'Your previous labels and template choices are restored'
            : `Template applied to ${receipt.itemCount} ${receipt.itemCount === 1 ? 'item' : 'items'}`}
        </h1>
        <p className="text-body-medium text-on-surface-variant">
          {undone
            ? 'Existing descriptions, dates and contained work are preserved.'
            : 'The selected labels were removed from those items. Descriptions, dates and contained work are preserved.'}
        </p>
      </header>
      {!undone ? (
        <Button
          variant="ghost"
          className="h-auto min-h-10 max-w-full whitespace-normal"
          disabled={command.pending}
          onClick={command.reset}
        >
          Choose more work
        </Button>
      ) : null}
    </div>
  );
}

function canReviewSelection(
  label: { groupId: string; labelId: string },
  selected: readonly string[],
): boolean {
  return selected.length > 0 && Boolean(label.groupId) && Boolean(label.labelId);
}
