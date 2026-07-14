'use client';

/**
 * `settings` — one provider in the Connected accounts directory.
 *
 * @remarks
 * A provider card that scales from "discover" to "manage": its header shows the provider icon, name,
 * and a status badge, and its body lists the linked accounts ({@link IdentityAccountRow}) grouped
 * under it with an **Add account / Add another** action. Unavailable providers are filtered by the
 * parent; an existing account remains manageable even when adding another is unavailable.
 */
import type { IdentityOut, IdentityProvider } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { IdentityAccountRow } from './identity-account-row';
import type { IdentityProviderEntry } from './identity-providers';
import { IntegrationActionButton } from './integration-action-button';

/** Props for {@link ProviderGroup}. */
export interface ProviderGroupProps {
  /** The catalog entry to render. */
  entry: IdentityProviderEntry;
  /** The accounts already linked under this provider (empty for an unconnected/coming-soon provider). */
  accounts: readonly IdentityOut[];
  /** Whether another account can be linked right now. */
  configured: boolean;
  /** Whether an add for this provider is in flight. */
  adding: boolean;
  /** The account id whose Remove is in flight, if any. */
  busyId: string | null;
  /** Start linking a new account for this (live, configured) provider. */
  onAdd: (provider: IdentityProvider) => void;
  /** Unlink one account under this provider. */
  onRemove: (provider: IdentityProvider, accountId: string) => void;
}

/** The status badge `{ label, variant }` for a visible provider's current state. */
function statusBadge(count: number): { label: string; variant: 'secondary' | 'outline' } {
  if (count > 0) return { label: `${count} connected`, variant: 'secondary' };
  return { label: 'Not connected', variant: 'outline' };
}

/** A single provider in the Connected accounts directory: header + linked accounts + add action. */
export function ProviderGroup({
  entry,
  accounts,
  configured,
  adding,
  busyId,
  onAdd,
  onRemove,
}: ProviderGroupProps): JSX.Element {
  const Icon = entry.icon;
  const canAdd = configured;
  const badge = statusBadge(accounts.length);

  return (
    <li className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
        <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-body-medium font-medium">{entry.name}</span>
        </div>
        <div className="flex w-full shrink-0 items-center justify-between gap-2 pl-12 sm:w-auto sm:justify-start sm:pl-0">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {canAdd ? (
            <IntegrationActionButton
              tone="primary"
              disabled={adding}
              onClick={() => {
                onAdd(entry.id);
              }}
            >
              <Plus aria-hidden className="size-4" />
              {adding ? 'Opening…' : accounts.length > 0 ? 'Add another' : 'Add account'}
            </IntegrationActionButton>
          ) : null}
        </div>
      </div>

      {accounts.length > 0 ? (
        <ul className="border-outline-variant divide-outline-variant divide-y border-t">
          {accounts.map((identity) => (
            <IdentityAccountRow
              key={identity.accountId}
              identity={identity}
              providerName={entry.name}
              removing={busyId === identity.accountId}
              onRemove={(accountId) => {
                onRemove(entry.id, accountId);
              }}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
