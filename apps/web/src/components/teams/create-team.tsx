'use client';

/**
 * The robust "New team" create composer for the Teams list.
 *
 * @remarks
 * A Team is a first-class unit that owns its own workflow states, cycles, and Triage queue.
 * Creating one needs a display name (the title) and a short, org-unique `key` (the prefix that
 * fronts the team's identifiers, e.g. "ENG"); the key is auto-suggested from the name and stays
 * editable. The composer additionally captures the team's framing fields: a description body, a
 * Triage toggle (a team's intake queue, on by default), and optional agent guidance (a short brief
 * the team's agents follow). The team is created with the API's default five-state workflow. Built
 * on the shared {@link ComposerShell}; the key + Triage controls sit in its property strip.
 *
 * The dialog is *controlled* by the host page so its header "New team" button and empty-state CTA
 * open the *same* dialog. Teams have no detail route, so on success the parent simply prepends the
 * new row via {@link CreateTeamDialogProps.onCreated}; this component closes the dialog itself.
 *
 * Every field lives in one {@link useComposerDraft} value, which is what lets a saved draft be
 * poured back in as one patch.
 */
import type { TeamOut } from '../../lib/contracts/team';
import { VocabularyProvider, useVocabulary } from '@docket/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useState } from 'react';

import { useAppRouter } from '@/lib/interactions/navigation';
import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { useComposerContinuation } from '@/components/composer/use-composer-continuation';
import { useComposerDraft } from '@/components/composer/use-composer-draft';
import { withComposerReset } from '@/components/composer/reset-on-open';
import {
  completeCreateObject,
  runConfirmedCreateCallback,
} from '@/components/create-object/create-object-completion';
import {
  type CreateTeamRequest,
  useCreateObject,
} from '@/components/create-object/create-object-provider';
import { useCreationContext } from '@/components/create-object/creation-context';
import { useResumeDraft } from '@/components/create-object/use-resume-draft';
import { WorkspacePicker } from '@/components/create-object/workspace-picker';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { queryKeys } from '@/lib/query';

import { TeamComposerFields } from './team-composer-fields';
import { teamNamePatch } from './team-draft-codec';
import { useTeamDraftPersistence } from './use-team-draft-persistence';

/** Every field the team composer holds, as one value. */
export interface TeamDraft {
  name: string;
  /** The short identifier prefix, uppercase. */
  key: string;
  /** Whether the person edited the key directly, after which the name stops deriving it. */
  keyDirty: boolean;
  summary: string;
  description: string;
  triageEnabled: boolean;
  agentGuidance: string;
}

/** The draft a freshly-opened composer starts from. */
const EMPTY_TEAM_DRAFT: TeamDraft = {
  name: '',
  key: '',
  keyDirty: false,
  summary: '',
  description: '',
  triageEnabled: true,
  agentGuidance: '',
};

/** The text a "Create more" continuation clears; the Triage choice carries over. */
const CONTINUATION_RESET: Partial<TeamDraft> = {
  name: '',
  key: '',
  keyDirty: false,
  summary: '',
  description: '',
  agentGuidance: '',
};

/** Destination facts supplied by the shell-global Team host. */
export interface TeamGlobalCreation {
  /** Whether destination data and permission facts have resolved successfully. */
  readonly ready: boolean;
  /** Application-owned destination read error copy. */
  readonly loadError: string | null;
  /** Whether the signed-in member may manage the destination. */
  readonly canManage: boolean;
  /** Complete destination-owned invalidation, callback, and routing after creation. */
  readonly onCreated: (team: TeamOut, continueCreating: boolean) => void;
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
  /** Destination vocabulary label; omitted by legacy mounts to preserve their current API. */
  teamNoun?: string | undefined;
  /** A saved draft to reopen on mount. */
  resumeDraftId?: string | null | undefined;
  /** Receives the id of the draft row being written, and null once there is none. */
  onDraftIdChange?: ((draftId: string | null) => void) | undefined;
  /** Destination facts when mounted by the shell-global creation host. */
  globalCreation?: TeamGlobalCreation | undefined;
}

