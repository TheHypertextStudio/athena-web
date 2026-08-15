'use client';

/**
 * The robust "New {program}" create composer for the Programs list.
 *
 * @remarks
 * A Program is an *ongoing* line of work (not team-scoped, no finish line). The composer captures
 * the fields that frame it: a title + description body, and an inline strip of compact pickers —
 * its owner, its lifecycle status (active / paused / archived), its health verdict, and its
 * visibility (public / private). Sensible defaults keep it fast: only a name is required; status
 * defaults to "Active" and visibility to "Public". Built on the shared {@link ComposerShell} + the
 * `@docket/ui` compact pickers.
 *
 * The dialog is *controlled* by the host page so its header "New {program}" button and empty-state
 * CTA open the *same* dialog. Its fields live in one {@link useComposerDraft} value, which
 * {@link withComposerReset} scopes to a single open so every open starts from a pristine draft
 * however the previous one ended. The parent is handed the created {@link ProgramOut} through
 * {@link CreateProgramDialogProps.onCreated} so it can optimistically prepend the new row + route.
 *
 * @see {@link useComposerOptions} for the owner option source.
 */
import {
  ActorId,
  type Health,
  type ProgramOut,
  type ProgramStatus,
  type Visibility,
} from '@docket/types';
import { ActorPicker } from '@docket/ui/components';
import { VocabularyProvider, useVocabulary } from '@docket/ui/hooks';
import { ChevronRight } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { useAppRouter } from '@/lib/interactions/navigation';
import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { ComposerTemplateControl } from '@/components/composer/template-menu';
import { templateMerge, useComposerDraft } from '@/components/composer/use-composer-draft';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { completeCreateObject } from '@/components/create-object/create-object-completion';
import {
  type CreateProgramRequest,
  useCreateObject,
} from '@/components/create-object/create-object-provider';
import { useCreationContext } from '@/components/create-object/creation-context';
import { WorkspacePicker } from '@/components/create-object/workspace-picker';
import { useDefaultedStatus } from '@/components/entity-display/use-work-status';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { useSession } from '@/lib/auth-client';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { seedProgramRecord } from '@/lib/entity-records';
import { queryKeys } from '@/lib/query';

import { ProgramComposerPickers } from './program-form-pickers';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors'] as const;

/** Every field the program composer holds, as one value. */
export interface ProgramDraft {
  name: string;
  summary: string;
  description: string;
  ownerId: string | null;
  status: ProgramStatus;
  health: Health | null;
  visibility: Visibility;
}

/** Destination facts supplied by the shell-global Program host. */
export interface ProgramGlobalCreation {
  /** The currently selected destination workspace. */
  readonly targetWorkspaceId: string | null;
  /** The immutable opening workspace used to scope launcher defaults. */
  readonly initialWorkspaceId: string | null;
  /** Whether destination data and permission facts have resolved successfully. */
  readonly ready: boolean;
  /** Application-owned destination read error copy. */
  readonly loadError: string | null;
  /** Whether the signed-in member may manage the destination. */
  readonly canManage: boolean;
  /** The signed-in member's Actor id in the destination, for personal templates. */
  readonly currentActorId: string | null;
  /** Complete destination-owned invalidation, callback, and routing after creation. */
  readonly onCreated: (program: ProgramOut) => void;
}

/** Props for {@link CreateProgramDialog}. */
export interface CreateProgramDialogProps {
  /** The org the program is created in (from the route). */
  orgId: string;
  /** The singular, vocabulary-skinned program noun (e.g. "Program", "Service line"). */
  programNoun: string;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that a program was created, so it can prepend + route. */
  onCreated: (program: ProgramOut) => void;
  /** A template to apply on open, from a `?template=` compose request. */
  defaultTemplateId?: string | null | undefined;
  /** Destination facts when mounted by the shell-global creation host. */
  globalCreation?: ProgramGlobalCreation | undefined;
}

/**
 * The robust program-create composer dialog.
 *
 * @param props - The {@link CreateProgramDialogProps}.
 * @returns the rendered composer.
 */
