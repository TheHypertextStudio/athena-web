'use client';

/**
 * "Add a person" — record someone the workspace tracks who has no Docket account.
 *
 * @remarks
 * The sibling of inviting by email, and deliberately the *shorter* of the two flows: a name and a
 * role, nothing else. A volunteer coordinator adding twelve Saturday volunteers should not have
 * to invent twelve email addresses, and the people they add are assignable the moment they exist.
 *
 * The copy avoids framing the person as incomplete. They are not a "pending" or "unregistered"
 * member awaiting an upgrade — they are a person this workspace tracks, and the dialog says so.
 * Inviting them to sign in later is offered as an equal alternative, not as the real path.
 *
 * A focused modal dialog rather than an inline form, matching every other create flow.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Text,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

import { useAddPerson } from './people-queries';

/** A role the new person can be given, in the workspace's own words. */
export interface PersonRoleOption {
  /** The role id. */
  readonly id: string;
  /** The role's display name. */
  readonly name: string;
}

/** Props for {@link AddPersonDialog}. */
export interface AddPersonDialogProps {
  /** The workspace the person is added to. */
  readonly orgId: string;
  /** Whether the dialog is open (the host surface owns this state). */
  readonly open: boolean;
  /** Report an open-state change (Esc, backdrop, Cancel, or success). */
  readonly onOpenChange: (open: boolean) => void;
  /** The roles assignable in this workspace. */
  readonly roleOptions: readonly PersonRoleOption[];
  /** The role selected by default — the workspace's plain "member" role when it has one. */
  readonly defaultRoleId: string | null;
}

/**
 * The add-a-person dialog.
 *
 * @param props - The {@link AddPersonDialogProps}.
 * @returns the rendered dialog.
 */
export function AddPersonDialog({
  orgId,
  open,
  onOpenChange,
  roleOptions,
  defaultRoleId,
}: AddPersonDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState<string | null>(defaultRoleId);
  const [error, setError] = useState<string | null>(null);
  const addPerson = useAddPerson(orgId);

  // Re-arm the form each time the dialog opens, so a second person does not inherit the first
  // one's typing, and so a late-resolving role list still lands on the intended default.
  useEffect(() => {
    if (!open) return;
    setName('');
    setRoleId(defaultRoleId);
    setError(null);
  }, [open, defaultRoleId]);

  const busy = addPerson.isPending;
  const canSubmit = name.trim().length > 0 && !busy;

  const submit = useCallback(async (): Promise<void> => {
    if (name.trim().length === 0) return;
    setError(null);
    try {
      await addPerson.mutateAsync({ displayName: name.trim(), roleId });
      onOpenChange(false);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not add this person.'));
    }
  }, [addPerson, name, roleId, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>
            For someone this workspace works with who won&apos;t be signing in — a volunteer, a
            contractor, a partner. They can be assigned work, lead projects, and own initiatives
            just like anyone else here.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Name">
            <Input
              controlSize="lg"
              value={name}
              autoFocus
              autoComplete="off"
              placeholder="Priya Raman"
              disabled={busy}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>

          {roleOptions.length > 0 ? (
            <Field
              label="Role"
              description="What they can do here if they ever do sign in. It also sets how they're described across the workspace."
            >
              <Select
                controlSize="lg"
                value={roleId ?? ''}
                disabled={busy}
                onChange={(event) => {
                  setRoleId(event.target.value === '' ? null : event.target.value);
                }}
              >
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {error ? (
            <Text as="p" role="alert" token="body-medium" tone="error">
              {error}
            </Text>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose className="focus-visible:ring-ring text-on-surface-variant hover:bg-surface-container-high text-label-large rounded-md px-3 py-1.5 outline-none focus-visible:ring-1">
            Cancel
          </DialogClose>
          <Button
            type="button"
            controlSize="lg"
            disabled={!canSubmit}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Adding…' : 'Add person'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
