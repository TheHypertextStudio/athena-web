'use client';

/**
 * Create or edit one label.
 *
 * @remarks
 * The interesting behaviour here is what happens when a rename collides. The obvious answer is a
 * "that name is taken" error, but that leaves the user exactly where they started — usually
 * staring at two labels that mean the same thing because an import created one of them. So a
 * collision offers a **merge** instead: every task, project, initiative, program, and library
 * resource carrying this label moves to the other one, and this label dissolves.
 *
 * Merging is destructive and irreversible, so it is a second, explicit confirmation rather than
 * something the Save button quietly does.
 */
import type { LabelColorKey, LabelCreate, LabelOut } from '@docket/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@docket/ui/primitives';
import { LabelChip } from '@docket/ui/components';
import { type JSX, useEffect, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

import { LabelColorPicker } from './label-color-picker';
import { findNameCollision, useCreateLabel, useMergeLabel, useUpdateLabel } from './queries';

/** Props for {@link LabelEditorDialog}. */
export interface LabelEditorDialogProps {
  /** The active organization. */
  orgId: string;
  /** The label being edited, or null to create a new one. */
  label: LabelOut | null;
  /** Every label in the org, for collision detection. */
  labels: readonly LabelOut[];
  /** Group to create into, when the dialog was opened from a group's "Add label". */
  groupId?: string | null;
  /** Whether the dialog is open. */
  open: boolean;
  /** Report an open-state change. */
  onOpenChange: (open: boolean) => void;
}

/**
 * The create/edit label dialog.
 *
 * @param props - The {@link LabelEditorDialogProps}.
 * @returns The rendered dialog.
 */
export function LabelEditorDialog({
  orgId,
  label,
  labels,
  groupId = null,
  open,
  onOpenChange,
}: LabelEditorDialogProps): JSX.Element {
  const create = useCreateLabel(orgId);
  const update = useUpdateLabel(orgId);
  const merge = useMergeLabel(orgId);

  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColorKey>('blue');
  const [error, setError] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<LabelOut | null>(null);

  // Reset when the dialog opens onto a different label, so a previous edit never bleeds into
  // the next one.
  useEffect(() => {
    if (!open) return;
    setName(label?.name ?? '');
    setColor((label?.color as LabelColorKey | undefined) ?? 'blue');
    setError(null);
    setMergeTarget(null);
  }, [open, label]);

  const trimmed = name.trim();
  const pending = create.isPending || update.isPending || merge.isPending;

  function close(): void {
    onOpenChange(false);
  }

  function submit(): void {
    setError(null);
    if (trimmed.length === 0) {
      setError('Give the label a name.');
      return;
    }

    const collision = findNameCollision(labels, trimmed, label?.id);
    if (collision) {
      // Editing an existing label into an existing name is a merge offer; creating a duplicate
      // outright is just a mistake to point out.
      if (label) {
        setMergeTarget(collision);
        return;
      }
      setError(`“${collision.name}” already exists.`);
      return;
    }

    if (label) {
      update.mutate(
        { id: label.id, name: trimmed, color },
        {
          onSuccess: close,
          onError: (caught) => {
            setError(userErrorMessage(caught, 'Could not save the label.'));
          },
        },
      );
      return;
    }

    create.mutate(
      { name: trimmed, color, ...(groupId ? { groupId: groupId as LabelCreate['groupId'] } : {}) },
      {
        onSuccess: close,
        onError: (caught) => {
          setError(userErrorMessage(caught, 'Could not create the label.'));
        },
      },
    );
  }

  function confirmMerge(): void {
    if (!label || !mergeTarget) return;
    setError(null);
    merge.mutate(
      { id: label.id, intoId: mergeTarget.id },
      {
        onSuccess: close,
        onError: (caught) => {
          setError(userErrorMessage(caught, 'Could not merge the labels.'));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {mergeTarget ? (
          <>
            <DialogHeader>
              <DialogTitle>Merge into “{mergeTarget.name}”?</DialogTitle>
              <DialogDescription>
                {label?.usageCount
                  ? `${label.usageCount} ${label.usageCount === 1 ? 'item' : 'items'} will move to “${mergeTarget.name}”, and “${label.name}” will be deleted. This cannot be undone.`
                  : `“${label?.name}” will be deleted. This cannot be undone.`}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <LabelChip name={label?.name ?? ''} color={label?.color} />
              <span aria-hidden="true" className="text-on-surface-variant">
                →
              </span>
              <LabelChip name={mergeTarget.name} color={mergeTarget.color} />
            </div>
            {error ? (
              <p role="alert" className="text-error text-body-small">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setMergeTarget(null);
                }}
                disabled={pending}
              >
                Back
              </Button>
              <Button type="button" onClick={confirmMerge} disabled={pending}>
                {merge.isPending ? 'Merging…' : 'Merge labels'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{label ? 'Edit label' : 'New label'}</DialogTitle>
              <DialogDescription>
                {label
                  ? 'Renaming changes it everywhere it is used.'
                  : 'Labels are available across the whole workspace.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <Field label="Name">
                <Input
                  value={name}
                  autoFocus
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="e.g. needs-review"
                />
              </Field>

              <Field label="Color">
                <LabelColorPicker value={color} onChange={setColor} />
              </Field>

              <div className="flex items-center gap-2">
                <span className="text-on-surface-variant text-label-medium">Preview</span>
                <LabelChip name={trimmed || 'label'} color={color} />
              </div>
            </div>

            {error ? (
              <p role="alert" className="text-error text-body-small">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" onClick={submit} disabled={pending}>
                {pending ? 'Saving…' : label ? 'Save' : 'Create label'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
