'use client';

/**
 * The inline "New {program}" create composer for the Programs list.
 *
 * @remarks
 * A Program is an *ongoing* line of work, not team-scoped, so the minimal create collects just
 * a name — the owner, health, and visibility are set later on the detail screen. Rather than a
 * bare `prompt`, this renders a styled, dismissable composer panel: a card-framed form with a
 * focused name field and Create / Cancel actions.
 *
 * The panel is rendered by the page only while its create composer is open (so the page's
 * header "New {program}" button and its empty-state "Create your first {program}" CTA both
 * open the *same* composer). It owns only the form's transient field state; the parent owns
 * the roster and is handed the created {@link ProgramOut} via
 * {@link CreateProgramPanelProps.onCreated} so it can optimistically prepend the new row and
 * route to its detail, and is told to close via {@link CreateProgramPanelProps.onClose}. The
 * entity noun is passed in (already vocabulary-skinned by the page) so this component never
 * reaches for {@link useVocabulary} itself.
 */
import type { ProgramOut } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** Props for {@link CreateProgramPanel}. */
export interface CreateProgramPanelProps {
  /** The org the program is created in (from the route). */
  orgId: string;
  /** The singular, vocabulary-skinned program noun (e.g. "Program", "Service line"). */
  programNoun: string;
  /** Notify the parent to close (dismiss) the composer. */
  onClose: () => void;
  /** Notify the parent that a program was created, so it can prepend + route. */
  onCreated: (program: ProgramOut) => void;
}

/**
 * The dismissable composer panel for creating a new program.
 *
 * @param props - The {@link CreateProgramPanelProps}.
 * @returns the rendered composer form.
 */
export function CreateProgramPanel({
  orgId,
  programNoun,
  onClose,
  onCreated,
}: CreateProgramPanelProps): JSX.Element {
  const programNounLower = programNoun.toLowerCase();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the name field on mount so the composer is immediately typeable.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /** Create the program, then hand it to the parent for optimistic insertion + routing. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.v1.orgs[':orgId'].programs.$post({
        param: { orgId },
        json: { name: trimmed },
      });
      if (!res.ok) {
        setError(await readProblem(res, `Could not create the ${programNounLower}.`));
        return;
      }
      const created = await res.json();
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, `Something went wrong creating the ${programNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [name, orgId, programNounLower, onCreated]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !creating) onClose();
      }}
      className="bg-card text-card-foreground flex flex-col gap-3 rounded-xl border p-4 shadow"
      aria-label={`New ${programNounLower}`}
    >
      <Input
        ref={nameRef}
        aria-label={`${programNoun} name`}
        placeholder={`Name your ${programNounLower}…`}
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
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={creating} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={creating || name.trim().length === 0} className="gap-1.5">
          <Plus aria-hidden="true" className="size-4" />
          {creating ? 'Creating…' : `Create ${programNoun}`}
        </Button>
      </div>
    </form>
  );
}
