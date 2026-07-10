'use client';

/**
 * `settings` — one linked external account, rendered inside its provider's group.
 *
 * @remarks
 * Shows a single linked identity (avatar from the provider `picture` with an initials fallback, the
 * account email/name, and friendly scope badges) plus a destructive **Remove** that unlinks just
 * this account. Used by {@link ProviderGroup}; a provider can list several of these.
 */
import type { IdentityOut } from '@docket/types';
import { Avatar, AvatarFallback, AvatarImage, Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { accessLabels } from './identity-providers';
import { IntegrationActionButton } from './integration-action-button';

/** Props for {@link IdentityAccountRow}. */
export interface IdentityAccountRowProps {
  /** The linked account. */
  identity: IdentityOut;
  /** The provider's display name, used as the last-resort label (e.g. GitHub/Linear carry no email). */
  providerName: string;
  /** Whether this row's Remove is in flight. */
  removing: boolean;
  /** Unlink this specific account. */
  onRemove: (accountId: string) => void;
}

/** The display label for an account: its email, then name, then the provider name. */
function accountLabel(identity: IdentityOut, providerName: string): string {
  return identity.email ?? identity.name ?? providerName;
}

/** Initials for the avatar fallback (first letter of the label). */
function initials(label: string): string {
  return label.charAt(0).toUpperCase();
}

/** A single linked-account row: avatar + email/name + scopes + Remove. */
export function IdentityAccountRow({
  identity,
  providerName,
  removing,
  onRemove,
}: IdentityAccountRowProps): JSX.Element {
  const label = accountLabel(identity, providerName);
  const access = accessLabels(identity.scopes);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar className="size-9">
        {identity.picture ? <AvatarImage src={identity.picture} alt="" /> : null}
        <AvatarFallback className="text-body font-medium">{initials(label)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-on-surface text-body truncate font-medium">{label}</span>
        {access.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {access.map((a) => (
              <Badge key={a} variant="secondary" className="text-xs font-normal">
                {a}
              </Badge>
            ))}
          </div>
        ) : null}
        {identity.reauthorizationRequired ? (
          <span className="text-destructive text-xs">Reconnect required</span>
        ) : null}
      </div>
      <IntegrationActionButton
        tone="danger"
        disabled={removing}
        onClick={() => {
          onRemove(identity.accountId);
        }}
      >
        {removing ? 'Removing…' : 'Remove'}
      </IntegrationActionButton>
    </li>
  );
}
