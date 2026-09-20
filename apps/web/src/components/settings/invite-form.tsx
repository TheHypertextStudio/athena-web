'use client';

/**
 * `settings` — the invite-a-member control.
 *
 * @remarks
 * A compact form: an email field, a plain-language role picker ({@link RoleControl}), and an
 * "Invite as guest" toggle that scopes the new member to a limited outside collaborator. The
 * role picker and the guest toggle are independent — a guest can be invited at any role — but
 * the toggle is the primary signal carried to the API's `asGuest` flag. Submitting posts the
 * invitation and clears the email on success; a failed invitation is presented as a notice by the
 * mutation that sent it. All controls are styled design-system components (no bare
 * inputs/selects).
 */
import { Checkbox, Button, Input, Select, Field } from '@docket/ui/primitives';
import { Plus } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useState } from 'react';

import { RoleControl, type RoleOption } from './role-control';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';

/** The payload emitted when the invite form is submitted. */
export interface InvitePayload {
  /** The invitee's email address. */
  email: string;
  /** The role id to invite at. */
  roleId: string;
  /** Whether to invite as a limited guest collaborator. */
  asGuest: boolean;
  /** Existing person whose work the accepted account will retain. */
  personActorId?: string;
}

/** Props for {@link InviteForm}. */
export interface InviteFormProps {
  /** The roles assignable in this org, ordered most-privileged first. */
  roleOptions: readonly RoleOption[];
  /** People who can receive account access without creating another record. */
  people?: readonly { actorId: string; displayName: string }[];
  /** The default role id to preselect (typically the "member" role). */
  defaultRoleId: string | null;
  /** Whether an invitation is currently being sent. */
  sending: boolean;
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
  people = [],
  defaultRoleId,
  sending,
  onInvite,
}: InviteFormProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [personActorId, setPersonActorId] = useState('');
  const [roleId, setRoleId] = useState<string | null>(defaultRoleId);
  const [asGuest, setAsGuest] = useState(false);

  const effectiveRoleId = roleId ?? defaultRoleId;
  const canSubmit = email.trim().length > 0 && effectiveRoleId !== null && !sending;

  return (
    <SettingsGroup capability={SETTINGS_NODES.workspaceInvite}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          // `canSubmit` implies a non-null role id; bail otherwise (narrows `effectiveRoleId`).
          if (!canSubmit) return;
          onInvite({
            email: email.trim(),
            roleId: effectiveRoleId,
            asGuest,
            ...(personActorId ? { personActorId } : {}),
          });
          setEmail('');
        }}
      >
        <InvitationPersonSelect
          people={people}
          value={personActorId}
          onChange={setPersonActorId}
          disabled={sending}
        />
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

        <label className="text-on-surface-variant text-body-medium flex w-fit cursor-pointer items-center gap-2">
          <Checkbox
            className="rounded"
            checked={asGuest}
            onChange={(event) => {
              setAsGuest(event.target.checked);
            }}
          />
          <span>
            Invite as a <span className="text-on-surface text-label-large">guest</span> — a limited
            outside collaborator
          </span>
        </label>
      </form>
    </SettingsGroup>
  );
}

function InvitationPersonSelect({
  people,
  value,
  onChange,
  disabled,
}: {
  people: NonNullable<InviteFormProps['people']>;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}): JSX.Element | null {
  if (people.length === 0) return null;
  return (
    <Field
      label="Person"
      description="Keep their existing assignments and mentions when they accept."
    >
      <Select
        aria-label="Person to invite"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        disabled={disabled}
      >
        <option value="">Someone new</option>
        {people.map((person) => (
          <option key={person.actorId} value={person.actorId}>
            {person.displayName}
          </option>
        ))}
      </Select>
    </Field>
  );
}
