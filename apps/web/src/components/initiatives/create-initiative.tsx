'use client';

/**
 * The "New {initiative}" create dialog for the Initiatives list.
 *
 * @remarks
 * An Initiative is a cross-cutting *theme* that holds no work of its own — it associates
 * many-to-many with Projects + Programs — so the minimal create collects just a name; the
 * associations come later on the detail screen. Following the Linear pattern, this renders a
 * focused, dismissable modal {@link Dialog}: a centered surface panel with a focused name field
 * and Create / Cancel actions.
 *
 * The dialog is *controlled* by the host page so the page's header "New {initiative}" button and
 * its empty-state CTA both open the *same* dialog — the page owns `open` and passes it in via
 * {@link CreateInitiativeDialogProps.open} / {@link CreateInitiativeDialogProps.onOpenChange}.
 * This component owns only the form's transient field state (reset whenever the dialog closes).
 * The parent owns the roster and is handed the created {@link InitiativeOut} via
 * {@link CreateInitiativeDialogProps.onCreated} so it can route to its (empty) detail; on a
 * successful create this component closes the dialog itself. The entity noun is passed in
 * (already vocabulary-skinned by the page) so this component never reaches for
 * {@link useVocabulary} itself.
 */
import type { InitiativeOut } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** Props for {@link CreateInitiativeDialog}. */
export interface CreateInitiativeDialogProps {
  /** The org the initiative is created in (from the route). */
  orgId: string;
  /** The singular, vocabulary-skinned initiative noun (e.g. "Initiative", "Theme"). */
  initiativeNoun: string;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that an initiative was created, so it can route to its detail. */
  onCreated: (initiative: InitiativeOut) => void;
}

/**
 * The focused modal dialog for creating a new initiative.
 *
 * @param props - The {@link CreateInitiativeDialogProps}.
 * @returns the rendered create dialog.
 */
export function CreateInitiativeDialog({
  orgId,
  initiativeNoun,
  open,
  onOpenChange,
  onCreated,
}: CreateInitiativeDialogProps): JSX.Element {
  const initiativeNounLower = initiativeNoun.toLowerCase();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Reset transient form state whenever the dialog closes. */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (creating) return;
      if (!next) {
        setName('');
        setError(null);
      }
      onOpenChange(next);
    },
    [creating, onOpenChange],
  );

  /** Create the theme, then hand it to the parent to route to its detail. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.v1.orgs[':orgId'].initiatives.$post({
        param: { orgId },
        json: { name: trimmed },
      });
      if (!res.ok) {
        setError(await readProblem(res, `Could not create the ${initiativeNounLower}.`));
        return;
      }
      const created = await res.json();
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, `Something went wrong creating the ${initiativeNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [name, orgId, initiativeNounLower, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New {initiativeNoun}</DialogTitle>
          <DialogDescription>
            Name a cross-cutting theme — associate {initiativeNounLower}s with work later on its
            detail screen.
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-initiative-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <Input
            aria-label={`${initiativeNoun} name`}
            placeholder={`Name your ${initiativeNounLower}…`}
            value={name}
            disabled={creating}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={creating}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="create-initiative-form"
            disabled={creating || name.trim().length === 0}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : `Create ${initiativeNoun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
