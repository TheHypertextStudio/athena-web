'use client';
import type { WorkTemplateCapturePreview } from '@docket/work/work-template-contract';
import {
  Button,
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Input,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { WorkTemplateBlueprintSummary } from './work-template-blueprint-summary';
import { WorkTemplateCaptureWarnings } from './work-template-capture-warnings';

/** Presentation state for one authorized independent capture; authored name belongs to its controller. */
export interface WorkTemplateCaptureDialogProps {
  readonly open: boolean;
  readonly name: string;
  readonly preview: WorkTemplateCapturePreview | undefined;
  readonly ready: boolean;
  readonly loading: boolean;
  readonly previewFailed: boolean;
  readonly pending: boolean;
  readonly failure: 'stale' | 'failed' | null;
  readonly onNameChange: (name: string) => void;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  readonly onSave: () => void;
}

/** Review the complete private snapshot and explicit warnings before saving an unpublished draft. */
export function WorkTemplateCaptureDialog(props: WorkTemplateCaptureDialogProps): JSX.Element {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Only you can read this draft. Review its outline, then continue in the template editor.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Template name">
            <Input
              value={props.name}
              disabled={props.pending}
              onChange={(event) => {
                props.onNameChange(event.target.value);
              }}
            />
          </Field>
          <CaptureOutline {...props} />
        </DialogBody>
        <CaptureFooter {...props} />
      </DialogContent>
    </Dialog>
  );
}
function CaptureOutline({
  preview,
  ready,
  loading,
  previewFailed,
}: WorkTemplateCaptureDialogProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {loading ? <p role="status">Reviewing current work…</p> : null}
      {previewFailed ? (
        <FieldError>
          Could not capture this complete outline. Check your access and refresh.
        </FieldError>
      ) : null}
      {ready && preview ? (
        <>
          <WorkTemplateCaptureWarnings warnings={preview.warnings} />
          <WorkTemplateBlueprintSummary blueprint={preview.definition.blueprint} />
          <div className="min-w-0" aria-label="Captured outline">
            {preview.definition.payload.description ? (
              <StaticMarkdown value={preview.definition.payload.description} />
            ) : null}
            <ol className="list-decimal space-y-1 pl-5">
              {preview.definition.blueprint.steps.map((step) => (
                <li key={step.key}>
                  {step.kind === 'task' ? step.fields.title : step.fields.name}
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : null}
    </div>
  );
}
function CaptureFooter(props: WorkTemplateCaptureDialogProps): JSX.Element {
  return (
    <DialogFooter>
      {props.failure ? (
        <FieldError>
          {props.failure === 'stale'
            ? 'Source work changed. Refresh the capture and review it again. Your name is still here.'
            : 'Could not save the private draft. Your name is still here; try again.'}
        </FieldError>
      ) : null}
      {props.failure || props.previewFailed ? (
        <Button
          type="button"
          variant="secondary"
          disabled={props.pending || props.loading}
          onClick={props.onRefresh}
        >
          Refresh capture
        </Button>
      ) : null}
      <Button type="button" variant="ghost" disabled={props.pending} onClick={props.onClose}>
        Cancel
      </Button>
      <Button
        type="button"
        disabled={!props.ready || props.pending || !props.name.trim()}
        onClick={props.onSave}
      >
        {props.pending ? 'Saving…' : 'Save private draft'}
      </Button>
    </DialogFooter>
  );
}
