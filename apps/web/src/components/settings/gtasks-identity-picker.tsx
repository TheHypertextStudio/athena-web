import { Skeleton } from '@docket/ui/primitives';
import { TaskAlt } from '@docket/ui/icons';
import NextLink from 'next/link';
import type { JSX } from 'react';

import { IntegrationActionButton } from './integration-action-button';
import type { GtasksPickerModel } from './use-gtasks-controller';

/** Props for {@link GtasksIdentityPicker}. */
export interface GtasksIdentityPickerProps {
  /** The picker state and callbacks from the controller. */
  picker: GtasksPickerModel;
  /** The active organization id (for the "link one first" pointer). */
  orgId: string;
}

/**
 * The picker panel: choose an already-linked Google identity to connect (or link one first).
 *
 * @remarks
 * Pure content — it renders whichever affordance the model implies: a loading skeleton, an
 * explanatory empty state (every account already connected, or none linked yet), or the list of
 * connectable identities.
 */
export function GtasksIdentityPicker({ picker, orgId }: GtasksIdentityPickerProps): JSX.Element {
  if (picker.loading) {
    return <Skeleton className="h-16 w-full rounded-xl" />;
  }
  if (picker.available.length === 0) {
    return (
      <div className="bg-surface-container-low text-on-surface-variant text-body-medium rounded-xl p-4">
        {picker.hasAnyIdentity ? (
          'Every linked Google account is already connected here.'
        ) : (
          <span>
            Link a Google account under{' '}
            <NextLink
              href={`/orgs/${orgId}/settings/connected-accounts`}
              className="text-primary font-medium hover:underline"
            >
              Connected accounts
            </NextLink>{' '}
            first, then connect it here.
          </span>
        )}
      </div>
    );
  }
  return (
    <ul className="bg-surface-container-low flex flex-col gap-1 rounded-xl p-2">
      {picker.available.map((identity) => {
        const label = identity.email ?? identity.name ?? 'Google account';
        const busy = picker.busySub === identity.accountId;
        return (
          <li key={identity.accountId} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <TaskAlt aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
            <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
              {label}
            </span>
            <IntegrationActionButton
              tone="primary"
              disabled={busy}
              onClick={() => {
                picker.pick(identity.accountId);
              }}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </IntegrationActionButton>
          </li>
        );
      })}
    </ul>
  );
}
