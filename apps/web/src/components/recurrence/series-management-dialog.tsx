'use client';

import { Dialog, DialogContent, DialogTitle } from '@docket/ui/primitives';
import { type JSX, useCallback, useRef, useState } from 'react';
import { SeriesManagementContent } from './series-management-content';

/** Controlled overlay for the recurring series behind ordinary generated work. */
export interface SeriesManagementDialogProps {
  readonly orgId: string;
  readonly seriesId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Keep dismissal, focus restoration, and unsaved schedule protection on the shared dialog. */
export function SeriesManagementDialog({
  orgId,
  seriesId,
  open,
  onOpenChange,
}: SeriesManagementDialogProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const draftState = useRef({ dirty: false, busy: false });
  const editFocus = useRef<HTMLElement | null>(null);
  const onDraftStateChange = useCallback((dirty: boolean, busy: boolean): void => {
    draftState.current = { dirty, busy };
  }, []);
  const requestClose = (): void => {
    if (draftState.current.busy) return;
    if (draftState.current.dirty) {
      editFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirming(true);
    } else onOpenChange(false);
  };
  const keepEditing = (): void => {
    setConfirming(false);
    requestAnimationFrame(() => {
      editFocus.current?.focus();
    });
  };
  const discard = (): void => {
    setConfirming(false);
    draftState.current = { dirty: false, busy: false };
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        showClose={false}
        containerQuery
        presentation={{ kind: 'responsive-fullscreen', size: 'workspace', height: 'viewport' }}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (confirming) {
            event.preventDefault();
            keepEditing();
          }
        }}
      >
        <DialogTitle className="sr-only">Manage repeating work</DialogTitle>
        {open ? (
          <SeriesManagementContent
            key={seriesId}
            orgId={orgId}
            seriesId={seriesId}
            overlay
            onClose={requestClose}
            onDraftStateChange={onDraftStateChange}
            confirmingDiscard={confirming}
            onKeepEditing={keepEditing}
            onDiscard={discard}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
