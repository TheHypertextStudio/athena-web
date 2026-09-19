'use client';

/**
 * `components/entity-detail/detail-unavailable` — the stand-in for a detail record that was deleted
 * or whose access was revoked while it was open.
 */
import { EmptyState } from '@docket/ui/components';
import { CircleAlert, Shield } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import { RegionFrame } from '@/components/feedback';

/** Props for {@link DetailUnavailable}. */
export interface DetailUnavailableProps {
  /** The workspace's lower-cased word for the record ("initiative"). */
  readonly noun: string;
  /** The record is off limits rather than gone. */
  readonly forbidden: boolean;
  /** The list the person can return to. */
  readonly backHref: string;
  /** Label for the return link ("Back to initiatives"). */
  readonly backLabel: string;
}

/**
 * Say the record is gone or off limits, with the one place to go next.
 *
 * @param props - See {@link DetailUnavailableProps}.
 * @returns the centred unavailable state.
 */
export function DetailUnavailable({
  noun,
  forbidden,
  backHref,
  backLabel,
}: DetailUnavailableProps): JSX.Element {
  return (
    <RegionFrame>
      <EmptyState
        frame="none"
        icon={forbidden ? Shield : CircleAlert}
        title={
          forbidden ? `You no longer have access to this ${noun}` : `This ${noun} no longer exists`
        }
        action={
          <Button asChild variant="outline">
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        }
      />
    </RegionFrame>
  );
}
