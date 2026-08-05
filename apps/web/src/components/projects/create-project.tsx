'use client';

/**
 * The robust "New {project}" create composer for the Projects list.
 *
 * @remarks
 * A Project is a *bounded* effort, so the composer captures the fields that give it shape on day
 * one: a title + description body, and an inline strip of compact property pickers — its status,
 * health, the team it belongs to, its lead, its start→target timeline, the
 * {@link useVocabulary | program} it's filed under, and any cross-cutting initiatives it advances.
 * Sensible defaults keep it fast: only a name is required; the team defaults to the org's default
 * and status defaults to `planned`. Built on the shared {@link ComposerShell} + the `@docket/ui`
 * compact pickers.
 *
 * The dialog is *controlled* by the host page so the page's header "New {project}" button and its
 * empty-state "Create your first {project}" CTA both open the *same* dialog. This component owns
 * only the form's transient field state; {@link withComposerReset} scopes that state to a single
 * open, so every open starts from a pristine draft however the previous one ended. The parent owns
 * the roster and is handed the created {@link ProjectOut} through
 * {@link CreateProjectDialogProps.onCreated} so it can optimistically prepend the new row and route
 * to its detail.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the {@link TeamPicker} is driven from.
 * @see {@link useComposerOptions} for the lead + program + initiative option sources.
 */
import {
  ActorId,
  type Health,
  InitiativeId,
  type ProjectOut,
  type ProjectStatus,
  ProgramId,
  TeamId,
  type TeamOut,
} from '@docket/types';
import {
  ActorPicker,
  DateRangePicker,
  EntityPicker,
  EnumPicker,
  LabelsPicker,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { HEALTH_OPTIONS } from '@/components/pickers/options';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { projectStatusOptions } from '@/components/property-pickers/options';
import { TeamPicker } from '@/components/teams/team-picker';
import { formatCalendarDate } from '@/lib/format-date';
import { userErrorMessage, readProblemError } from '@/lib/problem';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors', 'programs', 'initiatives'] as const;

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
  /** The program id the new project is pre-filed under, or `null` for none (e.g. opened from a
   * Program's own Projects tab). The picker remains editable — this only seeds the draft. */
  defaultProgramId?: string | null;
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
export const CreateProjectDialog = withComposerReset(function CreateProjectComposer({
  orgId,
  projectNoun,
  teams,
  defaultTeamId,
  teamsLoading,
  defaultProgramId,
  open,
  onOpenChange,
  onCreated,
}: CreateProjectDialogProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();
  const initiativeNoun = useVocabulary('initiative');

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);
  const programLabel = useVocabulary('program');

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(defaultProgramId ?? null);
  const [status, setStatus] = useState<ProjectStatus>('planned');
  const [health, setHealth] = useState<Health | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [initiativeIds, setInitiativeIds] = useState<readonly string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamId = teamOverride ?? defaultTeamId;

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
          ...(summary.trim().length > 0 ? { summary: summary.trim() } : {}),
          ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
          ...(teamId ? { teamId: TeamId.parse(teamId) } : {}),
          ...(leadId ? { leadId: ActorId.parse(leadId) } : {}),
          ...(programId ? { programId: ProgramId.parse(programId) } : {}),
          status,
          ...(health ? { health } : {}),
          ...(startDate ? { startDate } : {}),
          ...(targetDate ? { targetDate } : {}),
          ...(initiativeIds.length > 0
            ? { initiativeIds: initiativeIds.map((id) => InitiativeId.parse(id)) }
            : {}),
        },
      });
      if (!res.ok) {
        setError(
          userErrorMessage(
            await readProblemError(res, `Could not create the ${projectNounLower}.`),
            `Could not create the ${projectNounLower}.`,
          ),
        );
        return;
      }
      const created = await res.json();
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(userErrorMessage(caught, `Something went wrong creating the ${projectNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [
    name,
    summary,
    body,
    teamId,
    leadId,
    programId,
    status,
    health,
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
      onOpenChange={onOpenChange}
      heading={`New ${projectNoun.toLowerCase()}`}
      title={name}
      onTitleChange={setName}
      titlePlaceholder={`${projectNoun} name`}
      summary={summary}
      onSummaryChange={setSummary}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={body}
      onBodyChange={setBody}
      bodyPlaceholder="Add a description…"
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel={`Create ${projectNoun}`}
    >
      <EnumPicker
        options={projectStatusOptions()}
        value={status}
        onChange={(next) => {
          if (next) setStatus(next);
        }}
        placeholder="Status"
        ariaLabel="Status"
        disabled={creating}
      />
      <EnumPicker
        options={HEALTH_OPTIONS}
        value={health}
        onChange={setHealth}
        placeholder="Set health"
        clearLabel="No health"
        ariaLabel="Health"
        disabled={creating}
      />
      <TeamPicker teams={teams} value={teamId} onChange={setTeamOverride} disabled={creating} />
      <ActorPicker
        options={options.actorOptions}
        value={leadId}
        onChange={setLeadId}
        placeholder="Set lead"
        clearLabel="No lead"
        ariaLabel="Lead"
        disabled={creating}
      />
      <EntityPicker
        options={options.programOptions}
        value={programId}
        onChange={setProgramId}
        placeholder={`Set ${programLabel.toLowerCase()}`}
        clearLabel={`No ${programLabel.toLowerCase()}`}
        searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
        ariaLabel={programLabel}
        disabled={creating}
      />
      <DateRangePicker
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
});
