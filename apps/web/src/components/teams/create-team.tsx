'use client';

/**
 * The "New team" create dialog for the Teams list.
 *
 * @remarks
 * A Team is a first-class unit that owns its own workflow states, cycles, and Triage queue.
 * Creating one needs a display name and a short, org-unique `key` (the prefix that fronts the
 * team's identifiers, e.g. "ENG"). This dialog collects both: the key is auto-suggested from
 * the name (uppercased, alphanumeric, trimmed to a few characters) as the user types, but stays
 * fully editable — once the user edits the key by hand we stop overwriting it. The team is
 * created with the API's default five-state workflow and Triage enabled.
 *
 * Following the Linear pattern, it renders a focused, dismissable modal {@link Dialog}: a
 * centered surface panel with focused inputs and Create / Cancel actions. The dialog is
 * *controlled* by the host page so the page's header "New team" button and its empty-state
 * "Create your first team" CTA both open the *same* dialog — the page owns `open` and passes it
 * in via {@link CreateTeamDialogProps.open} / {@link CreateTeamDialogProps.onOpenChange}. This
 * component owns only the form's transient field state (reset whenever the dialog closes). Teams
 * have no detail route, so on success the parent simply prepends the new row via
 * {@link CreateTeamDialogProps.onCreated}; this component closes the dialog itself.
 */
import type { TeamOut } from '@docket/types';
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

/** The longest auto-suggested key length (matches typical Linear-style team prefixes). */
const MAX_SUGGESTED_KEY = 5;

/** Derive a tidy key suggestion from a team name: uppercase alphanumerics, capped in length. */
function suggestKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_SUGGESTED_KEY);
}

/** Props for {@link CreateTeamDialog}. */
export interface CreateTeamDialogProps {
  /** The org the team is created in (from the route). */
  orgId: string;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that a team was created, so it can prepend the row. */
  onCreated: (team: TeamOut) => void;
}

/**
 * The focused modal dialog for creating a new team.
 *
 * @param props - The {@link CreateTeamDialogProps}.
 * @returns the rendered create dialog.
 */
export function CreateTeamDialog({
  orgId,
  open,
  onOpenChange,
  onCreated,
}: CreateTeamDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Once the user edits the key directly we stop deriving it from the name.
  const [keyDirty, setKeyDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Update the name, keeping the key in sync until the user takes the key over. */
  const onNameChange = useCallback(
    (next: string): void => {
      setName(next);
      if (!keyDirty) setKey(suggestKey(next));
    },
    [keyDirty],
  );

  const canSubmit = name.trim().length > 0 && key.trim().length > 0;

  /** Reset transient form state whenever the dialog closes. */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (creating) return;
      if (!next) {
        setName('');
        setKey('');
        setKeyDirty(false);
        setError(null);
      }
      onOpenChange(next);
    },
    [creating, onOpenChange],
  );

  /** Create the team with the default workflow + Triage, then prepend it via the parent. */
  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.v1.orgs[':orgId'].teams.$post({
        param: { orgId },
        json: { name: name.trim(), key: key.trim().toUpperCase() },
      });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not create the team.'));
        return;
      }
      const created = await res.json();
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, 'Something went wrong creating the team.'));
    } finally {
      setCreating(false);
    }
  }, [canSubmit, name, key, orgId, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>
            A team owns its own workflow, cycles, and triage queue. Give it a name and a short key.
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-team-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-on-surface-variant text-xs font-medium">Name</span>
              <Input
                aria-label="Team name"
                placeholder="e.g. Engineering"
                value={name}
                disabled={creating}
                onChange={(event) => {
                  onNameChange(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:w-32">
              <span className="text-on-surface-variant text-xs font-medium">Key</span>
              <Input
                aria-label="Team key"
                placeholder="ENG"
                value={key}
                maxLength={10}
                disabled={creating}
                className="uppercase"
                onChange={(event) => {
                  setKeyDirty(true);
                  setKey(event.target.value.toUpperCase());
                }}
              />
            </label>
          </div>
          <p className="text-on-surface-variant text-xs">
            The key prefixes the team&apos;s identifiers and must be unique in this workspace.
          </p>
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
            form="create-team-form"
            disabled={creating || !canSubmit}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : 'Create team'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
