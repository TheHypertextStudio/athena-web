'use client';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

interface DisconnectConfirmDialogProps {
  providerName: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** DisconnectConfirmDialog renders the settings UI control for its parent workflow. */
export function DisconnectConfirmDialog({
  providerName,
  onConfirm,
  onCancel,
}: DisconnectConfirmDialogProps): JSX.Element {
  return (
    <Dialog
      open={providerName !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>Disconnect {providerName}?</DialogTitle>
          <DialogDescription>
            Linked tasks imported from it will remain, but won&apos;t receive further updates.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose className="focus-visible:ring-ring text-on-surface-variant hover:bg-surface-container-high text-body-medium rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1">
            Cancel
          </DialogClose>
          <button
            type="button"
            className="focus-visible:ring-ring bg-destructive text-destructive-foreground hover:bg-destructive/90 text-body-medium rounded-md px-3 py-1.5 font-medium shadow-sm transition-colors outline-none focus-visible:ring-1"
            onClick={onConfirm}
          >
            Disconnect
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
