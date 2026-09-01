'use client';

import { ConfirmDestructiveDialog } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

/** Props for {@link ConfirmButton}. */
export interface ConfirmButtonProps {
  /** The trigger's label. */
  readonly label: string;
  /** Whether the trigger is unavailable. */
  readonly disabled: boolean;
  /** The dialog's heading, phrased as the question being asked. */
  readonly title: string;
  /** What the action will do, and what it will not undo. */
  readonly description: string;
  /** The confirming button's label — the action itself, never "OK". */
  readonly confirmLabel: string;
  /** Perform the action. */
  readonly onConfirm: () => void;
}

/**
 * A destructive action that asks first.
 *
 * @remarks
 * Wraps the shared {@link ConfirmDestructiveDialog} with the trigger and open state, so a screen
 * declares one control rather than a button, a boolean, and a dialog wired together by hand.
 *
 * Every irreversible operator action in this console goes through this. Revoking complimentary Pro
 * or a live partner discount changes what an organization pays, takes effect at the provider
 * immediately, and has no undo — and until now both fired on a single click of a button that
 * looked exactly like "Preview".
 *
 * The dialog closes as soon as the action starts rather than waiting for it to land: the calling
 * screen already renders the in-flight and failure states inline, so holding a modal open over them
 * would hide the very feedback the operator needs. That is also why this takes no `pending` flag —
 * the dialog is never open while the action is running, so one could only ever read `false`.
 *
 * @param props - See {@link ConfirmButtonProps}.
 * @returns the trigger and its confirmation dialog.
 */
export function ConfirmButton({
  label,
  disabled,
  title,
  description,
  confirmLabel,
  onConfirm,
}: ConfirmButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ConfirmDestructiveDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}
