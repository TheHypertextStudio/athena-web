'use client';

/**
 * The "New {initiative}" create composer for the Initiatives list.
 *
 * @remarks
 * An Initiative is a cross-cutting *theme* that holds no work of its own — it associates
 * many-to-many with Projects + Programs (those links come later on the detail screen). The
 * composer captures the framing fields: a title + description body, and an inline strip of
 * compact pickers for its owner, status, target date, and health. Sensible
 * defaults keep it fast: only a name is required; status defaults to wherever the workspace starts
 * an Initiative.
 *
 * The dialog is *controlled* by the host page so its header "New {initiative}" button and
 * empty-state CTA open the *same* dialog. Its fields live in one {@link useComposerDraft} value,
 * which is what lets a template fill all of them in one action and lets that action be undone.
 * {@link withComposerReset} scopes the whole draft to a single open, so every open starts pristine
 * however the previous one ended.
 *
 * The template control sits in the top row, not among the property pills — see
 * {@link TemplateMenu} for why. Applying a template merges its fields and offers an inline undo;
 * it never silently discards typed text, which the previous three-button strip did on every click.
 *
 * @see {@link useComposerOptions} for the owner option source.
 */
import {
  ActorId,
  type Health,
  type InitiativeOut,
  type InitiativePriority,
  type InitiativeStatus,
  type InitiativeUpdateCadence,
} from '@docket/types';
import type { PlanningTimeframe } from '@docket/work/planning-timeframe';
import { ActorPicker } from '@docket/ui/components';
import { VocabularyProvider, useVocabulary } from '@docket/ui/hooks';
import { ChevronRight } from '@docket/ui/icons';
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
  type CreateInitiativeRequest,
  useCreateObject,
} from '@/components/create-object/create-object-provider';
import { useCreationContext } from '@/components/create-object/creation-context';
import { WorkspacePicker } from '@/components/create-object/workspace-picker';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { useDefaultedStatus } from '@/components/entity-display/use-work-status';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { useSession } from '@/lib/auth-client';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { seedInitiativeRecord } from '@/lib/entity-records';
import { queryKeys } from '@/lib/query';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';

import { InitiativeComposerPickers } from './initiative-form-pickers';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors'] as const;

/** Every field the initiative composer holds, as one value. */
export interface InitiativeDraft {
  name: string;
  summary: string;
  description: string;
  ownerId: string | null;
  status: InitiativeStatus;
  targetTimeframe: PlanningTimeframe | null;
  health: Health | null;
  priority: InitiativePriority;
  updateCadence: InitiativeUpdateCadence;
}

/** The draft a freshly-opened composer starts from. */
export const EMPTY_INITIATIVE_DRAFT: InitiativeDraft = {
  name: '',
  summary: '',
  description: '',
  ownerId: null,
  status: 'active',
  targetTimeframe: null,
  health: null,
  priority: 'none',
  updateCadence: 'monthly',
};

/** Destination facts supplied by the shell-global Initiative host. */
export interface InitiativeGlobalCreation {
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
  readonly onCreated: (initiative: InitiativeOut, continueCreating: boolean) => void;
}

/** Props for {@link CreateInitiativeDialog}. */
export interface CreateInitiativeDialogProps {
  /** The org the initiative is created in (from the route). */
  orgId: string;
  /** The singular, vocabulary-skinned initiative noun (e.g. "Initiative", "Theme"). */
  initiativeNoun: string;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that an initiative was created, so it can route to its detail. */
  onCreated: (initiative: InitiativeOut) => void;
  /** A template to apply on open, from a `?template=` compose request. */
  defaultTemplateId?: string | null | undefined;
  /** Destination facts when mounted by the shell-global creation host. */
  globalCreation?: InitiativeGlobalCreation | undefined;
}

/**
 * The initiative-create composer dialog.
 *
 * @param props - The {@link CreateInitiativeDialogProps}.
 * @returns the rendered composer.
 */
