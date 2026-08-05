'use client';

/**
 * The "New {initiative}" create composer for the Initiatives list.
 *
 * @remarks
 * An Initiative is a cross-cutting *theme* that holds no work of its own — it associates
 * many-to-many with Projects + Programs (those links come later on the detail screen). The
 * composer captures the framing fields: a title + description body, and an inline strip of
 * compact pickers — its owner, its status, its target date, and its health verdict. Sensible
 * defaults keep it fast: only a name is required; status defaults to "Active".
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
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { ComposerTemplateControl } from '@/components/composer/template-menu';
import { templateMerge, useComposerDraft } from '@/components/composer/use-composer-draft';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { userErrorMessage, readProblemError } from '@/lib/problem';

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
  targetDate: string | null;
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
  targetDate: null,
  health: null,
  priority: 'none',
  updateCadence: 'monthly',
};

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
  defaultTemplateId?: string | null;
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
}: CreateInitiativeDialogProps): JSX.Element {
  const initiativeNounLower = initiativeNoun.toLowerCase();

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);
  const { draft, setField, updateDraft } =
    useComposerDraft<InitiativeDraft>(EMPTY_INITIATIVE_DRAFT);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = draft.name.trim().length > 0;

  /** Create the theme with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = draft.name.trim();
    if (trimmed.length === 0) return;
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
          ...(draft.targetDate ? { targetDate: draft.targetDate } : {}),
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
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(
        userErrorMessage(caught, `Something went wrong creating the ${initiativeNounLower}.`),
      );
    } finally {
      setCreating(false);
    }
  }, [draft, orgId, initiativeNounLower, onOpenChange, onCreated]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${initiativeNounLower}`}
      templateSlot={
        <ComposerTemplateControl
          orgId={orgId}
          kind="initiative"
          open={open}
          autoApplyId={defaultTemplateId}
          onApply={(chosen) => {
            updateDraft((current) =>
              templateMerge(current, templatePatch(chosen.payload, 'initiative'), {
                document: 'description',
                labels: ['name', 'summary'],
              }),
            );
          }}
          disabled={creating}
        />
      }
      title={draft.name}
      onTitleChange={(next) => {
        setField('name', next);
      }}
      titlePlaceholder={`${initiativeNoun} name`}
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
      submitLabel={`Create ${initiativeNoun}`}
    >
      <InitiativeComposerPickers
        actorOptions={options.actorOptions}
        ownerId={draft.ownerId}
        onOwnerChange={(next) => {
          setField('ownerId', next);
        }}
        status={draft.status}
        onStatusChange={(next) => {
          setField('status', next);
        }}
        targetDate={draft.targetDate}
        onTargetDateChange={(next) => {
          setField('targetDate', next);
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
