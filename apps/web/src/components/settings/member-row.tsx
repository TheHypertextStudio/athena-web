'use client';

/**
 * `settings` — one row in the Members & Access list.
 *
 * @remarks
 * Renders a human member as an {@link ActorAvatar} + display name, a "You" tag when the row is
 * the caller, a quiet "Guest" badge when the member holds the guest role, the plain-language
 * {@link RoleControl}, and a remove action. The remove action is an icon button that becomes a
 * confirm/cancel pair on first click (no native `confirm()`), and is suppressed entirely for the
 * caller's own row and when the caller cannot manage members. The last-owner guard is enforced
 * server-side; this row simply surfaces the resulting error through the parent.
 */
import { ActorAvatar } from '@docket/ui/components';
import { Badge, Button } from '@docket/ui/primitives';
import { X } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useState } from 'react';

import { RoleControl, type RoleOption } from './role-control';

/** Props for {@link MemberRow}. */
export interface MemberRowProps {
  /** The member's actor id. */
  actorId: string;
  /** The member's display name. */
  displayName: string;
  /** The member's avatar URL, if any. */
  avatarUrl?: string | null;
  /** The member's current role id, or `null` when unknown. */
  roleId: string | null;
  /** Whether this row represents the signed-in caller. */
  isSelf: boolean;
  /** Whether this member currently holds the guest role. */
  isGuest: boolean;
  /** The roles assignable in this org, ordered most-privileged first. */
  roleOptions: readonly RoleOption[];
  /** Whether the caller can manage members (drives editability of the role + remove). */
  canManage: boolean;
  /** Whether a role change is in flight for this member. */
  savingRole: boolean;
  /** Whether a removal is in flight for this member. */
  removing: boolean;
  /** Change this member's role. */
  onChangeRole: (roleId: string) => void;
  /** Remove this member from the org. */
  onRemove: () => void;
}

/**
 * A single Members & Access row.
 *
 * @param props - The {@link MemberRowProps}.
 * @returns the rendered member row.
 */
export function MemberRow({
  displayName,
  avatarUrl,
  roleId,
  isSelf,
  isGuest,
  roleOptions,
  canManage,
  savingRole,
  removing,
  onChangeRole,
  onRemove,
}: MemberRowProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  // The caller cannot change their own role or remove themselves from this surface.
  const canEditRole = canManage && !isSelf;
  const canRemove = canManage && !isSelf;

  return (
    <li className="hover:bg-surface-container-high flex min-h-14 items-center gap-3 px-3 py-2 transition-colors">
      <ActorAvatar kind="human" name={displayName} avatarUrl={avatarUrl} size={32} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-on-surface text-body-medium truncate font-medium">{displayName}</span>
        {isSelf ? <span className="text-on-surface-variant text-xs font-normal">You</span> : null}
        {isGuest ? (
          <Badge variant="secondary" className="font-normal">
            Guest
          </Badge>
        ) : null}
      </div>

      <RoleControl
        options={roleOptions}
        value={roleId}
        onChange={onChangeRole}
        saving={savingRole}
        canEdit={canEditRole}
        ariaLabel={`Role for ${displayName}`}
      />

      {canRemove ? (
        confirming ? (
          <span className="flex items-center gap-1">
            <Button
              variant="destructive"
              size="sm"
              disabled={removing}
              onClick={() => {
                onRemove();
              }}
            >
              {removing ? 'Removing…' : 'Remove'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={removing}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="text-on-surface-variant hover:text-destructive size-8"
            aria-label={`Remove ${displayName}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        )
      ) : (
        // Reserve the action column width so rows stay aligned when no remove action shows.
        <span aria-hidden="true" className="inline-block w-8" />
      )}
    </li>
  );
}
