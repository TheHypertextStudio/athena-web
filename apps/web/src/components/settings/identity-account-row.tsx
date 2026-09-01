'use client';

/**
 * `settings` — one linked external account, rendered inside its provider's group.
 *
 * @remarks
 * Shows a single linked identity (avatar from the provider `picture` with an initials fallback, the
 * account email/name, and friendly scope badges) plus a destructive **Remove** that unlinks just
 * this account. Used by {@link ProviderGroup}; a provider can list several of these.
 */
import type { IdentityOut } from '@docket/identity-access/identity-contract';
import { Avatar, AvatarFallback, AvatarImage, Badge, Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { accessLabels } from './identity-providers';

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
  return (
    identity.email ?? identity.name ?? `${providerName} account …${identity.accountId.slice(-8)}`
  );
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
    <li className="hover:bg-surface-container-high flex items-center gap-3 px-4 py-3 transition-colors">
      <Avatar className="size-9">
        {identity.picture ? <AvatarImage src={identity.picture} alt="" /> : null}
        <AvatarFallback className="text-label-large">{initials(label)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-on-surface text-label-large truncate">{label}</span>
        {identity.connectionCount > 0 ? (
          <span className="text-on-surface-variant text-body-small">
            {identity.connectionCount} Docket connection
            {identity.connectionCount === 1 ? ' uses' : 's use'} this account, so it cannot be
            removed yet.{' '}
            <Link href="/settings/connections" className="text-primary underline">
              Review connections
            </Link>
          </span>
        ) : null}
        {access.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {access.map((a) => (
              <Badge key={a} variant="secondary" className="text-body-small">
                {a}
              </Badge>
            ))}
          </div>
        ) : null}
        {identity.reauthorizationRequired ? (
          <span className="text-error text-body-small">Reconnect required</span>
        ) : null}
      </div>
      <Button
        controlSize="md"
        variant="ghost-destructive"
        disabled={removing || identity.connectionCount > 0}
        onClick={() => {
          onRemove(identity.accountId);
        }}
      >
        {removing ? 'Removing…' : 'Remove'}
      </Button>
    </li>
  );
}
