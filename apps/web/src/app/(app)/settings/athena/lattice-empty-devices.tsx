import { EmptyState } from '@docket/ui/components';
import { Computer } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import {
  LATTICE_SETUP_URL,
  LATTICE_UNAVAILABLE_REASON_MESSAGE,
  type LatticeUnavailableReason,
} from './lattice-copy';

/** The device-list empty state, including a specific recovery message for a failed grant. */
export function LatticeEmptyDevices({
  isError,
  reason,
}: {
  readonly isError: boolean;
  readonly reason: LatticeUnavailableReason | null;
}): JSX.Element {
  // The final device can disappear during a session, so announce this transition.
  return (
    <div role="status">
      {isError || reason ? (
        <EmptyState
          icon={Computer}
          title="Could not load your computers"
          body={
            reason
              ? LATTICE_UNAVAILABLE_REASON_MESSAGE[reason]
              : 'Try again in a moment, or reconnect Lovelace if this keeps happening.'
          }
          frame="none"
        />
      ) : (
        <EmptyState
          icon={Computer}
          title="No computers paired"
          body="Install Lattice on a computer to pair it here."
          frame="none"
          action={
            <Button asChild variant="secondary">
              <a href={LATTICE_SETUP_URL} target="_blank" rel="noopener noreferrer">
                Set up Lattice
              </a>
            </Button>
          }
        />
      )}
    </div>
  );
}
