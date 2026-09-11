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
 * and status defaults to wherever the workspace starts a Project. Built on the shared
 * {@link ComposerShell} + the `@docket/ui`
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
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { type Health } from '@docket/work/capability-contract';
import { InitiativeId, ProgramId } from '@docket/work/ids';
import { type ProjectOut, type ProjectStatus } from '../../lib/contracts/project';
import { type TeamOut } from '../../lib/contracts/team';
import type { PlanningTimeframe } from '@docket/work/planning-timeframe';
import { EntityPicker } from '@docket/ui/components';
import { VocabularyProvider, useVocabulary } from '@docket/ui/hooks';
import { ChevronRight, Layers } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppRouter } from '@/lib/interactions/navigation';
import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { useComposerContinuation } from '@/components/composer/use-composer-continuation';
import { ComposerTemplateControl } from '@/components/composer/template-menu';
import type { EditorContribution } from '@/components/editor/editor-contribution';
import { useComposerDraft } from '@/components/composer/use-composer-draft';
import { templateMerge } from '@/components/templates/merge';
import { withComposerReset } from '@/components/composer/reset-on-open';
import {
  completeCreateObject,
  runConfirmedCreateCallback,
} from '@/components/create-object/create-object-completion';
import {
  type CreateProjectRequest,
  useCreateObject,
} from '@/components/create-object/create-object-provider';
import { useCreationContext } from '@/components/create-object/creation-context';
import { WorkspacePicker } from '@/components/create-object/workspace-picker';
import { useDefaultedStatus } from '@/components/entity-display/use-work-status';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { useSession } from '@/lib/auth-client';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { seedProjectRecord } from '@/lib/entity-records';
import { queryKeys } from '@/lib/query';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

import { ProjectComposerPickers } from './project-form-pickers';
import {
  type DraftMilestone,
  ProjectMilestonesField,
} from '@/components/projects/project-milestones-field';

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
  startTimeframe: PlanningTimeframe | null;
  targetTimeframe: PlanningTimeframe | null;
  initiativeIds: readonly string[];
  /**
   * Checkpoints to create alongside the Project, in the order they will be created.
   *
   * @remarks
   * A milestone needs a `projectId`, which does not exist until the Project does, so these are
   * drafts here and become records in a second pass after the create succeeds. Their position in
   * this list becomes their `sort`.
   */
  milestones: readonly DraftMilestone[];
}

/** What a pass over the drafted milestones left behind. */
interface UnsavedMilestones {
  /** The drafts that could not be created, in order, each stamped with the `sort` it was sent at. */
  readonly drafts: readonly DraftMilestone[];
  /** Why the first of them was refused, in application-owned copy, or `null` when unknown. */
  readonly reason: string | null;
}

/**
 * Create each drafted milestone against the new Project, in order.
 *
 * @remarks
 * Sequential rather than concurrent so `sort` is the position in the list and not the order the
 * network happened to settle in. One failure does not abort the rest: a later milestone can still
 * succeed, and the caller's job is to report exactly which ones did not.
 *
 * A draft that fails is returned carrying the `sort` it was *attempted* at, not its position in
 * whatever list the retry is handed. A retry runs over the survivors alone, so re-deriving the
 * position would restart numbering at zero and collide with the milestones that already landed.
 *
 * @param orgId - The org the Project was created in.
 * @param projectId - The Project the milestones belong to, as the create response returned it.
 * @param drafts - The drafted milestones, in display order.
 * @returns the drafts that could not be created, and why the first of them was refused.
 */
