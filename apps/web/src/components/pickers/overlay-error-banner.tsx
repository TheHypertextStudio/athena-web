'use client';

/**
 * `pickers/overlay-error-banner` — a failure shown inside a picker or palette overlay.
 *
 * @remarks
 * A list in an overlay that could not load, or a change it could not save, keeps the failure in the
 * overlay beside the rows. A compact critical `InlineBanner` carries it, inset from the overlay
 * edge. See `docs/engineering/specs/error-presentation.md`.
 */
import { InlineBanner, type InlineBannerAction } from '@docket/ui/components';
import type { JSX, ReactNode } from 'react';

/** What an overlay says beneath a failure that has no retry of its own. */
const REOPEN_HINT = 'Close and reopen to try again.';

/** Props for {@link OverlayErrorBanner}. */
export interface OverlayErrorBannerProps {
  /** Application-owned copy naming what did not work. */
  readonly title: string;
  /** What the person can rely on or do next; defaults to reopening the overlay. */
  readonly children?: ReactNode;
  /** A retry, when the overlay can re-issue the failed step itself. */
  readonly action?: InlineBannerAction | undefined;
}

/** A compact critical banner for a picker or palette overlay. */
export function OverlayErrorBanner({
  title,
  children = REOPEN_HINT,
  action,
}: OverlayErrorBannerProps): JSX.Element {
  return (
    <div className="m-1">
      <InlineBanner tone="critical" density="compact" title={title} action={action}>
        {children}
      </InlineBanner>
    </div>
  );
}
