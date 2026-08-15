'use client';

/**
 * Delete a status, choosing where its work goes.
 *
 * @remarks
 * Deleting a status is never only a deletion: whatever is sitting in it has to land somewhere, and
 * the person deleting is the only one in a position to say where. So the replacement is a required
 * choice rather than a rule applied behind their back, and Delete stays unavailable until they
 * make it.
 *
 * The default offered is the nearest status in the same category, which is almost always the
 * intent — deleting a second "In Progress" column usually means folding it into the first.
 */
import { StatusIcon } from '@docket/ui/components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

import type { StatusLike } from './status-registry';

/** Props for {@link DeleteStatusDialog}. */
export interface DeleteStatusDialogProps {
  /** The status being deleted. */
  status: StatusLike;
  /** Every other status in the same set, as candidates for the work to move to. */
  candidates: readonly StatusLike[];
  /** Whether a delete is in flight. */
  pending: boolean;
  /** The failure from the last attempt, if any. */
  error: unknown;
  /** Delete, moving the work to `remapTo`. */
  onConfirm: (remapTo: string) => void;
  /** Close without deleting. */
  onClose: () => void;
}

/**
 * Render the delete-with-replacement dialog.
 *
 * @param props - The status, the candidates, and the confirm handler.
 * @returns the dialog element.
 */
export function DeleteStatusDialog({
  status,
  candidates,
  pending,
  error,
  onConfirm,
  onClose,
}: DeleteStatusDialogProps): JSX.Element {
  const suggested =
    candidates.find((candidate) => candidate.category === status.category) ?? candidates[0];
  const [remapTo, setRemapTo] = useState<string>(suggested?.id ?? '');

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {status.name}</DialogTitle>
          <DialogDescription>
            Anything currently in this status moves to the one you pick. Nothing is deleted except
            the status itself.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-on-surface text-label-large mb-2">Move that work to</legend>
          {candidates.map((candidate) => (
            <label
              key={candidate.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                candidate.id === remapTo
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'hover:bg-surface-container',
              )}
            >
              <input
                type="radio"
                name="remapTo"
                value={candidate.id}
                checked={candidate.id === remapTo}
                onChange={() => {
                  setRemapTo(candidate.id);
                }}
                className="sr-only"
              />
              <StatusIcon type={candidate.category} label={candidate.name} />
              <span className="text-label-large truncate">{candidate.name}</span>
            </label>
          ))}
        </fieldset>

        {error === null || error === undefined ? null : (
          <p role="alert" className="text-error text-body-small">
            {userErrorMessage(error, 'That status could not be deleted.')}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remapTo === '' || pending}
            onClick={() => {
              onConfirm(remapTo);
            }}
          >
            Delete status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
