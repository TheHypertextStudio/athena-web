'use client';
import type {
  WorkTemplateChoice,
  WorkTemplateChangeField,
  WorkTemplateChangePreview as Preview,
  WorkTemplateFieldChange,
} from '@docket/work/work-template-reference';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
} from '@docket/ui/primitives';
import { useState, type JSX } from 'react';
import { StaticMarkdown } from '@/components/editor/static-markdown';

interface PreviewProps {
  readonly selected: WorkTemplateChoice | null;
  readonly preview: Preview | undefined;
  readonly loading: boolean;
  readonly previewFailed: boolean;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (fields: WorkTemplateChangeField[]) => void;
  readonly onRetryPreview: () => void;
}

/** Review default-off starting-field changes while authored dates and children remain unchanged. */
export function WorkTemplateChangePreview(props: PreviewProps): JSX.Element {
  const [fields, setFields] = useState<WorkTemplateChangeField[]>([]);
  const { selected, pending, preview, loading, previewFailed, onClose, onConfirm } = props;
  const ready = Boolean(preview && !loading && !previewFailed);
  const toggle = (field: WorkTemplateChangeField): void => {
    setFields((current) =>
      current.includes(field) ? current.filter((value) => value !== field) : [...current, field],
    );
  };
  return (
    <Dialog
      open={selected !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change template</DialogTitle>
          <DialogDescription>
            Use {selected?.name} · Version {selected?.versionNumber}.{' '}
            {fields.length === 0
              ? 'Your description, dates and child work stay unchanged.'
              : 'Only the starting values you select will change. Dates and child work stay unchanged.'}
          </DialogDescription>
        </DialogHeader>
        <StartingChanges
          preview={preview}
          ready={ready}
          loading={loading}
          failed={previewFailed}
          fields={fields}
          pending={pending}
          onToggle={toggle}
        />
        <PreviewActions
          {...props}
          ready={ready}
          onAccept={() => {
            onConfirm(fields);
          }}
        />
      </DialogContent>
    </Dialog>
  );
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
      {ready && preview?.changes.length === 0 ? (
        <p>No starting values differ from this work.</p>
      ) : null}
    </div>
  );
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
}: PreviewProps & {
  readonly ready: boolean;
  readonly onAccept: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      {failed ? <FieldError>Could not change the template. Try again.</FieldError> : null}
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
        {pending ? 'Changing…' : 'Change template'}
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