export const CreateInitiativeDialog = withComposerReset(function CreateInitiativeComposer({
  orgId,
  initiativeNoun,
  open,
  onOpenChange,
  onCreated,
  defaultTemplateId = null,
  globalCreation,
}: CreateInitiativeDialogProps): JSX.Element {
  const initiativeNounLower = initiativeNoun.toLowerCase();
  const previousWorkspaceId = useRef(globalCreation?.targetWorkspaceId ?? null);
  const contextualRequestDefaultsApply =
    globalCreation === undefined ||
    globalCreation.targetWorkspaceId === globalCreation.initialWorkspaceId;
  const destinationReady = globalCreation?.ready ?? true;

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open && destinationReady);
  const planningCalendar = useFiscalYearStartMonth(orgId, open && destinationReady);
  const { draft, setField, updateDraft } =
    useComposerDraft<InitiativeDraft>(EMPTY_INITIATIVE_DRAFT);

  useDefaultedStatus('initiative', draft.status, (key) => {
    setField('status', key);
  });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continuation = useComposerContinuation({
    creating,
    successMessage: `${initiativeNoun} created. Ready to create another.`,
  });
  const templateContribution = useMemo<EditorContribution>(
    () => ({
      id: 'composer-description-templates-initiative',
      renderEmptyAction: () => (
        <ComposerTemplateControl
          orgId={orgId}
          kind="initiative"
          open={open && destinationReady}
          autoApplyId={contextualRequestDefaultsApply ? defaultTemplateId : null}
          currentActorId={globalCreation?.currentActorId}
          teamId={globalCreation === undefined ? undefined : null}
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
              templateMerge(current, templatePatch(chosen.payload, 'initiative'), {
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
      updateDraft,
    ],
  );

  // Exact days are portable. Broad periods are not because their fiscal basis belongs to the
  // previous workspace, so a retarget clears those along with the prior workspace's person id.
  useEffect(() => {
    if (globalCreation === undefined) return;
    const previousTargetWorkspaceId = previousWorkspaceId.current;
    if (previousTargetWorkspaceId === globalCreation.targetWorkspaceId) return;
    previousWorkspaceId.current = globalCreation.targetWorkspaceId;
    if (
      previousTargetWorkspaceId === null &&
      globalCreation.targetWorkspaceId !== null &&
      globalCreation.targetWorkspaceId === globalCreation.initialWorkspaceId
    ) {
      return;
    }
    setError(null);
    updateDraft(() => ({
      ownerId: null,
      targetTimeframe: draft.targetTimeframe?.resolution ? null : draft.targetTimeframe,
    }));
  }, [draft.targetTimeframe, globalCreation, updateDraft]);

  const canSubmit =
    draft.name.trim().length > 0 && destinationReady && (globalCreation?.canContribute ?? true);

  /** Create the theme with all set properties, then hand it to the parent. */
  const submit = useCallback(
    async (continueCreating = false): Promise<void> => {
      const trimmed = draft.name.trim();
      if (trimmed.length === 0 || !canSubmit || !continuation.beginSubmission()) return;
      setCreating(true);
      setError(null);
      try {
        const trimmedBody = draft.description.trim();
        const res = await api.v1.orgs[':orgId'].initiatives.$post({
          param: { orgId },
          json: {
            name: trimmed,
            ...(draft.summary.trim() ? { summary: draft.summary.trim() } : {}),
            status: draft.status,
            priority: draft.priority,
            updateCadence: draft.updateCadence,
            ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
            ...(draft.ownerId ? { ownerId: ActorId.parse(draft.ownerId) } : {}),
            ...(draft.targetTimeframe
              ? {
                  targetDate: draft.targetTimeframe.date,
                  targetDateResolution: draft.targetTimeframe.resolution,
                }
              : {}),
            ...(draft.health ? { health: draft.health } : {}),
          },
        });
        if (!res.ok) {
          setError(
            userErrorMessage(
              await readProblemError(res, `Could not create the ${initiativeNounLower}.`),
              `Could not create the ${initiativeNounLower}.`,
            ),
          );
          return;
        }
        const created = await res.json();
        if (globalCreation !== undefined) {
          globalCreation.onCreated(created, continueCreating);
        } else {
          runConfirmedCreateCallback(() => {
            onCreated(created);
          });
        }
        if (continueCreating) {
          continuation.completeContinuation(() => {
            updateDraft(() => ({ name: '', summary: '', description: '' }));
          });
          return;
        }
        onOpenChange(false);
      } catch (caught) {
        setError(
          userErrorMessage(caught, `Something went wrong creating the ${initiativeNounLower}.`),
        );
      } finally {
        continuation.finishSubmission();
        setCreating(false);
      }
    },
    [
      canSubmit,
      continuation,
      draft,
      globalCreation,
      orgId,
      initiativeNounLower,
      onOpenChange,
      onCreated,
      updateDraft,
    ],
  );

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${initiativeNounLower}`}
      propertyAriaLabel={`${initiativeNoun} properties`}
      contextRow={
        globalCreation ? (
          <>
            <EntityMetadataItem priority={0} className="max-w-none">
              <WorkspacePicker disabled={creating} />
            </EntityMetadataItem>
            <EntityMetadataItem priority={1} className="flex max-w-none gap-2">
              <ChevronRight aria-hidden className="text-on-surface-variant size-4 shrink-0" />
              <ActorPicker
                options={options.actorOptions}
                value={draft.ownerId}
                onChange={(next) => {
                  setField('ownerId', next);
                }}
                placeholder="Set owner"
                clearLabel="No owner"
                ariaLabel="Owner"
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
      titlePlaceholder={`${initiativeNoun} name`}
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
      error={error ?? planningCalendar.error ?? globalCreation?.loadError ?? null}
      statusMessage={continuation.statusMessage}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit(continuation.createMore)}
      submitLabel={`Create ${initiativeNoun}`}
    >
      <InitiativeComposerPickers
        actorOptions={options.actorOptions}
        {...(globalCreation === undefined
          ? {
              ownerId: draft.ownerId,
              onOwnerChange: (next: string | null) => {
                setField('ownerId', next);
              },
            }
          : {})}
        status={draft.status}
        onStatusChange={(next) => {
          setField('status', next);
        }}
        targetTimeframe={draft.targetTimeframe}
        fiscalYearStartMonth={planningCalendar.fiscalYearStartMonth}
        planningCalendarLoading={planningCalendar.loading}
        onTargetTimeframeChange={(next) => {
          setField('targetTimeframe', next);
        }}
        health={draft.health}
        onHealthChange={(next) => {
          setField('health', next);
        }}
        priority={draft.priority}
        onPriorityChange={(next) => {
          setField('priority', next);
        }}
        updateCadence={draft.updateCadence}
        onUpdateCadenceChange={(next) => {
          setField('updateCadence', next);
        }}
        disabled={creating}
      />
    </ComposerShell>
  );
});

/** Mount the Initiative body only for an active shell-global Initiative request. */
export function GlobalInitiativeComposer(): JSX.Element | null {
  const { request, closeCreate } = useCreateObject();

  if (request?.kind !== 'initiative') return null;

  return <GlobalInitiativeComposerDialog request={request} closeCreate={closeCreate} />;
}

/** Props for the request-bound Initiative body. */
interface GlobalInitiativeComposerDialogProps {
  /** The active Initiative request. */
  readonly request: CreateInitiativeRequest;
  /** Close the shell-global create request. */
  readonly closeCreate: () => void;
}

/** Apply destination vocabulary before resolving labels inside the Initiative body. */
function GlobalInitiativeComposerDialog({
  request,
  closeCreate,
}: GlobalInitiativeComposerDialogProps): JSX.Element {
  const creation = useCreationContext();

  return (
    <VocabularyProvider skin={creation.vocabulary}>
      <GlobalInitiativeComposerBody request={request} closeCreate={closeCreate} />
    </VocabularyProvider>
  );
}

/** Bind Initiative reads, writes, completion, and invalidation to the destination. */
function GlobalInitiativeComposerBody({
  request,
  closeCreate,
}: GlobalInitiativeComposerDialogProps): JSX.Element {
  const creation = useCreationContext();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  // The responsive seam rather than Next's router: it publishes the requested destination
  // immediately, which is what lets the shell acknowledge the click while the route payload
  // is still in flight. Navigation itself is unchanged.
  const router = useAppRouter();
  const initiativeNoun = useVocabulary('initiative');

  const targetWorkspaceId = creation.targetWorkspaceId;
  const initialWorkspaceId = request.initialWorkspaceId ?? null;
  const initiativeOrgId = targetWorkspaceId ?? initialWorkspaceId ?? '';
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
    <CreateInitiativeDialog
      orgId={initiativeOrgId}
      initiativeNoun={initiativeNoun}
      open
      onOpenChange={(next) => {
        if (!next) closeCreate();
      }}
      onCreated={() => undefined}
      defaultTemplateId={targetIsOriginalWorkspace ? request.defaultTemplateId : null}
      globalCreation={{
        targetWorkspaceId,
        initialWorkspaceId,
        ready: destinationReady,
        loadError: creation.loadError,
        canContribute: creation.permissions.canContribute,
        currentActorId,
        onCreated: (initiative, continueCreating) => {
          completeCreateObject({
            created: initiative,
            initialWorkspaceId,
            targetWorkspaceId,
            sameWorkspaceCompletion: request.sameWorkspaceCompletion,
            onCreated: request.onCreated,
            invalidationKeys: [queryKeys.initiatives(initiativeOrgId)],
            invalidate: (queryKey) => {
              void queryClient.invalidateQueries({ queryKey });
            },
            navigationEnabled: !continueCreating,
            seed: () => {
              seedInitiativeRecord(queryClient, initiativeOrgId, initiative);
            },
            openDestination: () => {
              router.push(`/orgs/${initiativeOrgId}/initiatives/${initiative.id}`);
            },
          });
        },
      }}
    />
  );
}
