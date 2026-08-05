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
  defaultTemplateId?: string | null;
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
}: CreateProgramDialogProps): JSX.Element {
  const programNounLower = programNoun.toLowerCase();

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);
  const { draft, setField, applyTemplate, undoTemplate, appliedTemplate } =
    useComposerDraft<ProgramDraft>({
      name: '',
      summary: '',
      description: '',
      ownerId: null,
      status: 'active',
      health: null,
      visibility: 'public',
    });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = draft.name.trim().length > 0;

  /** Create the program with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = draft.name.trim();
    if (trimmed.length === 0) return;
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
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(userErrorMessage(caught, `Something went wrong creating the ${programNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [draft, orgId, programNounLower, onOpenChange, onCreated]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${programNounLower}`}
      templateSlot={
        <ComposerTemplateControl
          orgId={orgId}
          kind="program"
          open={open}
          appliedId={appliedTemplate?.id ?? null}
          autoApplyId={defaultTemplateId}
          onApply={(chosen) => {
            applyTemplate(templatePatch(chosen.payload, 'program'), {
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
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel={`Create ${programNoun}`}
    >
      <ProgramComposerPickers
        actorOptions={options.actorOptions}
        ownerId={draft.ownerId}
        onOwnerChange={(next) => {
          setField('ownerId', next);
        }}
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
