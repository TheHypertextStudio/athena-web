'use client';

/**
 * The "New {project}" create dialog for the Projects list.
 *
 * @remarks
 * A Project is a *bounded* effort, so the minimal create collects just a name and (when the
 * org has more than one team) the team it belongs to — everything else (lead, dates, status)
 * is set later on the detail screen. Following the Linear pattern, this renders a focused,
 * dismissable modal {@link Dialog}: a centered surface panel with a focused name field, an
 * optional {@link TeamPicker}, and Create / Cancel actions.
 *
 * The dialog is *controlled* by the host page so the page's header "New {project}" button and
 * its empty-state "Create your first {project}" CTA both open the *same* dialog — the page owns
 * `open` and passes it in via {@link CreateProjectDialogProps.open} /
 * {@link CreateProjectDialogProps.onOpenChange}. This component owns only the form's transient
 * field state (reset whenever the dialog closes). The parent owns the roster and is handed the
 * created {@link ProjectOut} via {@link CreateProjectDialogProps.onCreated} so it can
 * optimistically prepend the new row and route to its detail; on a successful create this
 * component closes the dialog itself. The entity noun is passed in (already vocabulary-skinned
 * by the page) so this component never reaches for {@link useVocabulary} itself.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the {@link TeamPicker} is driven from.
 */
import { type ProjectOut, TeamId, type TeamOut } from '@docket/types';
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
import { TeamPicker } from '@/components/teams/team-picker';

/** Props for {@link CreateProjectDialog}. */
export interface CreateProjectDialogProps {
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
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that a project was created, so it can prepend + route. */
  onCreated: (project: ProjectOut) => void;
}

/**
 * The focused modal dialog for creating a new project.
 *
 * @param props - The {@link CreateProjectDialogProps}.
 * @returns the rendered create dialog.
 */
export function CreateProjectDialog({
  orgId,
  projectNoun,
  teams,
  defaultTeamId,
  teamsLoading,
  open,
  onOpenChange,
  onCreated,
}: CreateProjectDialogProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();

  const [name, setName] = useState('');
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamId = teamOverride ?? defaultTeamId;

  /** Reset transient form state whenever the dialog opens or closes. */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (creating) return;
      if (!next) {
        setName('');
        setTeamOverride(null);
        setError(null);
      }
      onOpenChange(next);
    },
    [creating, onOpenChange],
  );

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
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, `Something went wrong creating the ${projectNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [name, teamId, orgId, projectNounLower, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New {projectNoun}</DialogTitle>
          <DialogDescription>
            Name your {projectNounLower} to get started — set the lead, dates, and status later.
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-project-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <Input
            aria-label={`${projectNoun} name`}
            placeholder={`Name your ${projectNounLower}…`}
            value={name}
            disabled={creating}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <TeamPicker teams={teams} value={teamId} onChange={setTeamOverride} disabled={creating} />
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
            form="create-project-form"
            disabled={creating || teamsLoading || name.trim().length === 0}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : `Create ${projectNoun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
