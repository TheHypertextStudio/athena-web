import { Button, DecorativeIcon, Select } from '@docket/ui/primitives';
import type { IdentityOut } from '@docket/types';
import NextLink from '@/components/docket-link';
import { Layers } from '@docket/ui/icons';
import type { JSX } from 'react';

import { connectionCardCopy } from './integrations-config';

/** The "connect another Linear account" affordance, shown once under the Linear category. */
export interface LinearAddModel {
  available: readonly IdentityOut[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  busy: boolean;
  connect: () => void;
  addAccountsHref: string;
  /** Existing Linear connections, used to distinguish the first account from another one. */
  connectedCount: number;
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
  const title = model.connectedCount === 0 ? 'Connect Linear' : 'Connect another Linear account';
  const description = connectionCardCopy('linear').effect;
  return (
    <li className="bg-surface-container-low grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl p-4">
      <DecorativeIcon icon={Layers} className="bg-surface-container shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label className="text-on-surface text-label-large" htmlFor="linear-identity">
          {title}
        </label>
        <span className="text-on-surface-variant text-body-small truncate">{description}</span>
      </div>
      {model.available.length > 0 ? (
        <div className="col-start-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <Select
            id="linear-identity"
            value={model.selectedId}
            onChange={(event) => {
              model.setSelectedId(event.target.value);
            }}
            className="min-w-0"
          >
            <option value="">Choose an account</option>
            {model.available.map((identity) => (
              <option key={identity.accountId} value={identity.accountId}>
                {identity.email ??
                  identity.name ??
                  `Linear account …${identity.accountId.slice(-8)}`}
              </option>
            ))}
          </Select>
          <Button
            controlSize="md"
            variant="secondary"
            disabled={model.selectedId.length === 0 || model.busy}
            onClick={model.connect}
          >
            {model.busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      ) : (
        <NextLink
          href={model.addAccountsHref}
          className="text-primary text-body-small col-start-2 hover:underline"
        >
          {model.connectedCount === 0
            ? 'Link a Linear account first'
            : 'Link another Linear account first'}
        </NextLink>
      )}
    </li>
  );
}
