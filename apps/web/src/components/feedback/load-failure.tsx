'use client';

/**
 * `components/feedback/load-failure` — a region that could not load, as what happened and the
 * action that resolves it.
 *
 * @remarks
 * The copy and the action come from the failure's own stable problem code, through the catalog in
 * `lib/contracts/errors.ts`, so a 403, a 500, a rate limit and a dropped connection each say what
 * happened and offer what can resolve it. No server prose is read.
 */
import { EmptyState } from '@docket/ui/components';
import {
  CircleAlert,
  CloudOff,
  CreditCard,
  PhonePasskey,
  RefreshCw,
  Shield,
} from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import { failureAction, type FailureIcon, failurePresentation } from '@/lib/failure-presentation';

import { RegionFrame } from './region-frame';

/** Props for {@link LoadFailure}. */
export interface LoadFailureProps {
  /** Surface name, used when the failure carries nothing more specific ("Projects"). */
  readonly title: string;
  /** The failure itself, which decides what this says and which action it offers. */
  readonly error: unknown;
  /** Re-issue the read; offered only when retrying could plausibly succeed. */
  readonly onRetry?: (() => void) | undefined;
  readonly retrying?: boolean | undefined;
  /** `region` (default) fills a content area; `panel` is a compact block for a rail or a card. */
  readonly size?: 'region' | 'panel' | undefined;
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
 * Render a failed read as what actually happened and the action that resolves it.
 *
 * Retrying a permission or billing failure cannot change the answer, and offering it says the
 * surface does not know what went wrong. Those get the destination that can resolve them instead,
 * so the state is never a dead end.
 */
export function LoadFailure({
  title,
  error,
  onRetry,
  retrying = false,
  size = 'region',
}: LoadFailureProps): JSX.Element {
  const failure = failurePresentation(error, `${title} could not load`);
  const destination = failureAction(failure);
  const retry = failure.canRetry && onRetry;
  return (
    <RegionFrame size={size}>
      <EmptyState
        frame="none"
        tone="critical"
        icon={FAILURE_ICON[failure.icon]}
        title={failure.title}
        body={failure.detail}
        {...(retry
          ? {
              cta: {
                label: retrying ? 'Retrying' : 'Try again',
                onClick: retry,
                disabled: retrying,
              },
            }
          : {})}
        {...(destination
          ? {
              action: (
                <Button asChild variant="outline">
                  <Link href={destination.href}>{destination.label}</Link>
                </Button>
              ),
            }
          : {})}
      />
    </RegionFrame>
  );
}
