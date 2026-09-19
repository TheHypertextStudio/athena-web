'use client';

/**
 * `components/entity-detail/header-load-failure` — the banner for a read that feeds the detail
 * header's pickers (members, labels, planning calendar, display settings) when that read failed.
 */
import { InlineBanner } from '@docket/ui/components';
import type { JSX } from 'react';

import { PartialLoadBanner } from '@/components/feedback';

/** One read behind the header, and whether it failed. */
export interface HeaderLoadFailure {
  /** The read failed. */
  readonly failed: boolean;
  /** Application-owned copy naming what did not load ("Could not load members"). */
  readonly title: string;
  /** Re-issue the read; omit when the read has no retry of its own. */
  readonly onRetry?: (() => void) | undefined;
}

/** Props for {@link HeaderLoadFailureBanner}. */
export interface HeaderLoadFailureBannerProps {
  /** The reads behind the header, in the order their failures take priority. */
  readonly failures: readonly HeaderLoadFailure[];
}

/**
 * Show the first header read that failed, with its retry beside it.
 *
 * @param props - See {@link HeaderLoadFailureBannerProps}.
 * @returns the banner, or nothing when every read answered.
 */
export function HeaderLoadFailureBanner({
  failures,
}: HeaderLoadFailureBannerProps): JSX.Element | null {
  const failure = failures.find((candidate) => candidate.failed);
  if (!failure) return null;
  const body = 'The rest of this page still works.';
  if (failure.onRetry) {
    return (
      <PartialLoadBanner title={failure.title} onRetry={failure.onRetry}>
        {body}
      </PartialLoadBanner>
    );
  }
  return (
    <InlineBanner tone="critical" title={failure.title}>
      {body}
    </InlineBanner>
  );
}
