'use client';

/**
 * The inline "New team" create composer for the Teams list.
 *
 * @remarks
 * A Team is a first-class unit that owns its own workflow states, cycles, and Triage queue.
 * Creating one needs a display name and a short, org-unique `key` (the prefix that fronts the
 * team's identifiers, e.g. "ENG"). This composer collects both: the key is auto-suggested from
 * the name (uppercased, alphanumeric, trimmed to a few characters) as the user types, but stays
 * fully editable — once the user edits the key by hand we stop overwriting it. The team is
 * created with the API's default five-state workflow and Triage enabled.
 *
 * Rather than a bare `prompt`, it renders a styled, dismissable composer panel: a card-framed
 * form with focused inputs and Create / Cancel actions. The panel is rendered by the page only
 * while its create composer is open (so the page's header "New team" button and its empty-state
 * "Create your first team" CTA both open the *same* composer). Teams have no detail route, so on
 * success the parent simply prepends the new row via {@link CreateTeamPanelProps.onCreated}; it
 * is told to close via {@link CreateTeamPanelProps.onClose}.
 */
import type { TeamOut } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

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

/** Props for {@link CreateTeamPanel}. */
export interface CreateTeamPanelProps {
  /** The org the team is created in (from the route). */
  orgId: string;
  /** Notify the parent to close (dismiss) the composer. */
  onClose: () => void;
  /** Notify the parent that a team was created, so it can prepend the row. */
  onCreated: (team: TeamOut) => void;
}

/**
 * The dismissable composer panel for creating a new team.
 *
 * @param props - The {@link CreateTeamPanelProps}.
 * @returns the rendered composer form.
 */
export function CreateTeamPanel({ orgId, onClose, onCreated }: CreateTeamPanelProps): JSX.Element {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Once the user edits the key directly we stop deriving it from the name.
  const [keyDirty, setKeyDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the name field on mount so the composer is immediately typeable.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /** Update the name, keeping the key in sync until the user takes the key over. */
  const onNameChange = useCallback(
    (next: string): void => {
      setName(next);
      if (!keyDirty) setKey(suggestKey(next));
    },
    [keyDirty],
  );

  const canSubmit = name.trim().length > 0 && key.trim().length > 0;

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
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, 'Something went wrong creating the team.'));
    } finally {
      setCreating(false);
    }
  }, [canSubmit, name, key, orgId, onCreated]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !creating) onClose();
      }}
      className="bg-surface-container-high text-on-surface border-outline-variant flex flex-col gap-3 rounded-xl border p-4 shadow-lg"
      aria-label="New team"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">Name</span>
          <Input
            ref={nameRef}
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
          <span className="text-muted-foreground text-xs font-medium">Key</span>
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
      <p className="text-muted-foreground text-xs">
        The key prefixes the team&apos;s identifiers and must be unique in this workspace.
      </p>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={creating} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={creating || !canSubmit} className="gap-1.5">
          <Plus aria-hidden="true" className="size-4" />
          {creating ? 'Creating…' : 'Create team'}
        </Button>
      </div>
    </form>
  );
}