export const CreateProgramDialog = withComposerReset(function CreateProgramComposer({
  orgId,
  programNoun,
  open,
  onOpenChange,
  onCreated,
  defaultTemplateId = null,
  globalCreation,
}: CreateProgramDialogProps): JSX.Element {
  const programNounLower = programNoun.toLowerCase();
  const previousWorkspaceId = useRef(globalCreation?.targetWorkspaceId ?? null);
  const contextualRequestDefaultsApply =
    globalCreation === undefined ||
    globalCreation.targetWorkspaceId === globalCreation.initialWorkspaceId;
  const destinationReady = globalCreation?.ready ?? true;

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open && destinationReady);
  const { draft, setField, updateDraft } = useComposerDraft<ProgramDraft>({
    name: '',
    summary: '',
    description: '',
    ownerId: null,
    status: 'active',
    health: null,
    visibility: 'public',
  });

  useDefaultedStatus('program', draft.status, (key) => {
    setField('status', key);
  });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyTemplateSlotVisible, setLegacyTemplateSlotVisible] = useState(false);

  // Keep copy and generic enum choices portable while dropping the prior workspace's person id.
  useEffect(() => {
    if (globalCreation === undefined) return;
    if (previousWorkspaceId.current === globalCreation.targetWorkspaceId) return;
    previousWorkspaceId.current = globalCreation.targetWorkspaceId;
    setError(null);
    updateDraft(() => ({ ownerId: null }));
  }, [globalCreation, updateDraft]);

  const canSubmit =
    draft.name.trim().length > 0 && destinationReady && (globalCreation?.canManage ?? true);

  /** Create the program with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = draft.name.trim();
    if (trimmed.length === 0 || !canSubmit) return;
    setCreating(true);
    setError(null);
    try {
      const trimmedBody = draft.description.trim();
      const res = await api.v1.orgs[':orgId'].programs.$post({
        param: { orgId },
        json: {
          name: trimmed,
          status: draft.status,
          visibility: draft.visibility,
          ...(draft.summary.trim().length > 0 ? { summary: draft.summary.trim() } : {}),
          ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
          ...(draft.ownerId ? { ownerId: ActorId.parse(draft.ownerId) } : {}),
          ...(draft.health ? { health: draft.health } : {}),
        },
      });
      if (!res.ok) {
        setError(
          userErrorMessage(
            await readProblemError(res, `Could not create the ${programNounLower}.`),
            `Could not create the ${programNounLower}.`,
          ),
        );
        return;
      }
      const created = await res.json();
      globalCreation?.onCreated(created);
      onOpenChange(false);
      if (globalCreation === undefined) onCreated(created);
    } catch (caught) {
      setError(userErrorMessage(caught, `Something went wrong creating the ${programNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [canSubmit, draft, globalCreation, orgId, programNounLower, onOpenChange, onCreated]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${programNounLower}`}
      contextRow={
        globalCreation ? (
          <>
            <WorkspacePicker disabled={creating} />
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
            <ComposerTemplateControl
              orgId={orgId}
              kind="program"
              open={open && destinationReady}
              autoApplyId={contextualRequestDefaultsApply ? defaultTemplateId : null}
              currentActorId={globalCreation.currentActorId}
              teamId={null}
              leadingSeparator={
                <ChevronRight aria-hidden className="text-on-surface-variant size-4 shrink-0" />
              }
              onManage={() => {
                onOpenChange(false);
              }}
              onApply={(chosen) => {
                updateDraft((current) =>
                  templateMerge(current, templatePatch(chosen.payload, 'program'), {
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
            kind="program"
            open={open}
            autoApplyId={defaultTemplateId}
            onVisibilityChange={setLegacyTemplateSlotVisible}
            onApply={(chosen) => {
              updateDraft((current) =>
                templateMerge(current, templatePatch(chosen.payload, 'program'), {
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
      titlePlaceholder={`${programNoun} name`}
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
      submitLabel={`Create ${programNoun}`}
    >
      <ProgramComposerPickers
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
        health={draft.health}
        onHealthChange={(next) => {
          setField('health', next);
        }}
        visibility={draft.visibility}
        onVisibilityChange={(next) => {
          setField('visibility', next);
        }}
        disabled={creating}
      />
    </ComposerShell>
  );
});

/** Mount the Program body only for an active shell-global Program request. */
export function GlobalProgramComposer(): JSX.Element | null {
  const { request, closeCreate } = useCreateObject();

  if (request?.kind !== 'program') return null;

  return <GlobalProgramComposerDialog request={request} closeCreate={closeCreate} />;
}

/** Props for the request-bound Program body. */
interface GlobalProgramComposerDialogProps {
  /** The active Program request. */
  readonly request: CreateProgramRequest;
  /** Close the shell-global create request. */
  readonly closeCreate: () => void;
}

/** Apply destination vocabulary before resolving labels inside the Program body. */
function GlobalProgramComposerDialog({
  request,
  closeCreate,
}: GlobalProgramComposerDialogProps): JSX.Element {
  const creation = useCreationContext();

  return (
    <VocabularyProvider skin={creation.vocabulary}>
      <GlobalProgramComposerBody request={request} closeCreate={closeCreate} />
    </VocabularyProvider>
  );
}

/** Bind Program reads, writes, completion, and invalidation to the destination. */
function GlobalProgramComposerBody({
  request,
  closeCreate,
}: GlobalProgramComposerDialogProps): JSX.Element {
  const creation = useCreationContext();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  // The responsive seam rather than Next's router: it publishes the requested destination
  // immediately, which is what lets the shell acknowledge the click while the route payload
  // is still in flight. Navigation itself is unchanged.
  const router = useAppRouter();
  const programNoun = useVocabulary('program');

  const targetWorkspaceId = creation.targetWorkspaceId;
  const initialWorkspaceId = request.initialWorkspaceId ?? null;
  const programOrgId = targetWorkspaceId ?? initialWorkspaceId ?? '';
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
    <CreateProgramDialog
      orgId={programOrgId}
      programNoun={programNoun}
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
        canManage: creation.permissions.canManage,
        currentActorId,
        onCreated: (program) => {
          completeCreateObject({
            created: program,
            initialWorkspaceId,
            targetWorkspaceId,
            sameWorkspaceCompletion: request.sameWorkspaceCompletion,
            onCreated: request.onCreated,
            invalidationKeys: [queryKeys.programs(programOrgId)],
            invalidate: (queryKey) => {
              void queryClient.invalidateQueries({ queryKey });
            },
            seed: () => {
              seedProgramRecord(queryClient, programOrgId, program);
            },
            openDestination: () => {
              router.push(`/orgs/${programOrgId}/programs/${program.id}`);
            },
          });
        },
      }}
    />
  );
}
