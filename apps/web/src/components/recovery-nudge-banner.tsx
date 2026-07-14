'use client';

/**
 * A global, dismissible nudge to set up (or top up) account recovery codes.
 *
 * @remarks
 * Docket is passwordless — recovery codes are the only way back in after a lost passkey — so a user
 * with no codes is one device failure from permanent lockout. This strip rides along inside the app
 * shell ({@link AppShellInner}) on every signed-in page and shows when the account either has no
 * recovery codes (set-up nudge) or is running low (regenerate nudge). It links to the personal org's
 * Security settings, where {@link SecurityTab} handles the passkey-step-up generation.
 *
 * It reuses the same `queryKeys.recoveryCodes()` cache entry the Security tab uses, so generating
 * codes there clears this with no extra request. Dismissal persists per-user in localStorage, and
 * self-resets once the account is healthy again so a later low state re-prompts.
 */
import { Shield, X } from '@docket/ui/icons';
import Link from 'next/link';
import { type JSX, useEffect, useState } from 'react';

import { sectionHref } from '@/components/settings/sections';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { readRecoveryNudgeDismissed, writeRecoveryNudgeDismissed } from './app-shell-utils';

/** At or below this many remaining codes, prompt the user to regenerate. */
const LOW_THRESHOLD = 2;

/** Props for {@link RecoveryNudgeBanner}. */
export interface RecoveryNudgeBannerProps {
  /** The user's personal org id (recovery codes live under its Security settings); null hides the nudge. */
  personalOrgId: string | null;
  /** The signed-in user id (keys the per-user dismissal). */
  userId: string | null;
}

/** The recovery-codes set-up / top-up nudge banner. Renders nothing when not applicable. */
export function RecoveryNudgeBanner({
  personalOrgId,
  userId,
}: RecoveryNudgeBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(() => readRecoveryNudgeDismissed(userId));

  const statusQ = useApiQuery(
    apiQueryOptions(
      queryKeys.recoveryCodes(),
      () => api.v1.me['recovery-codes'].$get(),
      'Could not load your recovery-code status.',
      { staleTime: STALE.static },
    ),
  );
  const status = statusQ.data;

  // Self-reset: once the account is healthy (codes set up and not low), clear any prior dismissal
  // so a future degradation (e.g. ran low after recoveries) prompts again.
  const healthy = status ? status.enabled && status.remaining > LOW_THRESHOLD : false;
  useEffect(() => {
    if (healthy && readRecoveryNudgeDismissed(userId)) {
      writeRecoveryNudgeDismissed(userId, false);
      setDismissed(false);
    }
  }, [healthy, userId]);

  if (!status || dismissed || !personalOrgId) return null;

  const noCodes = !status.enabled;
  const lowCodes = status.enabled && status.remaining <= LOW_THRESHOLD;
  if (!noCodes && !lowCodes) return null;

  const message = noCodes
    ? 'Set up recovery codes — they’re the only way back in if you lose your passkey.'
    : `You’re low on recovery codes (${status.remaining} left). Regenerate a fresh set.`;

  function dismiss(): void {
    writeRecoveryNudgeDismissed(userId, true);
    setDismissed(true);
  }

  return (
    <div className="px-4 pt-4">
      <div
        role="status"
        className="bg-surface-container-high text-on-surface grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-start gap-x-2 rounded-xl px-3 py-3"
      >
        <span aria-hidden="true" className="flex size-10 items-center justify-center">
          <Shield className={`size-5 ${noCodes ? 'text-destructive' : 'text-primary'}`} />
        </span>
        <div className="min-w-0 py-2">
          <p className="text-body">{message}</p>
          <Link
            href={sectionHref(personalOrgId, 'security')}
            className="text-primary hover:text-primary/80 focus-visible:ring-ring mt-1 inline-flex min-h-10 items-center pr-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {noCodes ? 'Set up' : 'Regenerate'}
          </Link>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
