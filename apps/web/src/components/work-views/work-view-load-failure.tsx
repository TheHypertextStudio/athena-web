'use client';

import { EmptyState } from '@docket/ui/components';
import {
  CircleAlert,
  CloudOff,
  CreditCard,
  PhonePasskey,
  RefreshCw,
  Shield,
} from '@docket/ui/icons';
import type { JSX } from 'react';

import { type FailureIcon, failurePresentation } from '@/lib/failure-presentation';

/** Props for the shared work-view recovery state. */
export interface WorkViewLoadFailureProps {
  /** Surface name, used when the failure carries nothing more specific. */
  readonly title: string;
  /** The failure itself, which decides what this says and which action it offers. */
  readonly error: unknown;
  readonly retrying: boolean;
  /** A local failure never displaces roster rows that the person can still use. */
  readonly hasCachedRows?: boolean;
  readonly onRetry: () => void;
}

/** Glyphs that read as the kind of failure, rather than as "something happened". */
const FAILURE_ICON = {
  offline: CloudOff,
  retry: RefreshCw,
  permission: Shield,
  billing: CreditCard,
  identity: PhonePasskey,
  missing: CircleAlert,
} as const satisfies Record<FailureIcon, unknown>;

/**
 * Render a failed work view as what actually happened and the action that resolves it.
 *
 * @remarks
 * This used to say `"{title} could not load"` for every failure, which described a 403, a 500, a
 * rate limit and a dropped connection identically, and offered Retry for all of them — inviting
 * someone to press a button that cannot work. The copy and the action now come from the failure's
 * own stable problem code, through the catalog in `contracts/errors.ts`.
 *
 * No server prose is read: `failurePresentation` branches on `code` and `status` only.
 */
export function WorkViewLoadFailure({
  title,
  error,
  retrying,
  hasCachedRows = false,
  onRetry,
}: WorkViewLoadFailureProps): JSX.Element {
  if (hasCachedRows) return <></>;
  const failure = failurePresentation(error, `${title} could not load`);
  return (
    <div role="alert" className="flex min-h-64 flex-1 items-center justify-center p-6">
      <EmptyState
        frame="none"
        icon={FAILURE_ICON[failure.icon]}
        title={failure.title}
        body={failure.detail}
        // Retrying a permission or billing failure cannot change the answer, and offering it says
        // the surface does not know what went wrong.
        {...(failure.canRetry
          ? {
              cta: {
                label: retrying ? 'Retrying' : 'Try again',
                onClick: onRetry,
                disabled: retrying,
              },
            }
          : {})}
      />
    </div>
  );
}
