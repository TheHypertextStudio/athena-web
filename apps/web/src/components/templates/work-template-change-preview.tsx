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

/** Review default-off starting-field changes while authored dates and children remain unchanged. */
export function WorkTemplateChangePreview(props: PreviewProps): JSX.Element {
  const { selected, pending, preview, loading, previewFailed, onClose, onConfirm } = props;
  const choices = useTemplateChangeChoices(preview);
  const ready = Boolean(preview && !loading && !previewFailed && !props.failed);
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
          <DialogTitle>{update ? 'Update template' : 'Change template'}</DialogTitle>
          <DialogDescription>
            Use {selected?.name} · Version {reviewedVersion(preview, selected)}.{' '}
            {reviewDescription(preview, choices.fields)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <StartingChanges
            preview={preview}
            ready={ready}
            loading={loading}
            failed={previewFailed}
            fields={choices.fields}
            pending={pending}
            onToggle={choices.toggleField}
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
    return 'Your outline stays unchanged. Choose each work change to adopt.';
  if (preview && preview.childChanges.length > 0)
    return 'Existing child work stays. Review new work, dates and dependencies individually.';
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
}: {
  readonly preview: Preview | undefined;
  readonly ready: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly fields: readonly WorkTemplateChangeField[];
  readonly pending: boolean;
  readonly onToggle: (field: WorkTemplateChangeField) => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {loading ? <p role="status">Loading starting changes…</p> : null}
      {failed ? <FieldError>Could not load the template preview.</FieldError> : null}
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
        <p>No starting values differ from this work.</p>
      ) : null}
    </div>
  );
}

function failureCopy(preview: Preview | undefined, stale: boolean | undefined): string {
  if (stale) return 'Work changed since this review. Refresh the preview; your choices are kept.';
  return preview?.mode === 'update'
    ? 'Could not update the template. Review the current changes.'
    : 'Could not change the template. Try again.';
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
  stale,
}: PreviewProps & {
  readonly ready: boolean;
  readonly onAccept: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      {failed ? <FieldError>{failureCopy(preview, stale)}</FieldError> : null}
      {previewFailed || failed ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending || loading}
          onClick={onRetryPreview}
        >
          Retry preview
        </Button>
      ) : null}
      <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
        Cancel
      </Button>
      <Button type="button" disabled={!selected || pending || !ready} onClick={onAccept}>
        {pending ? 'Applying…' : preview?.mode === 'update' ? 'Update template' : 'Change template'}
      </Button>
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
          <p className="text-label-small text-on-surface-variant">From template</p>
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
  if (markdown && typeof value === 'string' && value) return <StaticMarkdown value={value} />;
  const text = Array.isArray(value) ? value.join(', ') : value?.replaceAll('_', ' ');
  return <p className="text-body-medium">{text?.length ? text : 'None'}</p>;
}
