'use client';
import type {
  WorkTemplateDisplay,
  WorkTemplateChangeField,
  WorkTemplateChangePreview as Preview,
  WorkTemplateFieldChange,
} from '@docket/work/work-template-reference';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
} from '@docket/ui/primitives';
import { type JSX } from 'react';
import { WorkTemplateChildChanges } from './work-template-child-changes';
import { workTypeDisplayName } from './work-type-name';
import { useTemplateChangeChoices } from './use-template-change-choices';
import { StaticMarkdown } from '@/components/editor/static-markdown';

interface PreviewProps {
  readonly selected: WorkTemplateDisplay | null;
  readonly preview: Preview | undefined;
  readonly loading: boolean;
  readonly previewFailed: boolean;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly stale?: boolean;
  readonly mode?: 'change' | 'update';
  readonly workTypeContext?: boolean;
  readonly familyName?: string;
  readonly onClose: () => void;
  readonly onConfirm: (fields: WorkTemplateChangeField[], children: string[]) => void;
  readonly onRetryPreview: () => void;
}

function reviewedVersion(
  preview: Preview | undefined,
  selected: WorkTemplateDisplay | null,
): number | undefined {
  return preview?.versionNumber ?? selected?.versionNumber;
}

/** Label an explicit change without presenting a definition revision as work identity. */
function changeActionLabel(update: boolean, workTypeContext: boolean | undefined): string {
  return `${update ? 'Update' : 'Change'} ${workTypeContext ? 'work type' : 'template'}`;
}

function reviewedIdentityLabel(props: PreviewProps): string | undefined {
  if (!props.selected) return undefined;
  return props.workTypeContext
    ? workTypeDisplayName(props.selected, props.familyName ?? 'Work')
    : props.selected.name;
}

/** Review default-off starting-field changes while authored dates and children remain unchanged. */
export function WorkTemplateChangePreview(props: PreviewProps): JSX.Element {
  const { selected, pending, preview, loading, previewFailed, onClose, onConfirm } = props;
  const choices = useTemplateChangeChoices(preview);
  const ready = Boolean(preview && !loading && !previewFailed);
  const update = (props.mode ?? preview?.mode) === 'update';
  return (
    <Dialog
      open={selected !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{changeActionLabel(update, props.workTypeContext)}</DialogTitle>
          <DialogDescription>
            Use {reviewedIdentityLabel(props)}
            {props.workTypeContext ? '' : ` · Version ${reviewedVersion(preview, selected)}`}.{' '}
            {reviewDescription(preview, choices.fields)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {props.failed ? (
            <FieldError>{failureCopy(preview, props.stale, props.workTypeContext)}</FieldError>
          ) : null}
          <StartingChanges
            preview={preview}
            ready={ready}
            loading={loading}
            failed={previewFailed}
            fields={choices.fields}
            pending={pending}
            onToggle={choices.toggleField}
            workTypeContext={props.workTypeContext}
          />
          {ready && preview ? (
            <WorkTemplateChildChanges
              changes={preview.childChanges}
              warnings={preview.warnings}
              choices={choices.children}
              pending={pending}
              onToggle={choices.toggleChild}
            />
          ) : null}
        </DialogBody>
        <PreviewActions
          {...props}
          ready={ready}
          onAccept={() => {
            onConfirm(choices.acceptedFields(), choices.acceptedChildren());
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function reviewDescription(
  preview: Preview | undefined,
  fields: readonly WorkTemplateChangeField[],
): string {
  if (preview?.mode === 'update')
    return 'Choose which changes to use. Nothing changes until you confirm.';
  if (preview && preview.childChanges.length > 0)
    return 'Existing work stays. Choose any new work, dates or links to include.';
  return fields.length === 0
    ? 'Your description, dates and child work stay unchanged.'
    : 'Only the starting values you select will change. Dates and child work stay unchanged.';
}

function StartingChanges({
  preview,
  ready,
  loading,
  failed,
  fields,
  pending,
  onToggle,
  workTypeContext,
}: {
  readonly preview: Preview | undefined;
  readonly ready: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly fields: readonly WorkTemplateChangeField[];
  readonly pending: boolean;
  readonly onToggle: (field: WorkTemplateChangeField) => void;
  readonly workTypeContext?: boolean | undefined;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {loading ? <p role="status">Loading starting changes…</p> : null}
      {failed ? <FieldError>Could not load the definition preview.</FieldError> : null}
      {ready && preview
        ? preview.changes.map((change) => (
            <StartingFieldChange
              key={change.field}
              change={change}
              checked={fields.includes(change.field)}
              disabled={pending}
              onToggle={() => {
                onToggle(change.field);
              }}
            />
          ))
        : null}
      {ready && preview?.mode !== 'update' && preview?.changes.length === 0 ? (
        <p>
          Your work will use this {workTypeContext ? 'type' : 'template'}. Its details stay the
          same.
        </p>
      ) : null}
    </div>
  );
}

function failureCopy(
  preview: Preview | undefined,
  stale: boolean | undefined,
  workTypeContext: boolean | undefined,
): string {
  const noun = workTypeContext ? 'work type' : 'template';
  if (stale) return 'Work changed since this review. Refresh the preview; your choices are kept.';
  return preview?.mode === 'update'
    ? `Could not update the ${noun}. Review the current changes.`
    : `Could not change the ${noun}. Try again.`;
}

function PreviewActions({
  failed,
  previewFailed,
  pending,
  loading,
  onRetryPreview,
  onClose,
  selected,
  ready,
  onAccept,
  preview,
  mode,
  workTypeContext,
}: PreviewProps & {
  readonly ready: boolean;
  readonly onAccept: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
        Cancel
      </Button>
      {previewFailed || failed ? (
        <Button type="button" disabled={pending || loading} onClick={onRetryPreview}>
          Retry preview
        </Button>
      ) : (
        <Button type="button" disabled={!selected || pending || !ready} onClick={onAccept}>
          {pending
            ? 'Applying…'
            : (mode ?? preview?.mode) === 'update'
              ? changeActionLabel(true, workTypeContext)
              : changeActionLabel(false, workTypeContext)}
        </Button>
      )}
    </DialogFooter>
  );
}

function StartingFieldChange({
  change,
  checked,
  disabled,
  onToggle,
}: {
  readonly change: WorkTemplateFieldChange;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="text-label-large flex min-h-10 cursor-pointer items-center gap-2">
        <Checkbox
          aria-label={change.label}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
        />
        {change.label}
      </label>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 break-words">
          <p className="text-label-small text-on-surface-variant">Current</p>
          <StartingValue value={change.before} markdown={change.field === 'description'} />
        </div>
        <div className="min-w-0 break-words">
          <p className="text-label-small text-on-surface-variant">From definition</p>
          <StartingValue value={change.after} markdown={change.field === 'description'} />
        </div>
      </div>
    </div>
  );
}

function StartingValue({
  value,
  markdown,
}: {
  readonly value: WorkTemplateFieldChange['before'];
  readonly markdown: boolean;
}): JSX.Element {
  if (markdown && typeof value === 'string' && value)
    return (
      <StaticMarkdown
        value={value}
        className="[&_h1]:text-title-small [&_h2]:text-title-small [&_h3]:text-label-large [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2"
      />
    );
  const text = Array.isArray(value) ? value.join(', ') : value?.replaceAll('_', ' ');
  return <p className="text-body-medium">{text?.length ? text : 'None'}</p>;
}
