'use client';

/**
 * `settings` — the disconnect confirmation, as an adapter over the shared destructive dialog.
 *
 * @remarks
 * This used to be a second, independent copy of the dialog: its own `Dialog` /
 * `DialogContent showClose={false}` / ghost-Cancel / destructive-confirm markup, differing from
 * {@link ConfirmDestructiveDialog} only in that it had **no `pending` and no `error`**. So an
 * in-flight disconnect was interruptible and a failed one said nothing at all — the dialog simply
 * closed and the connection stayed.
 *
 * What is worth keeping is the call shape, not the markup. Three callers drive this from a
 * `target` that is `null` when nothing is being confirmed, so `providerName` doubles as the open
 * flag and there is no separate boolean to keep in sync. That ergonomics survives; the rendering
 * is now the one shared implementation.
 */
import type { JSX } from 'react';

import { ConfirmDestructiveDialog } from '@docket/ui/components';

/** Props for {@link DisconnectConfirmDialog}. */
interface DisconnectConfirmDialogProps {
  /** The provider being disconnected, or `null` when the dialog is closed. */
  providerName: string | null;
  /** Run the disconnect. */
  onConfirm: () => void;
  /** Dismiss without disconnecting. */
  onCancel: () => void;
  /** Whether the disconnect is in flight; blocks dismissal so it cannot be interrupted. */
  pending?: boolean;
  /** Application-owned failure copy, rendered inside the panel so it is not lost behind the modal. */
  error?: string | null;
}

/** Confirm disconnecting a connected tool. */
export function DisconnectConfirmDialog({
  providerName,
  onConfirm,
  onCancel,
  pending = false,
  error = null,
}: DisconnectConfirmDialogProps): JSX.Element {
  return (
    <ConfirmDestructiveDialog
      open={providerName !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`Disconnect ${providerName ?? ''}?`}
      description="Tasks already imported stay in Docket and stop updating."
      confirmLabel="Disconnect"
      pending={pending}
      error={error}
      onConfirm={onConfirm}
    />
  );
}
