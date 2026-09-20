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
import { InlineBanner } from '@docket/ui/components';
import { Shield } from '@docket/ui/icons';
import { type JSX, useEffect, useState } from 'react';
import { sectionHref } from '@/components/settings/settings-registry';
import { api } from '@/lib/api';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { readRecoveryNudgeDismissed, writeRecoveryNudgeDismissed } from './app-shell-utils';

/** At or below this many remaining codes, prompt the user to regenerate. */
const LOW_THRESHOLD = 2;

interface RecoveryNudgeCopy {
  readonly body: string;
  readonly actionLabel: string;
  readonly title: string;
  readonly tone: 'critical' | 'info';
}

function recoveryNudgeCopy(status: {
  enabled: boolean;
  remaining: number;
}): RecoveryNudgeCopy | null {
  if (!status.enabled) {
    return {
      body: 'Set up recovery codes — they’re the only way back in if you lose your passkey.',
      actionLabel: 'Set up recovery codes',
      title: 'Recovery codes needed',
      tone: 'critical',
    };
  }
  if (status.remaining <= LOW_THRESHOLD) {
    return {
      body: `You’re low on recovery codes (${status.remaining} left). Regenerate a fresh set.`,
      actionLabel: 'Regenerate recovery codes',
      title: 'Recovery codes running low',
      tone: 'info',
    };
  }
  return null;
}

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
  const router = useRouter();

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

  const copy = status ? recoveryNudgeCopy(status) : null;
  if (!status || dismissed || !personalOrgId || !copy) return null;

  function dismiss(): void {
    writeRecoveryNudgeDismissed(userId, true);
    setDismissed(true);
  }

  return (
    <InlineBanner
      tone={copy.tone}
      title={copy.title}
      icon={<Shield aria-hidden="true" className="size-4" />}
      action={{
        label: copy.actionLabel,
        onSelect: () => {
          router.push(sectionHref(personalOrgId, 'security'));
        },
      }}
      dismissLabel="Dismiss recovery-code reminder"
      onDismiss={dismiss}
    >
      {copy.body}
    </InlineBanner>
  );
}
