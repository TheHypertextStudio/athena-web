'use client';

/**
 * `settings` — the invite-a-member control.
 *
 * @remarks
 * A compact form: an email field, a plain-language role picker ({@link RoleControl}), and an
 * "Invite as guest" toggle that scopes the new member to a limited outside collaborator. The
 * role picker and the guest toggle are independent — a guest can be invited at any role — but
 * the toggle is the primary signal carried to the API's `asGuest` flag. Submitting posts the
 * invitation and clears the email on success; errors surface inline as `role="alert"`. All
 * controls are styled design-system components (no bare inputs/selects).
 */
import { Button, Input } from '@docket/ui/primitives';
import { Plus } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useState } from 'react';

import { RoleControl, type RoleOption } from './role-control';

/** The payload emitted when the invite form is submitted. */
export interface InvitePayload {
  /** The invitee's email address. */
  email: string;
  /** The role id to invite at. */
  roleId: string;
  /** Whether to invite as a limited guest collaborator. */
  asGuest: boolean;
}

/** Props for {@link InviteForm}. */
export interface InviteFormProps {
  /** The roles assignable in this org, ordered most-privileged first. */
  roleOptions: readonly RoleOption[];
  /** The default role id to preselect (typically the "member" role). */
  defaultRoleId: string | null;
  /** Whether an invitation is currently being sent. */
  sending: boolean;
  /** A submission error to surface inline, if any. */
  error: string | null;
  /** Submit the invitation. */
  onInvite: (payload: InvitePayload) => void;
}

/**
 * The invite-a-member form.
 *
 * @param props - The {@link InviteFormProps}.
 * @returns the rendered invite form.
 */
export function InviteForm({
  roleOptions,
  defaultRoleId,
  sending,
  error,
  onInvite,
}: InviteFormProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState<string | null>(defaultRoleId);
  const [asGuest, setAsGuest] = useState(false);

  const effectiveRoleId = roleId ?? defaultRoleId;
  const canSubmit = email.trim().length > 0 && effectiveRoleId !== null && !sending;

  return (
    <form
      className="border-outline-variant bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        // `canSubmit` implies a non-null role id; bail otherwise (narrows `effectiveRoleId`).
        if (!canSubmit) return;
        onInvite({ email: email.trim(), roleId: effectiveRoleId, asGuest });
        setEmail('');
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-on-surface text-base font-semibold">Invite someone</h3>
        <p className="text-on-surface-variant text-xs">
          They&rsquo;ll get an email invitation to join this organization.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          required
          aria-label="Invitee email address"
          placeholder="name@company.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          className="min-w-56 flex-1"
        />
        <RoleControl
          options={roleOptions}
          value={effectiveRoleId}
          onChange={setRoleId}
          canEdit={roleOptions.length > 0}
          ariaLabel="Role for the new member"
        />
        <Button type="submit" disabled={!canSubmit}>
          <Plus aria-hidden="true" className="size-4" />
          {sending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>

      <label className="text-on-surface-variant flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary size-4 rounded"
          checked={asGuest}
          onChange={(event) => {
            setAsGuest(event.target.checked);
          }}
        />
        <span>
          Invite as a <span className="text-on-surface font-medium">guest</span> — a limited outside
          collaborator
        </span>
      </label>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