async function createDraftMilestones(
  orgId: string,
  projectId: ProjectOut['id'],
  drafts: readonly DraftMilestone[],
): Promise<UnsavedMilestones> {
  const unsaved: DraftMilestone[] = [];
  let reason: string | null = null;
  for (const [index, milestone] of drafts.entries()) {
    const note = milestone.description.trim();
    // Its own position the first time through, and the position it kept thereafter.
    const sort = milestone.sort ?? index;
    const attempted = { ...milestone, sort };
    try {
      const res = await api.v1.orgs[':orgId'].projects[':id'].milestones.$post({
        // Already branded: this id came back from the create, it was not typed by anyone.
        param: { orgId, id: projectId },
        json: {
          name: milestone.name,
          ...(note.length > 0 ? { description: note } : {}),
          ...(milestone.targetDate ? { targetDate: milestone.targetDate } : {}),
          sort,
        },
      });
      if (res.ok) continue;
      reason ??= userErrorMessage(
        await readProblemError(res, `Could not add ${milestone.name}.`),
        `Could not add ${milestone.name}.`,
      );
      unsaved.push(attempted);
    } catch (caught) {
      reason ??= userErrorMessage(caught, `Could not add ${milestone.name}.`);
      unsaved.push(attempted);
    }
  }
  return { drafts: unsaved, reason };
}

/**
 * Build the Project create body from the draft.
 *
 * @remarks
 * Every optional field is omitted rather than sent empty, which is a conditional spread each — so
 * this lives outside `submit` and keeps that function about the *sequence* of writes.
 *
 * @param draft - The composer's current values.
 * @param name - The trimmed project name.
 * @param teamId - The resolved destination team, or `null` to follow the org default.
 * @returns the request body.
 */
function projectCreateBody(draft: ProjectDraft, name: string, teamId: string | null) {
  const summary = draft.summary.trim();
  const description = draft.description.trim();
  return {
    name,
    ...(summary.length > 0 ? { summary } : {}),
    ...(description.length > 0 ? { description } : {}),
    ...(teamId ? { teamId: TeamId.parse(teamId) } : {}),
    ...(draft.leadId ? { leadId: ActorId.parse(draft.leadId) } : {}),
    ...(draft.programId ? { programId: ProgramId.parse(draft.programId) } : {}),
    status: draft.status,
    ...(draft.health ? { health: draft.health } : {}),
    ...(draft.startTimeframe
      ? {
          startDate: draft.startTimeframe.date,
          startDateResolution: draft.startTimeframe.resolution,
        }
      : {}),
    ...(draft.targetTimeframe
      ? {
          targetDate: draft.targetTimeframe.date,
          targetDateResolution: draft.targetTimeframe.resolution,
        }
      : {}),
    ...(draft.initiativeIds.length > 0
      ? { initiativeIds: draft.initiativeIds.map((id) => InitiativeId.parse(id)) }
      : {}),
  };
}

/**
 * The primary action's label, which changes once the Project itself is saved.
 *
 * @remarks
 * Module-level beside {@link unsavedMilestonesMessage} because it is the other half of the same
 * recovery state: the button stops offering to create a Project and starts offering to finish one.
 *
 * @param recovering - Whether the Project is committed and only its milestones are outstanding.
 * @param projectNoun - The vocabulary-skinned Project noun.
 * @returns the submit button's label.
 */
function projectSubmitLabel(recovering: boolean, projectNoun: string): string {
  return recovering ? 'Add remaining milestones' : `Create ${projectNoun}`;
}

/**
 * Application-owned copy naming the checkpoints that did not save.
 *
 * @remarks
 * "Milestone" is not vocabulary-skinned (its `ObjectDescriptor` has `vocabularyKey: null`), so the
 * noun is a literal here rather than a plumbed-through prop.
 *
 * @param unsaved - The drafts that failed and the reason the first of them was refused.
 * @returns the message shown under the composer's fields.
 */
function unsavedMilestonesMessage({ drafts, reason }: UnsavedMilestones): string {
  const names = drafts.map((milestone) => milestone.name).join(', ');
  const one = drafts.length === 1;
  const lead = `Saved everything except the milestone${one ? '' : 's'} ${names}.`;
  // The server's own reason, when it gave one — without it a refusal that a retry cannot fix reads
  // identically to a dropped connection, and the only advice on offer is to try the same thing again.
  return reason === null ? `${lead} Try again to add ${one ? 'it' : 'them'}.` : `${lead} ${reason}`;
}

/** Workspace references carried with a successful Project create for related invalidations. */
export interface ProjectCreationReferences {
  /** The Program receiving the new Project, if any. */
  readonly programId: string | null;
  /** Initiatives advanced by the new Project. */
  readonly initiativeIds: readonly string[];
}