/**
 * The robust team-create composer dialog.
 *
 * @param props - The {@link CreateTeamDialogProps}.
 * @returns the rendered composer.
 */
export const CreateTeamDialog = withComposerReset(function CreateTeamComposer({
  orgId,
  open,
  onOpenChange,
  onCreated,
  teamNoun = 'Team',
  resumeDraftId,
  onDraftIdChange,
  globalCreation,
}: CreateTeamDialogProps): JSX.Element {
  const teamNounLower = teamNoun.toLowerCase();
  const destinationReady = globalCreation?.ready ?? true;

  const { draft, setField, updateDraft } = useComposerDraft<TeamDraft>(EMPTY_TEAM_DRAFT);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continuation = useComposerContinuation({
    creating,
    successMessage: `${teamNoun} created. Ready to create another.`,
  });
  const persistence = useTeamDraftPersistence({
    orgId,
    open,
    destinationReady,
    draft,
    updateDraft,
    resumeDraftId,
    onDraftIdChange,
  });

  /** Update the name, keeping the key in sync until the user takes the key over. */
  const onNameChange = useCallback(
    (next: string): void => {
      updateDraft((current) => teamNamePatch(current, next));
    },
    [updateDraft],
  );

  const canSubmit =
    draft.name.trim().length > 0 &&
    draft.key.trim().length > 0 &&
    destinationReady &&
    (globalCreation?.canManage ?? true);

  /** Create the team with the default workflow, then prepend it via the parent. */
  const submit = useCallback(
    async (continueCreating = false): Promise<void> => {
      if (!canSubmit || !continuation.beginSubmission()) return;
      setCreating(true);
      setError(null);
      try {
        const trimmedDescription = draft.description.trim();
        const trimmedGuidance = draft.agentGuidance.trim();
        const res = await api.v1.orgs[':orgId'].teams.$post({
          param: { orgId },
          json: {
            name: draft.name.trim(),
            key: draft.key.trim().toUpperCase(),
            triageEnabled: draft.triageEnabled,
            ...(draft.summary.trim().length > 0 ? { summary: draft.summary.trim() } : {}),
            ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
            ...(trimmedGuidance.length > 0 ? { agentGuidance: trimmedGuidance } : {}),
          },
        });
        if (!res.ok) {
          setError(
            userErrorMessage(
              await readProblemError(res, `Could not create the ${teamNounLower}.`),
              `Could not create the ${teamNounLower}.`,
            ),
          );
          return;
        }
        const created = await res.json();
        await persistence.commit();
        if (globalCreation !== undefined) {
          globalCreation.onCreated(created, continueCreating);
        } else {
          runConfirmedCreateCallback(() => {
            onCreated(created);
          });
        }
        if (continueCreating) {
          continuation.completeContinuation(() => {
            updateDraft(() => CONTINUATION_RESET);
          });
          return;
        }
        onOpenChange(false);
      } catch (caught) {
        setError(userErrorMessage(caught, `Something went wrong creating the ${teamNounLower}.`));
      } finally {
        continuation.finishSubmission();
        setCreating(false);
      }
    },
    [
      canSubmit,
      draft,
      orgId,
      onOpenChange,
      onCreated,
      globalCreation,
      persistence,
      teamNounLower,
      continuation,
      updateDraft,
    ],
  );

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${teamNounLower}`}
      contextRow={
        globalCreation ? (
          <EntityMetadataItem priority={0} className="max-w-none">
            <WorkspacePicker disabled={creating} />
          </EntityMetadataItem>
        ) : undefined
      }
      propertyLayout="freeform"
      continuation={{
        checked: continuation.createMore,
        onCheckedChange: continuation.setCreateMore,
        onSubmit: () => {
          void submit(true);
        },
      }}
      title={draft.name}
      onTitleChange={onNameChange}
      titleInputRef={continuation.titleInputRef}
      titlePlaceholder={`${teamNoun} name`}
      summary={draft.summary}
      onSummaryChange={(next) => {
        setField('summary', next);
      }}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={draft.description}
      bodyResetKey={`${String(continuation.bodyResetGeneration)}:${String(persistence.loadGeneration)}`}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder={`What does this ${teamNounLower} own? (optional)`}
      mentionOrgId={orgId}
      error={error ?? globalCreation?.loadError ?? null}
      drafts={persistence.controls}
      draftNoun={teamNounLower}
      statusMessage={continuation.statusMessage}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit(continuation.createMore)}
      submitLabel={`Create ${teamNounLower}`}
    >
      <TeamComposerFields
        draft={draft}
        teamNoun={teamNoun}
        disabled={creating}
        setField={setField}
        updateDraft={updateDraft}
      />
    </ComposerShell>
  );
});

/** Mount the Team body only for an active shell-global Team request. */
export function GlobalTeamComposer(): JSX.Element | null {
  const { request, closeCreate } = useCreateObject();

  if (request?.kind !== 'team') return null;

  return <GlobalTeamComposerDialog request={request} closeCreate={closeCreate} />;
}

/** Props for the request-bound Team body. */
interface GlobalTeamComposerDialogProps {
  /** The active Team request. */
  readonly request: CreateTeamRequest;
  /** Close the shell-global create request. */
  readonly closeCreate: () => void;
}

/** Apply destination vocabulary before resolving labels inside the Team body. */
function GlobalTeamComposerDialog({
  request,
  closeCreate,
}: GlobalTeamComposerDialogProps): JSX.Element {
  const creation = useCreationContext();

  return (
    <VocabularyProvider skin={creation.vocabulary}>
      <GlobalTeamComposerBody request={request} closeCreate={closeCreate} />
    </VocabularyProvider>
  );
}

/** Bind Team writes, completion, and invalidation to the selected destination. */
function GlobalTeamComposerBody({
  request,
  closeCreate,
}: GlobalTeamComposerDialogProps): JSX.Element {
  const creation = useCreationContext();
  const queryClient = useQueryClient();
  // The responsive seam rather than Next's router: it publishes the requested destination
  // immediately, which is what lets the shell acknowledge the click while the route payload
  // is still in flight. Navigation itself is unchanged.
  const router = useAppRouter();
  const teamNoun = useVocabulary('team');

  const targetWorkspaceId = creation.targetWorkspaceId;
  const initialWorkspaceId = request.initialWorkspaceId ?? null;
  const teamOrgId = targetWorkspaceId ?? initialWorkspaceId ?? '';
  const destinationReady =
    initialWorkspaceId !== null &&
    targetWorkspaceId !== null &&
    creation.workspace !== null &&
    !creation.loading &&
    !creation.permissions.loading &&
    creation.loadError === null;
  const { setActiveDraftId } = useCreateObject();
  const resume = useResumeDraft('team', request.draftId, targetWorkspaceId, destinationReady);

  return (
    <CreateTeamDialog
      orgId={teamOrgId}
      teamNoun={teamNoun}
      open
      onOpenChange={(next) => {
        if (!next) closeCreate();
      }}
      onCreated={() => undefined}
      resumeDraftId={resume.draftId}
      onDraftIdChange={setActiveDraftId}
      globalCreation={{
        ready: resume.ready,
        loadError: creation.loadError,
        canManage: creation.permissions.canManage,
        onCreated: (team, continueCreating) => {
          completeCreateObject({
            created: team,
            initialWorkspaceId,
            targetWorkspaceId,
            sameWorkspaceCompletion: 'open',
            onCreated: request.onCreated,
            invalidationKeys: [queryKeys.teams(teamOrgId)],
            invalidate: (queryKey) => {
              void queryClient.invalidateQueries({ queryKey });
            },
            navigationEnabled: !continueCreating,
            openDestination: () => {
              router.push(`/orgs/${teamOrgId}/teams`);
            },
          });
        },
      }}
    />
  );
}
