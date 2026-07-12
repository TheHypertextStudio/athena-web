'use client';

/**
 * `settings` — the Security tab: passkeys, email, active sessions, and account recovery codes.
 *
 * @remarks
 * Composes four independent cards, each owning its own data and loading/error state so one
 * failing does not blank the others: {@link PasskeysSection} (list / add / rename / remove the
 * passkeys that sign the user in), {@link ChangeEmailSection} (request an email change),
 * {@link SessionsSection} (the device list — active logins, a different concept from a passkey),
 * and {@link RecoveryCodesSection} (the backup way back into a passwordless account). Errors
 * render inline as `role="alert"` banners (there is no toast system).
 */
import type { RecoveryCodesStatusOut } from '@docket/types';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { ChangeEmailSection } from './change-email-section';
import { PasskeysSection } from './passkeys-section';
import type { RecoveryCodesMode } from './recovery-codes-dialog';
import { RecoveryCodesDialog } from './recovery-codes-dialog';
import { SessionsSection } from './sessions-section';
import { userErrorMessage } from '@/lib/problem';

/** The Security settings tab — manage passkeys, email, active sessions, then recovery codes. */
export function SecurityTab(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PasskeysSection />
      <ChangeEmailSection />
      <SessionsSection />
      <RecoveryCodesSection />
    </div>
  );
}

/** The recovery-codes card: reads status and drives the (re)generation dialog. */
function RecoveryCodesSection(): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);

  const statusQ = useApiQuery(
    apiQueryOptions(
      queryKeys.recoveryCodes(),
      () => api.v1.me['recovery-codes'].$get(),
      'Could not load your recovery-code status.',
      { staleTime: STALE.volatile },
    ),
  );

  if (statusQ.isPending) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }
  if (statusQ.isError) {
    return (
      <p role="alert" className="text-destructive text-body">
        {userErrorMessage(statusQ.error, 'Could not load security settings.')}
      </p>
    );
  }

  const status: RecoveryCodesStatusOut = statusQ.data;
  const mode: RecoveryCodesMode = status.enabled ? 'regenerate' : 'generate';
  const lowOnCodes = status.enabled && status.remaining <= 3;
  const generatedOn = formatCalendarDate(status.generatedAt);

  return (
    <section className="flex flex-col gap-6" aria-label="Recovery codes">
      <div className="bg-surface-container-low flex flex-col gap-3 rounded-xl p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-on-surface text-body font-medium">Recovery codes</h3>
          <p className="text-on-surface-variant text-body max-w-prose">
            Docket signs you in with a passkey — no password. Recovery codes are your backup: if you
            lose the device with your passkey, a code gets you back in so you can set up a new one.
            Keep them somewhere safe, like a password manager.
          </p>
        </div>

        {status.enabled ? (
          <div className="flex flex-col gap-1">
            <p
              className={
                lowOnCodes ? 'text-destructive text-body' : 'text-on-surface-variant text-body'
              }
            >
              {status.remaining === 0
                ? 'You have no recovery codes left. Regenerate a fresh set now.'
                : `${status.remaining} recovery ${status.remaining === 1 ? 'code' : 'codes'} remaining.`}
            </p>
            {generatedOn ? (
              <p className="text-on-surface-variant text-xs">Last generated on {generatedOn}.</p>
            ) : null}
          </div>
        ) : (
          <p className="text-destructive text-body">
            You haven&apos;t set up recovery codes. Without them, losing your passkey means losing
            access to your account for good.
          </p>
        )}

        <div>
          <Button
            type="button"
            variant={status.enabled ? 'outline' : undefined}
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            {status.enabled ? 'Regenerate codes…' : 'Generate recovery codes…'}
          </Button>
        </div>
      </div>

      <RecoveryCodesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={mode}
        onGenerated={() => {
          void statusQ.refetch();
        }}
      />
    </section>
  );
}
