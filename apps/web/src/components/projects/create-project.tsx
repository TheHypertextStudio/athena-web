'use client';

/**
 * The robust "New {project}" create composer for the Projects list.
 *
 * @remarks
 * A Project is a *bounded* effort, so the composer captures the fields that give it shape on day
 * one: a title + description body, and an inline strip of compact property pickers — the team it
 * belongs to, its lead, its start→target timeline, and any cross-cutting
 * {@link useVocabulary | initiatives} it advances. (A Project's lifecycle `status`/`health` and
 * its parent `program` are set later on the detail screen — they are intentionally not part of the
 * create DTO.) Sensible defaults keep it fast: only a name is required; the team defaults to the
 * org's default. Built on the shared {@link ComposerShell} + the `@docket/ui` compact pickers.
 *
 * The dialog is *controlled* by the host page so the page's header "New {project}" button and its
 * empty-state "Create your first {project}" CTA both open the *same* dialog. This component owns
 * only the form's transient field state (reset whenever the dialog closes). The parent owns the
 * roster and is handed the created {@link ProjectOut} through {@link CreateProjectDialogProps.onCreated}
 * so it can optimistically prepend the new row and route to its detail.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the {@link TeamPicker} is driven from.
 * @see {@link useComposerOptions} for the lead + initiative option sources.
 */
import { ActorId, InitiativeId, type ProjectOut, TeamId, type TeamOut } from '@docket/types';
import { ActorPicker, DateRangePicker, LabelsPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { TeamPicker } from '@/components/teams/team-picker';
import { formatCalendarDate } from '@/lib/format-date';
import { readError, readProblem } from '@/lib/problem';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors', 'initiatives'] as const;

/** Format an ISO date for a picker trigger, narrowing the app helper's `null` to `undefined`. */
function triggerDate(value: string | null): string | undefined {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' }) ?? undefined;
}

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
 * The robust project-create composer dialog.
 *
 * @param props - The {@link CreateProjectDialogProps}.
 * @returns the rendered composer.
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
  const initiativeNoun = useVocabulary('initiative');

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [initiativeIds, setInitiativeIds] = useState<readonly string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamId = teamOverride ?? defaultTeamId;

  /** Reset transient form state whenever the dialog closes. */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        setName('');
        setBody('');
        setTeamOverride(null);
        setLeadId(null);
        setStartDate(null);
        setTargetDate(null);
        setInitiativeIds([]);
        setError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  /** Toggle an initiative id in/out of the selected set. */
  const toggleInitiative = useCallback((id: string): void => {
    setInitiativeIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }, []);

  const canSubmit = name.trim().length > 0 && !teamsLoading;

  /** Create the project with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const trimmedBody = body.trim();
      const res = await api.v1.orgs[':orgId'].projects.$post({
        param: { orgId },
        json: {
          name: trimmed,
          ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
          ...(teamId ? { teamId: TeamId.parse(teamId) } : {}),
          ...(leadId ? { leadId: ActorId.parse(leadId) } : {}),
          ...(startDate ? { startDate } : {}),
          ...(targetDate ? { targetDate } : {}),
          ...(initiativeIds.length > 0
            ? { initiativeIds: initiativeIds.map((id) => InitiativeId.parse(id)) }
            : {}),
        },
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
  }, [
    name,
    body,
    teamId,
    leadId,
    startDate,
    targetDate,
    initiativeIds,
    orgId,
    projectNounLower,
    onOpenChange,
    onCreated,
  ]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={handleOpenChange}
      heading={`New ${projectNoun}`}
      description={`Name your ${projectNounLower}, then set its lead, timeline, and ${initiativeNoun.toLowerCase()}s now — or later.`}
      title={name}
      onTitleChange={setName}
      titlePlaceholder={`${projectNoun} name`}
      body={body}
      onBodyChange={setBody}
      bodyPlaceholder="Add a description…"
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel={`Create ${projectNoun}`}
    >
      <TeamPicker
        teams={teams}
        value={teamId}
        onChange={setTeamOverride}
        disabled={creating}
        className="h-8"
      />
      <ActorPicker
        triggerVariant="outline"
        options={options.actorOptions}
        value={leadId}
        onChange={setLeadId}
        placeholder="Set lead"
        clearLabel="No lead"
        ariaLabel="Lead"
        disabled={creating}
      />
      <DateRangePicker
        triggerVariant="outline"
        value={{ start: startDate, end: targetDate }}
        onChange={({ start, end }) => {
          setStartDate(start);
          setTargetDate(end);
        }}
        placeholder="Set timeline"
        formatLabel={triggerDate}
        ariaLabel="Timeline"
        startLabel="Start"
        endLabel="Target"
        disabled={creating}
      />
      <LabelsPicker
        triggerVariant="outline"
        options={options.initiativeOptions}
        value={initiativeIds}
        onToggle={toggleInitiative}
        placeholder={`Link ${initiativeNoun.toLowerCase()}s`}
        searchPlaceholder={`Search ${initiativeNoun.toLowerCase()}s…`}
        emptyText={`No ${initiativeNoun.toLowerCase()}s`}
        ariaLabel={`${initiativeNoun}s`}
        disabled={creating}
      />
    </ComposerShell>
  );
}
