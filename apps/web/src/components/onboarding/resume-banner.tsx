/**
 * Resume banner for users who skipped onboarding.
 *
 * Shown on protected pages when the user has skipped but not completed onboarding.
 * Allows them to resume from where they left off.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import CloseIcon from '@mui/icons-material/Close';
import { Button } from '@/components/ui/button';
import { useOnboardingRequired } from '@/hooks/use-onboarding';
import { cn } from '@/lib/utils';
import { ONBOARDING_TEST_IDS } from './test-ids';

/**
 * Resume banner component.
 * Shows when user has skipped onboarding but not completed it.
 */
export function OnboardingResumeBanner() {
  const [isDismissed, setIsDismissed] = useState(false);
  const { status, isLoading } = useOnboardingRequired();

  // Check if banner was previously dismissed in this session
  useEffect(() => {
    const dismissed = sessionStorage.getItem('athena-onboarding-banner-dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  // Don't show if loading, not skipped, or already completed, or dismissed
  if (isLoading || !status?.skippedAt || status.completedAt || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('athena-onboarding-banner-dismissed', 'true');
  };

  return (
    <div
      className={cn(
        'fixed right-0 bottom-0 left-0 z-40',
        'bg-surface-container border-outline-variant border-t',
        'px-4 py-3',
        'flex items-center justify-between gap-4',
        'animate-in slide-in-from-bottom duration-300',
      )}
      data-testid={ONBOARDING_TEST_IDS.resumeBanner.root}
    >
      <div className="flex items-center gap-3">
        <span className="text-on-surface-variant text-sm">
          Continue setting up Athena to get personalized recommendations.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Link href="/onboarding">
          <Button
            variant="filled"
            size="sm"
            data-testid={ONBOARDING_TEST_IDS.resumeBanner.resumeButton}
          >
            Resume setup
          </Button>
        </Link>
        <Button
          variant="text"
          size="icon"
          onClick={handleDismiss}
          aria-label="Dismiss"
          data-testid={ONBOARDING_TEST_IDS.resumeBanner.dismissButton}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </Button>
      </div>
    </div>
  );
}
