'use client';

/**
 * `settings` — the Security tab: passkeys, email, active sessions, and account recovery codes.
 *
 * @remarks
 * Composes four independent cards, each owning its own data and loading/error state so one
 * failing does not blank the others: {@link PasskeysSection} (list / add / rename / remove the
 * passkeys that sign the user in), {@link ChangeEmailSection} (request an email change),
 * {@link SessionsSection} (the device list — active logins, a different concept from a passkey),
 * and {@link RecoveryCodesSection} (the backup way back into a passwordless account). A failed
 * write is presented as a notice by the mutation that made it.
 */
import type { RecoveryCodesStatusOut } from '@docket/identity-access/account-contract';
import { QueryLoadFailure } from '@/components/feedback';
import { InlineBanner } from '@docket/ui/components';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { ChangeEmailSection } from './change-email-section';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';
import { PasskeysSection } from './passkeys-section';
import type { RecoveryCodesMode } from './recovery-codes-dialog';
import { RecoveryCodesDialog } from './recovery-codes-dialog';
import { SessionsSection } from './sessions-section';

/**
 * The Security settings tab.
 *
 * @remarks
 * Ordered by what the cards are *about*, which they were not. Passkeys and recovery codes are one
 * subject — a recovery code exists because a passkey can be lost — and they sat at opposite ends
 * of the section with an email form and a device list between them. Meanwhile a toast nags about
 * setting up recovery codes, and following it meant scrolling past two unrelated cards to find
 * the thing it named.
 *
 * Sign-in first, then the account, then devices.
 */
export function SecurityTab(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PasskeysSection />
      <RecoveryCodesSection />
      <ChangeEmailSection />
      <SessionsSection />
    </div>
  );
}

/**
 * How many recovery codes are left, in words.
 *
 * @param remaining - Unused codes on the account.
 * @returns the status line for the recovery-codes card.
 */
function remainingCopy(remaining: number): string {
  if (remaining === 0) return 'You have no recovery codes left. Regenerate a fresh set now.';
  if (remaining === 1) return '1 recovery code remaining.';
  return `${remaining} recovery codes remaining.`;
}

/**
 * The recovery-codes card: reads status and drives the (re)generation dialog.
 *
 * @remarks
 * Not having codes, or running low on them, is a state of the account rather than a failed
 * action, so it stays in the card as a banner beside the button that resolves it.
 */
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
    return <QueryLoadFailure size="panel" title="Security settings" query={statusQ} />;
  }

  const status: RecoveryCodesStatusOut = statusQ.data;
  const mode: RecoveryCodesMode = status.enabled ? 'regenerate' : 'generate';
  const lowOnCodes = status.enabled && status.remaining <= 3;
  const generatedOn = formatCalendarDate(status.generatedAt);

  return (
    <>
      <SettingsGroup capability={SETTINGS_NODES.securityRecoveryCodes}>
        {status.enabled ? (
          <div className="flex flex-col gap-1">
            {lowOnCodes ? (
              <InlineBanner tone="critical" title="Running low">
                {remainingCopy(status.remaining)}
              </InlineBanner>
            ) : (
              <p className="text-on-surface-variant text-body-medium">
                {remainingCopy(status.remaining)}
              </p>
            )}
            {generatedOn ? (
              <p className="text-on-surface-variant text-body-small">
                Last generated on {generatedOn}.
              </p>
            ) : null}
          </div>
        ) : (
          <InlineBanner tone="critical" title="No recovery codes">
            You haven&apos;t set up recovery codes. Without them, losing your passkey means losing
            access to your account for good.
          </InlineBanner>
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
