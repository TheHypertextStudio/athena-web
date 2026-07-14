'use client';

/**
 * `settings` — the change-email card for the Security tab.
 *
 * @remarks
 * Shows the account's current email and a form to request a change. Submitting calls
 * `authClient.changeEmail({ newEmail, callbackURL })` — a base Better Auth client method (no
 * plugin). The server (`packages/auth/src/auth-builder.ts`'s
 * `user.changeEmail.sendChangeEmailConfirmation`) sends a confirmation link to the CURRENT (old)
 * address, never the new one: confirming from the inbox being left is what stops an attacker who
 * merely knows the new address from silently redirecting the account's identity. This screen only
 * requests the change and reports "check your inbox" — the swap itself completes when the user
 * clicks that link, which redirects back here with `?email-changed=1` for the security page's
 * confirmation banner.
 */
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { changeEmail, useSession } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';

/** The change-email card: shows the current address and a request-change form. */
export function ChangeEmailSection(): JSX.Element {
  const { data: session } = useSession();
  const inputId = useId();
  const [newEmail, setNewEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const currentEmail = session?.user.email ?? '';

  async function requestChange(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const callbackURL = `${window.location.pathname}?email-changed=1`;
      const result = await changeEmail({ newEmail, callbackURL });
      if (result.error) {
        setError(userErrorMessage(result.error, 'Could not request the email change.'));
        return;
      }
      setSent(true);
      setNewEmail('');
    } catch {
      setError('Could not request the email change. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Change email">
      <div className="bg-surface-container-low flex flex-col gap-3 rounded-xl p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-on-surface text-body-medium font-medium">Email address</h3>
          <p className="text-on-surface-variant text-body-medium max-w-prose">
            Your current email is{' '}
            <span className="text-on-surface font-medium">{currentEmail}</span>. Changing it sends a
            confirmation link to this address — click it to finish the change.
          </p>
        </div>

        {sent ? (
          <p className="text-body-medium text-on-surface">
            Check <span className="font-medium">{currentEmail}</span> for a confirmation link to
            finish the change.
          </p>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (pending || newEmail.trim().length === 0) return;
              void requestChange();
            }}
          >
            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor={inputId} className="text-on-surface text-body-medium font-medium">
                New email
              </label>
              <Input
                id={inputId}
                type="email"
                required
                value={newEmail}
                autoComplete="email"
                placeholder="you@example.com"
                onChange={(event) => {
                  setNewEmail(event.target.value);
                }}
              />
            </div>
            <Button type="submit" disabled={pending || newEmail.trim().length === 0}>
              {pending ? 'Sending…' : 'Send confirmation'}
            </Button>
          </form>
        )}

        {error ? (
          <p role="alert" className="text-destructive text-body-medium">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
