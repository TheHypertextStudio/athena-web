import type { IdentityOut } from '@docket/types';
import NextLink from 'next/link';
import type { JSX } from 'react';

import { IntegrationActionButton } from './integration-action-button';

/** The "connect another Linear account" affordance, shown once under the Linear category. */
export interface LinearAddModel {
  available: readonly IdentityOut[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  busy: boolean;
  connect: () => void;
  addAccountsHref: string;
}

/** Props for {@link LinearAddAccountRow}. */
export interface LinearAddAccountRowProps {
  /** The add-account state and callbacks from the controller. */
  model: LinearAddModel;
}

/**
 * The "connect another Linear account" row — Linear is multi-account, so it always offers one more.
 *
 * @remarks
 * Pure content: it renders whichever affordance the model implies — a picker over already-linked
 * Linear identities when some are available, or a link to link one first when none are. It never
 * fetches; the caller decides whether this row appears at all (only under the Linear category, and
 * only when the viewer can manage connections).
 */
export function LinearAddAccountRow({ model }: LinearAddAccountRowProps): JSX.Element {
  return (
    <li className="border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4">
      <label className="text-on-surface text-sm font-medium" htmlFor="linear-identity">
        Connect another Linear account
      </label>
      {model.available.length > 0 ? (
        <>
          <select
            id="linear-identity"
            value={model.selectedId}
            onChange={(event) => {
              model.setSelectedId(event.target.value);
            }}
            className="border-outline-variant bg-surface text-on-surface min-w-56 rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Choose an account</option>
            {model.available.map((identity) => (
              <option key={identity.accountId} value={identity.accountId}>
                {identity.email ??
                  identity.name ??
                  `Linear account …${identity.accountId.slice(-8)}`}
              </option>
            ))}
          </select>
          <IntegrationActionButton
            tone="primary"
            disabled={model.selectedId.length === 0 || model.busy}
            onClick={model.connect}
          >
            {model.busy ? 'Connecting…' : 'Connect'}
          </IntegrationActionButton>
        </>
      ) : (
        <NextLink
          href={model.addAccountsHref}
          className="text-primary text-sm font-medium hover:underline"
        >
          Link another Linear account first
        </NextLink>
      )}
    </li>
  );
}