/** Destination facts supplied by the shell-global Project host. */
export interface ProjectGlobalCreation {
  /** The currently selected destination workspace. */
  readonly targetWorkspaceId: string | null;
  /** The immutable opening workspace used to scope launcher defaults. */
  readonly initialWorkspaceId: string | null;
  /** Whether destination data and permission facts have resolved successfully. */
  readonly ready: boolean;
  /** Application-owned destination read error copy. */
  readonly loadError: string | null;
  /** Whether the signed-in member may contribute in the destination. */
  readonly canContribute: boolean;
  /** The signed-in member's Actor id in the destination, for personal templates. */
  readonly currentActorId: string | null;
  /** Complete destination-owned invalidation, callback, and routing after creation. */
  readonly onCreated: (
    project: ProjectOut,
    references: ProjectCreationReferences,
    continueCreating: boolean,
  ) => void;
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
  defaultProgramId?: string | null | undefined;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that a project was created, so it can prepend + route. */
  onCreated: (project: ProjectOut) => void;
  /** A template to apply on open, from a `?template=` compose request. */
  defaultTemplateId?: string | null | undefined;
  /** Destination facts when mounted by the shell-global creation host. */
  globalCreation?: ProjectGlobalCreation | undefined;
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
  globalCreation,
}: CreateProjectDialogProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();
  const programNoun = useVocabulary('program');
  const previousWorkspaceId = useRef(globalCreation?.targetWorkspaceId ?? null);
  const contextualRequestDefaultsApply =
    globalCreation === undefined ||
    globalCreation.targetWorkspaceId === globalCreation.initialWorkspaceId;
  const destinationReady = globalCreation?.ready ?? true;

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open && destinationReady, null);
  const planningCalendar = useFiscalYearStartMonth(orgId, open && destinationReady);
  const { draft, setField, updateDraft } = useComposerDraft<ProjectDraft>({
    name: '',
    summary: '',
    description: '',
    teamOverride: null,
    leadId: null,
    programId: contextualRequestDefaultsApply ? (defaultProgramId ?? null) : null,
    status: 'planned',
    health: null,
    startTimeframe: null,
    targetTimeframe: null,
    initiativeIds: [],
    milestones: [],
  });

  useDefaultedStatus('project', draft.status, (key) => {
    setField('status', key);
  });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The Project once it exists but its milestones do not — see `attachMilestones`.
  const [committed, setCommitted] = useState<ProjectOut | null>(null);
  // Past the point of no return: the Project is saved and the composer is now a milestone retry.
  const recovering = committed !== null;
  const continuation = useComposerContinuation({
    creating,
    successMessage: `${projectNoun} created. Ready to create another.`,
  });

  const teamId = draft.teamOverride ?? defaultTeamId;
  const templateContribution = useMemo<EditorContribution>(
    () => ({
      id: 'composer-description-templates-project',
      renderEmptyAction: () => (
        <ComposerTemplateControl
          orgId={orgId}
          kind="project"
          open={open && destinationReady}
          autoApplyId={contextualRequestDefaultsApply ? defaultTemplateId : null}
          currentActorId={globalCreation?.currentActorId}
          teamId={globalCreation === undefined ? undefined : teamId}
          inline
          onManage={
            globalCreation === undefined
              ? undefined
              : () => {
                  onOpenChange(false);
                }
          }
          onApply={(chosen) => {
            updateDraft((current) =>
              templateMerge(current, templatePatch(chosen.payload, 'project'), {
                document: 'description',
                labels: ['name', 'summary'],
              }),
            );
          }}
          disabled={creating || !destinationReady}
        />
      ),
    }),
    [
      contextualRequestDefaultsApply,
      creating,
      defaultTemplateId,
      destinationReady,
      globalCreation,
      onOpenChange,
      open,
      orgId,
      teamId,
      updateDraft,
    ],
  );

  // Keep portable copy, dates, and generic enum choices when the destination changes, but never
  // carry a Team, person, Program, or Initiative id into a workspace that cannot own that row.
  useEffect(() => {
    if (globalCreation === undefined) return;
    const previousTargetWorkspaceId = previousWorkspaceId.current;
    if (previousTargetWorkspaceId === globalCreation.targetWorkspaceId) return;
    previousWorkspaceId.current = globalCreation.targetWorkspaceId;
    // A null-to-opening transition is the shell resolving its immutable workspace, not a retarget.
    // Preserve contextual defaults that are valid only in that opening workspace.
    if (
      previousTargetWorkspaceId === null &&
      globalCreation.targetWorkspaceId !== null &&
      globalCreation.targetWorkspaceId === globalCreation.initialWorkspaceId
    ) {
      return;
    }
    setError(null);
    updateDraft(() => ({
      teamOverride: null,
      leadId: null,
      programId: null,
      initiativeIds: [],
      startTimeframe: draft.startTimeframe?.resolution ? null : draft.startTimeframe,
      targetTimeframe: draft.targetTimeframe?.resolution ? null : draft.targetTimeframe,
    }));
  }, [draft.startTimeframe, draft.targetTimeframe, globalCreation, updateDraft]);

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

  const canSubmit =
    draft.name.trim().length > 0 &&
    !teamsLoading &&
    destinationReady &&
    (globalCreation?.canContribute ?? true);

  /**
   * Create the drafted milestones against a Project that now exists.
   *
   * @remarks
   * On a partial failure the Project is real and only the checkpoints are missing. Reporting
   * success would be a lie, and resubmitting the whole form would create a *second* Project — so
   * the create is remembered in `committed`, the draft is narrowed to just the milestones that did
   * not land, and the next submit retries only those.
   *
   * @param project - The Project the milestones belong to.
   * @returns whether every drafted milestone was created.
   */
  const attachMilestones = useCallback(
    async (project: ProjectOut): Promise<boolean> => {
      const unsaved = await createDraftMilestones(orgId, project.id, draft.milestones);
      if (unsaved.drafts.length === 0) return true;
      setCommitted(project);
      updateDraft(() => ({ milestones: unsaved.drafts }));
      setError(unsavedMilestonesMessage(unsaved));
      return false;
    },
    [draft.milestones, orgId, updateDraft],
  );

  /**
   * Tell the host a Project exists, which is what makes it real to the rest of the app.
   *
   * @remarks
   * Separate from closing on purpose. A Project committed while its milestones are still
   * outstanding must reach the host whether the person retries or simply leaves — without this the
   * record seed and every invalidation are skipped, and a Project that exists on the server is
   * absent from the Projects list until a full reload.
   */
  const reportCreated = useCallback(
    (project: ProjectOut, continueCreating: boolean): void => {
      if (globalCreation !== undefined) {
        globalCreation.onCreated(
          project,
          { programId: draft.programId, initiativeIds: draft.initiativeIds },
          continueCreating,
        );
        return;
      }
      runConfirmedCreateCallback(() => {
        onCreated(project);
      });
    },
    [draft.initiativeIds, draft.programId, globalCreation, onCreated],
  );

  /** Report a committed Project on the way out, when the person leaves mid-retry. */
  const handleDismiss = useCallback((): void => {
    if (committed === null) return;
    setCommitted(null);
    reportCreated(committed, false);
  }, [committed, reportCreated]);

  /** Hand the finished Project to the parent and either reset for another or close. */
  const finishCreate = useCallback(
    (project: ProjectOut, continueCreating: boolean): void => {
      reportCreated(project, continueCreating);
      if (continueCreating) {
        continuation.completeContinuation(() => {
          updateDraft(() => ({ name: '', summary: '', description: '', milestones: [] }));
        });
        return;
      }
      onOpenChange(false);
    },
    [continuation, onOpenChange, reportCreated, updateDraft],
  );

  /**
   * Create the project with all set properties, then its milestones, then hand it to the parent.
   *
   * @remarks
   * Two writes, and the second can fail on its own. Once the Project is committed it is held in
   * `committed` so a retry adds only the milestones that did not land rather than creating a second
   * Project — the submit button is a recovery action from that point on, not a create.
   */
  const submit = useCallback(
    async (continueCreating = false): Promise<void> => {
      const trimmed = draft.name.trim();
      if (trimmed.length === 0 || !canSubmit || !continuation.beginSubmission()) return;
      setCreating(true);
      setError(null);
      try {
        if (committed !== null) {
          if (await attachMilestones(committed)) {
            setCommitted(null);
            finishCreate(committed, continueCreating);
          }
          return;
        }
        const res = await api.v1.orgs[':orgId'].projects.$post({
          param: { orgId },
          json: projectCreateBody(draft, trimmed, teamId),
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
        if (await attachMilestones(created)) finishCreate(created, continueCreating);
      } catch (caught) {
        setError(
          userErrorMessage(caught, `Something went wrong creating the ${projectNounLower}.`),
        );
      } finally {
        continuation.finishSubmission();
        setCreating(false);
      }
    },
    [
      attachMilestones,
      canSubmit,
      committed,
      continuation,
      draft,
      finishCreate,
      teamId,
      orgId,
      projectNounLower,
      updateDraft,
    ],
  );

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${projectNounLower}`}
      propertyAriaLabel={`${projectNoun} properties`}
      contextRow={
        globalCreation ? (
          <>
            <EntityMetadataItem priority={0} className="max-w-none">
              <WorkspacePicker disabled={creating} />
            </EntityMetadataItem>
            <EntityMetadataItem priority={1} className="flex max-w-none gap-2">
              <ChevronRight aria-hidden className="text-on-surface-variant size-4 shrink-0" />
              <EntityPicker
                options={options.programOptions}
                value={draft.programId}
                onChange={(next) => {
                  setField('programId', next);
                }}
                placeholder={`No ${programNoun.toLowerCase()}`}
                triggerIcon={<Layers className="text-on-surface-variant size-4" />}
                clearLabel={`No ${programNoun.toLowerCase()}`}
                searchPlaceholder={`Search ${programNoun.toLowerCase()}s…`}
                ariaLabel={programNoun}
                disabled={creating || !destinationReady}
              />
            </EntityMetadataItem>
          </>
        ) : undefined
      }
      continuation={{
        checked: continuation.createMore,
        onCheckedChange: continuation.setCreateMore,
        onSubmit: () => {
          void submit(true);
        },
      }}
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titleInputRef={continuation.titleInputRef}
      titlePlaceholder={`${projectNoun} name`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={draft.description}
      bodyResetKey={continuation.bodyResetGeneration}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Add a description"
      bodyContributions={[templateContribution]}
      mentionOrgId={orgId}
      trailingFields={
        <ProjectMilestonesField
          value={draft.milestones}
          onChange={(milestones) => {
            setField('milestones', milestones);
          }}
        />
      }
      error={error ?? planningCalendar.error ?? globalCreation?.loadError ?? null}
      statusMessage={continuation.statusMessage}
      creating={creating}
      onDismiss={handleDismiss}
      // Once the Project is committed the draft is no longer a draft: closing must not offer to
      // discard it, and the Project's own fields are locked because editing them here can no longer
      // save anything. The milestone field stays live — it is the outstanding work, and the shell
      // keeps its trailing fields out of `contentDisabled` for exactly that reason.
      draftCommitted={recovering}
      contentDisabled={recovering}
      canSubmit={canSubmit}
      onSubmit={() => void submit(continuation.createMore)}
      submitLabel={projectSubmitLabel(recovering, projectNoun)}
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
            // Template eligibility is derived directly from `teamId`; changing this value clears
            // the only stored team reference and immediately re-filters team-scoped templates.
            setField('teamOverride', next);
          },
          actorOptions: options.actorOptions,
          leadId: draft.leadId,
          onLeadChange: (next) => {
            setField('leadId', next);
          },
          programOptions: options.programOptions,
          programId: draft.programId,
          showProgram: globalCreation === undefined,
          onProgramChange: (next) => {
            setField('programId', next);
          },
          startTimeframe: draft.startTimeframe,
          targetTimeframe: draft.targetTimeframe,
          fiscalYearStartMonth: planningCalendar.fiscalYearStartMonth,
          planningCalendarLoading: planningCalendar.loading,
          onTimelineChange: ({ start, target }) => {
            updateDraft(() => ({ startTimeframe: start, targetTimeframe: target }));
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

/** Mount the Project body only for an active shell-global Project request. */
export function GlobalProjectComposer(): JSX.Element | null {
  const { request, closeCreate } = useCreateObject();

  if (request?.kind !== 'project') return null;

  return <GlobalProjectComposerDialog request={request} closeCreate={closeCreate} />;
}

/** Props for the request-bound Project body. */
interface GlobalProjectComposerDialogProps {
  /** The active Project request. */
  readonly request: CreateProjectRequest;
  /** Close the shell-global create request. */
  readonly closeCreate: () => void;
}

/** Apply the destination vocabulary before resolving labels inside the Project body. */
function GlobalProjectComposerDialog({
  request,
  closeCreate,
}: GlobalProjectComposerDialogProps): JSX.Element {
  const creation = useCreationContext();

  return (
    <VocabularyProvider skin={creation.vocabulary}>
      <GlobalProjectComposerBody request={request} closeCreate={closeCreate} />
    </VocabularyProvider>
  );
}

/** Bind Project reads, writes, completion, and invalidation to the selected destination. */
function GlobalProjectComposerBody({
  request,
  closeCreate,
}: GlobalProjectComposerDialogProps): JSX.Element {
  const creation = useCreationContext();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  // The responsive seam rather than Next's router: it publishes the requested destination
  // immediately, which is what lets the shell acknowledge the click while the route payload
  // is still in flight. Navigation itself is unchanged.
  const router = useAppRouter();
  const projectNoun = useVocabulary('project');

  const targetWorkspaceId = creation.targetWorkspaceId;
  const initialWorkspaceId = request.initialWorkspaceId ?? null;
  const projectOrgId = targetWorkspaceId ?? initialWorkspaceId ?? '';
  const targetIsOriginalWorkspace = targetWorkspaceId === initialWorkspaceId;
  const currentActorId =
    creation.members.find((member) => member.userId === session?.user.id)?.actorId ?? null;
  const destinationReady =
    initialWorkspaceId !== null &&
    targetWorkspaceId !== null &&
    creation.workspace !== null &&
    !creation.loading &&
    !creation.permissions.loading &&
    creation.loadError === null;

  return (
    <CreateProjectDialog
      orgId={projectOrgId}
      projectNoun={projectNoun}
      teams={creation.teams}
      defaultTeamId={creation.defaultTeamId}
      teamsLoading={creation.loading || creation.permissions.loading}
      defaultProgramId={targetIsOriginalWorkspace ? request.defaultProgramId : null}
      defaultTemplateId={targetIsOriginalWorkspace ? request.defaultTemplateId : null}
      open
      onOpenChange={(next) => {
        if (!next) closeCreate();
      }}
      onCreated={() => undefined}
      globalCreation={{
        targetWorkspaceId,
        initialWorkspaceId,
        ready: destinationReady,
        loadError: creation.loadError,
        canContribute: creation.permissions.canContribute,
        currentActorId,
        onCreated: (project, references, continueCreating) => {
          completeCreateObject({
            created: project,
            initialWorkspaceId,
            targetWorkspaceId,
            sameWorkspaceCompletion: request.sameWorkspaceCompletion,
            onCreated: request.onCreated,
            invalidationKeys: [queryKeys.portfolio()],
            invalidate: (queryKey) => {
              void queryClient.invalidateQueries({ queryKey });
            },
            navigationEnabled: !continueCreating,
            seed: () => {
              seedProjectRecord(queryClient, projectOrgId, project);
            },
            openDestination: () => {
              router.push(`/orgs/${projectOrgId}/projects/${project.id}`);
            },
          });
          void invalidateWorkTargetQueries(queryClient, {
            target: 'project',
            ownerOrganizationId: projectOrgId,
          });
          if (references.programId !== null) {
            void invalidateWorkTargetQueries(queryClient, {
              target: 'program',
              ownerOrganizationId: projectOrgId,
            });
          }
          if (references.initiativeIds.length > 0) {
            void invalidateWorkTargetQueries(queryClient, {
              target: 'initiative',
              ownerOrganizationId: projectOrgId,
            });
          }
        },
      }}
    />
  );
}
