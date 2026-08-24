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
 */
import type { TeamOut } from '@docket/types';
import { VocabularyProvider, useVocabulary } from '@docket/ui/hooks';
import { Check } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Input } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useId, useState } from 'react';

import { useAppRouter } from '@/lib/interactions/navigation';
import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { useComposerContinuation } from '@/components/composer/use-composer-continuation';
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
import { WorkspacePicker } from '@/components/create-object/workspace-picker';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { queryKeys } from '@/lib/query';

/** The longest auto-suggested key length (matches typical Linear-style team prefixes). */
const MAX_SUGGESTED_KEY = 5;

/** Derive a tidy key suggestion from a team name: uppercase alphanumerics, capped in length. */
function suggestKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_SUGGESTED_KEY);
}

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
  globalCreation,
}: CreateTeamDialogProps): JSX.Element {
  const keyFieldId = useId();
  const guidanceFieldId = useId();
  const teamNounLower = teamNoun.toLowerCase();
  const destinationReady = globalCreation?.ready ?? true;

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Once the user edits the key directly we stop deriving it from the name.
  const [keyDirty, setKeyDirty] = useState(false);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [triageEnabled, setTriageEnabled] = useState(true);
  const [agentGuidance, setAgentGuidance] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continuation = useComposerContinuation({
    creating,
    successMessage: `${teamNoun} created. Ready to create another.`,
  });

  /** Update the name, keeping the key in sync until the user takes the key over. */
  const onNameChange = useCallback(
    (next: string): void => {
      setName(next);
      if (!keyDirty) setKey(suggestKey(next));
    },
    [keyDirty],
  );

  const canSubmit =
    name.trim().length > 0 &&
    key.trim().length > 0 &&
    destinationReady &&
    (globalCreation?.canManage ?? true);

  /** Create the team with the default workflow, then prepend it via the parent. */
  const submit = useCallback(
    async (continueCreating = false): Promise<void> => {
      if (!canSubmit || !continuation.beginSubmission()) return;
      setCreating(true);
      setError(null);
      try {
        const trimmedDescription = description.trim();
        const trimmedGuidance = agentGuidance.trim();
        const res = await api.v1.orgs[':orgId'].teams.$post({
          param: { orgId },
          json: {
            name: name.trim(),
            key: key.trim().toUpperCase(),
            triageEnabled,
            ...(summary.trim().length > 0 ? { summary: summary.trim() } : {}),
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
        if (globalCreation !== undefined) {
          globalCreation.onCreated(created, continueCreating);
        } else {
          runConfirmedCreateCallback(() => {
            onCreated(created);
          });
        }
        if (continueCreating) {
          continuation.completeContinuation(() => {
            setName('');
            setKey('');
            setKeyDirty(false);
            setSummary('');
            setDescription('');
            setAgentGuidance('');
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
      name,
      key,
      triageEnabled,
      summary,
      description,
      agentGuidance,
      orgId,
      onOpenChange,
      onCreated,
      globalCreation,
      teamNounLower,
      continuation,
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
      title={name}
      onTitleChange={onNameChange}
      titleInputRef={continuation.titleInputRef}
      titlePlaceholder={`${teamNoun} name`}
      summary={summary}
      onSummaryChange={setSummary}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={description}
      bodyResetKey={continuation.bodyResetGeneration}
      onBodyChange={setDescription}
      bodyPlaceholder={`What does this ${teamNounLower} own? (optional)`}
      mentionOrgId={orgId}
      error={error ?? globalCreation?.loadError ?? null}
      statusMessage={continuation.statusMessage}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit(continuation.createMore)}
      submitLabel={`Create ${teamNounLower}`}
    >
      <div className="flex flex-1 flex-wrap items-end gap-x-4 gap-y-3">
        <label htmlFor={keyFieldId} className="flex flex-col gap-1.5">
          <span className="text-on-surface-variant text-xs font-medium">Key</span>
          <Input
            id={keyFieldId}
            aria-label={`${teamNoun} key`}
            placeholder="ENG"
            value={key}
            maxLength={10}
            disabled={creating}
            className="h-8 w-28 uppercase"
            onChange={(event) => {
              setKeyDirty(true);
              setKey(event.target.value.toUpperCase());
            }}
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={triageEnabled}
          aria-label="Triage queue"
          disabled={creating}
          onClick={() => {
            setTriageEnabled((current) => !current);
          }}
          className="text-body-medium flex h-8 items-center gap-2 disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex size-4 items-center justify-center rounded border',
              triageEnabled
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant',
            )}
          >
            {triageEnabled ? <Check className="size-4" /> : null}
          </span>
          <span className="text-on-surface">Triage queue</span>
        </button>
        <label htmlFor={guidanceFieldId} className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-on-surface-variant text-xs font-medium">
            Agent guidance (optional)
          </span>
          <Input
            id={guidanceFieldId}
            aria-label="Agent guidance"
            placeholder="How agents should work in this team…"
            value={agentGuidance}
            disabled={creating}
            className="h-8"
            onChange={(event) => {
              setAgentGuidance(event.target.value);
            }}
          />
        </label>
      </div>
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

  return (
    <CreateTeamDialog
      orgId={teamOrgId}
      teamNoun={teamNoun}
      open
      onOpenChange={(next) => {
        if (!next) closeCreate();
      }}
      onCreated={() => undefined}
      globalCreation={{
        ready: destinationReady,
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
