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
 * the Danger zone shows the pending banner. The step-up and the write are one attempt, so this
 * dialog owns their presentation: a failure at either point becomes one notice and the dialog stays
 * open for another try.
 */
import { AccountStatusOut } from '@docket/identity-access/account-contract';
import {
  Button,
  Dialog,
  DialogClose,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { presentFailure } from '@/components/feedback';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

import { useReauth } from './use-reauth';

/** What the notice says when scheduling fails without a more specific reason. */
const SCHEDULE_FAILED = 'Could not schedule your account for deletion.';

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
  const reauth = useReauth();

  const scheduleDeletion = useApiMutation({
    mutationFn: () => unwrap(() => api.v1.me.account.$delete(), SCHEDULE_FAILED),
    invalidateKeys: [queryKeys.account()],
  });

  const confirmed = typed.trim().toLowerCase() === email.trim().toLowerCase();

  function close(next: boolean): void {
    if (busy) return; // don't dismiss mid-request
    if (!next) setTyped('');
    onOpenChange(next);
  }

  async function onConfirm(): Promise<void> {
    setBusy(true);
    try {
      // Step-up: re-verify the passkey so the server's fresh-session gate passes. The write
      // below presents its own failure; only the step-up needs a notice from here.
      await reauth();
    } catch (caught) {
      presentFailure(caught, 'Could not confirm your passkey.');
      setBusy(false);
      return;
    }
    scheduleDeletion.mutate(undefined, {
      onSuccess: (data) => {
        if (AccountStatusOut.parse(data).deletionState !== 'pending_deletion') {
          presentFailure(undefined, SCHEDULE_FAILED);
          return;
        }
        setTyped('');
        onOpenChange(false);
      },
      onSettled: () => {
        setBusy(false);
      },
    });
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

        <DialogBody className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-on-surface-variant text-body-medium">
            Type <span className="text-on-surface text-label-large">{email}</span> to confirm.
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
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
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
