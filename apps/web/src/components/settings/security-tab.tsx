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
import { LoadFailure } from './load-failure';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { ChangeEmailSection } from './change-email-section';
import { SettingsGroup } from './settings-group';
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
    // placeholder: whether recovery codes have been generated and how many remain unused. The
    // panel is either "generate codes" or "you have N left" — opposite copy, so neither can be
    // shown early without risking telling someone the wrong thing about their account recovery.
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (statusQ.isError) {
    return (
      <LoadFailure
        message={userErrorMessage(statusQ.error, 'Could not load security settings.')}
        retrying
      />
    );
  }

  const status: RecoveryCodesStatusOut = statusQ.data;
  const mode: RecoveryCodesMode = status.enabled ? 'regenerate' : 'generate';
  const lowOnCodes = status.enabled && status.remaining <= 3;
  const generatedOn = formatCalendarDate(status.generatedAt);

  return (
    <>
      <SettingsGroup
        title="Recovery codes"
        description="If you lose your passkey, a recovery code gets you back in. Each code works once. Keep them in a password manager."
      >
        {status.enabled ? (
          <div className="flex flex-col gap-1">
            <p
              className={
                lowOnCodes
                  ? 'text-error text-body-medium'
                  : 'text-on-surface-variant text-body-medium'
              }
            >
              {status.remaining === 0
                ? 'You have no recovery codes left. Regenerate a fresh set now.'
                : `${status.remaining} recovery ${status.remaining === 1 ? 'code' : 'codes'} remaining.`}
            </p>
            {generatedOn ? (
              <p className="text-on-surface-variant text-body-small">
                Last generated on {generatedOn}.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-error text-body-medium">
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
      </SettingsGroup>

      <RecoveryCodesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={mode}
        onGenerated={() => {
          void statusQ.refetch();
        }}
      />
    </>
  );
}
