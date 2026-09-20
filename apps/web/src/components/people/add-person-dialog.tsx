'use client';

/**
 * "Add a person" — record someone the workspace tracks who has no Docket account.
 *
 * @remarks
 * The sibling of inviting by email, and deliberately the *shorter* of the two flows: a name, nothing else. A volunteer coordinator adding twelve Saturday volunteers should not have
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
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Text,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

import { useAddPerson } from './people-queries';

/** Props for {@link AddPersonDialog}. */
export interface AddPersonDialogProps {
  /** The workspace the person is added to. */
  readonly orgId: string;
  /** Whether the dialog is open (the host surface owns this state). */
  readonly open: boolean;
  /** Report an open-state change (Esc, backdrop, Cancel, or success). */
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * The add-a-person dialog.
 *
 * @param props - The {@link AddPersonDialogProps}.
 * @returns the rendered dialog.
 */
export function AddPersonDialog({ orgId, open, onOpenChange }: AddPersonDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const addPerson = useAddPerson(orgId);

  // Each opening represents a new person; retries within it reuse the same request identity.
  useEffect(() => {
    if (!open) return;
    setName('');
    setRequestId(crypto.randomUUID());
    setError(null);
  }, [open]);

  const busy = addPerson.isPending;
  const canSubmit = name.trim().length > 0 && !busy;

  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setError(null);
    try {
      await addPerson.mutateAsync({ displayName: name.trim(), requestId });
      onOpenChange(false);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Could not add this person.'));
    }
  }, [addPerson, name, requestId, onOpenChange, canSubmit]);

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
            Creates a person record. No invitation will be sent. They can be assigned work, lead
            projects, and own initiatives.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="flex flex-col gap-4"
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
                  setRequestId(crypto.randomUUID());
                  setError(null);
                }}
              />
            </Field>

            {error ? (
              <Text as="p" role="alert" token="body-medium" tone="error">
                {error}
              </Text>
            ) : null}
          </form>
        </DialogBody>

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
