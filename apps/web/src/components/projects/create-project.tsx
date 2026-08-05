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
 * empty-state "Create your first {project}" CTA both open the *same* dialog. Its fields live in one
 * {@link useComposerDraft} value, which {@link withComposerReset} scopes to a single open, so every
 * open starts from a pristine draft however the previous one ended. The parent owns the roster and
 * is handed the created {@link ProjectOut} through {@link CreateProjectDialogProps.onCreated} so it
 * can optimistically prepend the new row and route to its detail.
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
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import {
  AppliedTemplateNotice,
  ComposerTemplateControl,
} from '@/components/composer/template-menu';
import { useComposerDraft } from '@/components/composer/use-composer-draft';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { userErrorMessage, readProblemError } from '@/lib/problem';

import { ProjectComposerPickers } from './project-form-pickers';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors', 'programs', 'initiatives'] as const;

/** Every field the project composer holds, as one value. */
export interface ProjectDraft {
  name: string;
  summary: string;
  description: string;
  /** The team chosen in the picker, or null to follow the org default. */
  teamOverride: string | null;
  leadId: string | null;
  programId: string | null;
  status: ProjectStatus;
  health: Health | null;
  startDate: string | null;
  targetDate: string | null;
  initiativeIds: readonly string[];
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
  /** A template to apply on open, from a `?template=` compose request. */
  defaultTemplateId?: string | null;
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
  defaultTemplateId = null,
}: CreateProjectDialogProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);
  const { draft, setField, updateDraft, applyTemplate, undoTemplate, appliedTemplate } =
    useComposerDraft<ProjectDraft>({
      name: '',
      summary: '',
      description: '',
      teamOverride: null,
      leadId: null,
      programId: defaultProgramId ?? null,
      status: 'planned',
      health: null,
      startDate: null,
      targetDate: null,
      initiativeIds: [],
    });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamId = draft.teamOverride ?? defaultTeamId;

  /** Toggle an initiative id in/out of the selected set. */
  const toggleInitiative = useCallback(
    (id: string): void => {
      updateDraft((current) => ({
        initiativeIds: current.initiativeIds.includes(id)
          ? current.initiativeIds.filter((value) => value !== id)
          : [...current.initiativeIds, id],
      }));
    },
    [updateDraft],
  );

  const canSubmit = draft.name.trim().length > 0 && !teamsLoading;

  /** Create the project with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = draft.name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const trimmedBody = draft.description.trim();
      const res = await api.v1.orgs[':orgId'].projects.$post({
        param: { orgId },
        json: {
          name: trimmed,
          ...(draft.summary.trim().length > 0 ? { summary: draft.summary.trim() } : {}),
          ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
          ...(teamId ? { teamId: TeamId.parse(teamId) } : {}),
          ...(draft.leadId ? { leadId: ActorId.parse(draft.leadId) } : {}),
          ...(draft.programId ? { programId: ProgramId.parse(draft.programId) } : {}),
          status: draft.status,
          ...(draft.health ? { health: draft.health } : {}),
          ...(draft.startDate ? { startDate: draft.startDate } : {}),
          ...(draft.targetDate ? { targetDate: draft.targetDate } : {}),
          ...(draft.initiativeIds.length > 0
            ? { initiativeIds: draft.initiativeIds.map((id) => InitiativeId.parse(id)) }
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
  }, [draft, teamId, orgId, projectNounLower, onOpenChange, onCreated]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${projectNounLower}`}
      templateSlot={
        <ComposerTemplateControl
          orgId={orgId}
          kind="project"
          open={open}
          appliedId={appliedTemplate?.id ?? null}
          autoApplyId={defaultTemplateId}
          onApply={(chosen) => {
            applyTemplate(templatePatch(chosen.payload, 'project'), {
              id: chosen.id,
              name: chosen.name,
            });
          }}
          disabled={creating}
        />
      }
      notice={
        appliedTemplate ? (
          <AppliedTemplateNotice name={appliedTemplate.name} onUndo={undoTemplate} />
        ) : null
      }
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${projectNoun} name`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Add a description…"
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel={`Create ${projectNoun}`}
    >
      <ProjectComposerPickers
        status={draft.status}
        onStatusChange={(next) => {
          setField('status', next);
        }}
        health={draft.health}
        onHealthChange={(next) => {
          setField('health', next);
        }}
        references={{
          teams,
          teamId,
          onTeamChange: (next) => {
            setField('teamOverride', next);
          },
          actorOptions: options.actorOptions,
          leadId: draft.leadId,
          onLeadChange: (next) => {
            setField('leadId', next);
          },
          programOptions: options.programOptions,
          programId: draft.programId,
          onProgramChange: (next) => {
            setField('programId', next);
          },
          startDate: draft.startDate,
          targetDate: draft.targetDate,
          onTimelineChange: ({ start, end }) => {
            updateDraft(() => ({ startDate: start, targetDate: end }));
          },
          initiativeOptions: options.initiativeOptions,
          initiativeIds: draft.initiativeIds,
          onInitiativeToggle: toggleInitiative,
        }}
        disabled={creating}
      />
    </ComposerShell>
  );
});
