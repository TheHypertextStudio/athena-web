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
import { EntityPicker } from '@docket/ui/components';
import { VocabularyProvider, useVocabulary } from '@docket/ui/hooks';
import { ChevronRight, Layers } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { ComposerTemplateControl } from '@/components/composer/template-menu';
import { templateMerge, useComposerDraft } from '@/components/composer/use-composer-draft';
import { withComposerReset } from '@/components/composer/reset-on-open';
import {
  type CreateProjectRequest,
  useCreateObject,
} from '@/components/create-object/create-object-provider';
import { useCreationContext } from '@/components/create-object/creation-context';
import { WorkspacePicker } from '@/components/create-object/workspace-picker';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { useSession } from '@/lib/auth-client';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { queryKeys } from '@/lib/query';

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
  readonly onCreated: (project: ProjectOut, references: ProjectCreationReferences) => void;
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
  /** Destination facts when mounted by the shell-global creation host. */
  globalCreation?: ProjectGlobalCreation;
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

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open && destinationReady);
  const { draft, setField, updateDraft } = useComposerDraft<ProjectDraft>({
    name: '',
    summary: '',
    description: '',
    teamOverride: null,
    leadId: null,
    programId: contextualRequestDefaultsApply ? (defaultProgramId ?? null) : null,
    status: 'planned',
    health: null,
    startDate: null,
    targetDate: null,
    initiativeIds: [],
  });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyTemplateSlotVisible, setLegacyTemplateSlotVisible] = useState(false);

  const teamId = draft.teamOverride ?? defaultTeamId;

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
    }));
  }, [globalCreation, updateDraft]);

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

  /** Create the project with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = draft.name.trim();
    if (trimmed.length === 0 || !canSubmit) return;
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
      if (globalCreation !== undefined) {
        globalCreation.onCreated(created, {
          programId: draft.programId,
          initiativeIds: draft.initiativeIds,
        });
      }
      onOpenChange(false);
      if (globalCreation === undefined) onCreated(created);
    } catch (caught) {
      setError(userErrorMessage(caught, `Something went wrong creating the ${projectNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [canSubmit, draft, globalCreation, teamId, orgId, projectNounLower, onOpenChange, onCreated]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${projectNounLower}`}
      contextRow={
        globalCreation ? (
          <>
            <WorkspacePicker disabled={creating} />
            <ChevronRight aria-hidden className="text-on-surface-variant size-4 shrink-0" />
            <EntityPicker
              options={options.programOptions}
              value={draft.programId}
              onChange={(next) => {
                setField('programId', next);
              }}
              placeholder={`Set ${programNoun.toLowerCase()}`}
              triggerIcon={<Layers className="text-on-surface-variant size-4" />}
              clearLabel={`No ${programNoun.toLowerCase()}`}
              searchPlaceholder={`Search ${programNoun.toLowerCase()}s…`}
              ariaLabel={programNoun}
              disabled={creating || !destinationReady}
            />
            <ComposerTemplateControl
              orgId={orgId}
              kind="project"
              open={open && destinationReady}
              autoApplyId={contextualRequestDefaultsApply ? defaultTemplateId : null}
              currentActorId={globalCreation.currentActorId}
              teamId={teamId}
              leadingSeparator={
                <ChevronRight aria-hidden className="text-on-surface-variant size-4 shrink-0" />
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
          </>
        ) : undefined
      }
      templateSlotVisible={globalCreation === undefined ? legacyTemplateSlotVisible : undefined}
      templateSlot={
        globalCreation === undefined ? (
          <ComposerTemplateControl
            orgId={orgId}
            kind="project"
            open={open}
            autoApplyId={defaultTemplateId}
            onVisibilityChange={setLegacyTemplateSlotVisible}
            onApply={(chosen) => {
              updateDraft((current) =>
                templateMerge(current, templatePatch(chosen.payload, 'project'), {
                  document: 'description',
                  labels: ['name', 'summary'],
                }),
              );
            }}
            disabled={creating}
          />
        ) : undefined
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
      error={error ?? globalCreation?.loadError ?? null}
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
  const router = useRouter();
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

  const invalidateTargetProjectCaches = useCallback(
    (workspaceId: string | null, references: ProjectCreationReferences): void => {
      if (workspaceId === null) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolio() });
      if (references.programId !== null) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.programs(workspaceId) });
      }
      if (references.initiativeIds.length > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.initiatives(workspaceId) });
      }
    },
    [queryClient],
  );

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
        onCreated: (project, references) => {
          invalidateTargetProjectCaches(targetWorkspaceId, references);
          if (targetIsOriginalWorkspace) request.onCreated?.(project);
          if (!targetIsOriginalWorkspace || request.sameWorkspaceCompletion === 'open') {
            router.push(`/orgs/${projectOrgId}/projects/${project.id}`);
          }
        },
      }}
    />
  );
}
