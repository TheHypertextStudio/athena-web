'use client';

/**
 * `entity-detail/partial-load-banner` — one part of a detail page did not answer while the rest of
 * it is still usable.
 *
 * @remarks
 * A detail page composes several reads. When the aggregate refresh or one tab's work read fails
 * after the page already has content, the content stays and this banner names what is stale or
 * missing, with the retry beside it. A read that fails with nothing to show is `LoadFailure`
 * instead; see `docs/engineering/specs/error-presentation.md`.
 */
import { InlineBanner } from '@docket/ui/components';
import type { JSX, ReactNode } from 'react';

/** Props for {@link PartialLoadBanner}. */
export interface PartialLoadBannerProps {
  /** Application-owned copy naming what did not answer ("Could not refresh this project"). */
  readonly title: string;
  /** Re-issue the read that failed. */
  readonly onRetry: () => void;
  /** What the person can rely on meanwhile; defaults to the last loaded version. */
  readonly children?: ReactNode;
}

/** A partial failure kept in the page beside the content that still loaded. */
export function PartialLoadBanner({
  title,
  onRetry,
  children = 'What is shown is the last version that loaded.',
}: PartialLoadBannerProps): JSX.Element {
  return (
    <InlineBanner tone="critical" title={title} action={{ label: 'Try again', onSelect: onRetry }}>
      {children}
    </InlineBanner>
  );
}
