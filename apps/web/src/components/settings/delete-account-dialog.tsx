'use client';

/**
 * `settings` — the "delete my account" confirmation dialog.
 *
 * @remarks
 * The final, deliberate gate before scheduling account deletion. Two safeguards compose: a
 * **type-your-email-to-confirm** field (the destructive button stays disabled until it matches)
 * and a **passkey re-verification** ({@link useReauth}) triggered the moment the user confirms,
 * so a hijacked or unattended session cannot schedule deletion. On success the account enters the
 * recoverable 14-day grace window (`POST /v1/me/account/deletion`); the user stays signed in and
 * the Danger zone shows the pending banner. Failures surface inline (no toast system exists).
 */
import { AccountStatusOut } from '@docket/types';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

import { useReauth } from './use-reauth';

/** Props for {@link DeleteAccountDialog}. */
export interface DeleteAccountDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open/close handler (also fired on overlay/escape dismiss). */
  onOpenChange: (open: boolean) => void;
  /** The signed-in user's email — typed verbatim to confirm. */
  email: string;
}

/** The delete-account confirmation dialog (email gate + passkey step-up). */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
}: DeleteAccountDialogProps): JSX.Element {
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reauth = useReauth();

  const scheduleDeletion = useApiMutation({
    mutationFn: () =>
      unwrap(() => api.v1.me.account.$delete(), 'Could not schedule your account for deletion.'),
    invalidateKeys: [queryKeys.account()],
  });

  const confirmed = typed.trim().toLowerCase() === email.trim().toLowerCase();

  function close(next: boolean): void {
    if (busy) return; // don't dismiss mid-request
    if (!next) {
      setTyped('');
      setError(null);
    }
    onOpenChange(next);
  }

  async function onConfirm(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      // Step-up: re-verify the passkey so the server's fresh-session gate passes.
      await reauth();
      const status = AccountStatusOut.parse(await scheduleDeletion.mutateAsync(undefined));
      if (status.deletionState !== 'pending_deletion') {
        throw new Error('Deletion could not be scheduled.');
      }
      setTyped('');
      onOpenChange(false);
    } catch (err) {
      setError(userErrorMessage(err, 'Could not schedule your account for deletion.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            Your account enters a 14-day grace period before it&apos;s permanently deleted. Sign in
            any time before then to cancel and restore everything. After that, your account,
            personal workspace, and the workspaces only you belong to are removed for good.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-1">
          <label htmlFor={inputId} className="text-on-surface-variant text-body-medium">
            Type <span className="text-on-surface font-medium">{email}</span> to confirm.
          </label>
          <Input
            id={inputId}
            value={typed}
            autoComplete="off"
            disabled={busy}
            placeholder={email}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
          />
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-body-medium">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose className="focus-visible:ring-ring text-on-surface-variant hover:bg-surface-container-high text-body-medium rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1">
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={!confirmed || busy}
            onClick={() => {
              void onConfirm();
            }}
          >
            {busy ? 'Verifying…' : 'Delete my account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
