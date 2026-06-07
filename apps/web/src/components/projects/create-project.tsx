'use client';

/**
 * The inline "New {project}" create affordance for the Projects list.
 *
 * @remarks
 * A Project is a *bounded* effort, so the minimal create collects just a name and (when the
 * org has more than one team) the team it belongs to — everything else (lead, dates, status)
 * is set later on the detail screen. Rather than a bare `prompt`, this renders a styled,
 * dismissable composer panel: a card-framed form with a focused name field, an optional
 * {@link TeamPicker}, and Create / Cancel actions.
 *
 * The panel is rendered by the page only while its create composer is open (so the page's
 * header "New {project}" button and its empty-state "Create your first {project}" CTA both
 * open the *same* composer). It owns only the form's transient field state; the parent owns
 * the roster and is handed the created {@link ProjectOut} via
 * {@link CreateProjectPanelProps.onCreated} so it can optimistically prepend the new row and
 * route to its detail, and is told to close via {@link CreateProjectPanelProps.onClose}. The
 * entity noun is passed in (already vocabulary-skinned by the page) so this component never
 * reaches for {@link useVocabulary} itself.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the {@link TeamPicker} is driven from.
 */
import { type ProjectOut, TeamId, type TeamOut } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { TeamPicker } from '@/components/teams/team-picker';

/** Props for {@link CreateProjectPanel}. */
export interface CreateProjectPanelProps {
  /** The org the project is created in (from the route). */
  orgId: string;
  /** The singular, vocabulary-skinned project noun (e.g. "Project", "Workstream"). */
  projectNoun: string;
  /** The teams the project may be attached to (the active org's teams). */
  teams: readonly TeamOut[];
  /** The team id new work defaults to, or `null` before teams resolve. */
  defaultTeamId: string | null;
  /** Whether the active org's teams are still loading. */
  teamsLoading: boolean;
  /** Notify the parent to close (dismiss) the composer. */
  onClose: () => void;
  /** Notify the parent that a project was created, so it can prepend + route. */
  onCreated: (project: ProjectOut) => void;
}

/**
 * The dismissable composer panel for creating a new project.
 *
 * @param props - The {@link CreateProjectPanelProps}.
 * @returns the rendered composer form.
 */
export function CreateProjectPanel({
  orgId,
  projectNoun,
  teams,
  defaultTeamId,
  teamsLoading,
  onClose,
  onCreated,
}: CreateProjectPanelProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();

  const [name, setName] = useState('');
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const teamId = teamOverride ?? defaultTeamId;

  // Focus the name field on mount so the composer is immediately typeable.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /** Create the project, then hand it to the parent for optimistic insertion + routing. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.v1.orgs[':orgId'].projects.$post({
        param: { orgId },
        json: { name: trimmed, ...(teamId ? { teamId: TeamId.parse(teamId) } : {}) },
      });
      if (!res.ok) {
        setError(await readProblem(res, `Could not create the ${projectNounLower}.`));
        return;
      }
      const created = await res.json();
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, `Something went wrong creating the ${projectNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [name, teamId, orgId, projectNounLower, onCreated]);

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
      aria-label={`New ${projectNounLower}`}
    >
      <Input
        ref={nameRef}
        aria-label={`${projectNoun} name`}
        placeholder={`Name your ${projectNounLower}…`}
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
      <div className="flex items-center justify-between gap-2">
        <TeamPicker teams={teams} value={teamId} onChange={setTeamOverride} disabled={creating} />
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" disabled={creating} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={creating || teamsLoading || name.trim().length === 0}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : `Create ${projectNoun}`}
          </Button>
        </div>
      </div>
    </form>
  );
}
