'use client';

/**
 * `settings` — the pending-invitations list with revoke.
 *
 * @remarks
 * Lists the org's pending invitations (email + invited-at role + a Guest badge when invited as
 * a guest + relative expiry) and lets a manager revoke each one. Each revoke is a quiet outline
 * button that becomes a confirm/cancel pair on first click. When there are no pending
 * invitations the section renders nothing — the parent decides whether to show an empty state.
 */
import { Badge, Button } from '@docket/ui/primitives';
import { Inbox } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useState } from 'react';

/** A pending invitation as shown in the list. */
export interface PendingInvitation {
  /** The invitation id. */
  id: string;
  /** The invitee's email address. */
  email: string;
  /** The role id the invitation was issued at. */
  roleId: string;
  /** Whether the invitation was issued as a guest. */
  asGuest: boolean;
  /** ISO-8601 expiry timestamp. */
  expiresAt: string;
}

/** Map a role id to its plain-language label using the org's roles. */
export type RoleLabelResolver = (roleId: string) => string;

/** Props for {@link InvitationsList}. */
export interface InvitationsListProps {
  /** The pending invitations to render. */
  invitations: readonly PendingInvitation[];
  /** Resolve a role id to a plain-language label. */
  roleLabel: RoleLabelResolver;
  /** Whether the caller can revoke invitations. */
  canManage: boolean;
  /** The id of the invitation whose revoke is currently in flight, if any. */
  revokingId: string | null;
  /** Revoke a pending invitation by id. */
  onRevoke: (invitationId: string) => void;
}

/** Format an ISO expiry as a short, human relative string ("in 6 days" / "expired"). */
function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'expired';
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `expires in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
  return `expires in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * The pending-invitations list.
 *
 * @param props - The {@link InvitationsListProps}.
 * @returns the rendered list, or an empty-state when there are none.
 */
export function InvitationsList({
  invitations,
  roleLabel,
  canManage,
  revokingId,
  onRevoke,
}: InvitationsListProps): JSX.Element {
  if (invitations.length === 0) {
    return (
      <div className="text-on-surface-variant flex items-center gap-2 px-3 py-6 text-sm">
        <Inbox aria-hidden="true" className="size-4" />
        <span>No pending invitations.</span>
      </div>
    );
  }

  return (
    <ul className="divide-outline-variant divide-y">
      {invitations.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          invitation={invitation}
          roleLabel={roleLabel}
          canManage={canManage}
          revoking={revokingId === invitation.id}
          onRevoke={() => {
            onRevoke(invitation.id);
          }}
        />
      ))}
    </ul>
  );
}

/** One pending-invitation row with an inline revoke confirm. */
function InvitationRow({
  invitation,
  roleLabel,
  canManage,
  revoking,
  onRevoke,
}: {
  invitation: PendingInvitation;
  roleLabel: RoleLabelResolver;
  canManage: boolean;
  revoking: boolean;
  onRevoke: () => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="hover:bg-surface-container-high flex min-h-14 items-center gap-3 px-3 py-2 transition-colors">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-on-surface truncate text-sm font-medium">{invitation.email}</span>
          {invitation.asGuest ? (
            <Badge variant="secondary" className="font-normal">
              Guest
            </Badge>
          ) : null}
        </div>
        <span className="text-on-surface-variant text-xs">
          Invited as {roleLabel(invitation.roleId)} &middot; {formatExpiry(invitation.expiresAt)}
        </span>
      </div>

      {canManage ? (
        confirming ? (
          <span className="flex items-center gap-1">
            <Button
              variant="destructive"
              size="sm"
              disabled={revoking}
              onClick={() => {
                onRevoke();
              }}
            >
              {revoking ? 'Revoking…' : 'Revoke'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={revoking}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Revoke
          </Button>
        )
      ) : null}
    </li>
  );
}
