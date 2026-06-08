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
 * CTA open the *same* dialog. This component owns only the form's transient field state (reset
 * whenever the dialog closes). The parent is handed the created {@link ProgramOut} through
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
import { ActorPicker, EnumPicker } from '@docket/ui/components';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { enumOptions, HEALTH_OPTIONS } from '@/components/pickers/options';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { STATUS_LABEL } from '@/components/programs/program-status';
import { readError, readProblem } from '@/lib/problem';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors'] as const;

/** The Program lifecycle statuses, ordered live → quiet. */
const PROGRAM_STATUS_ORDER: readonly ProgramStatus[] = ['active', 'paused', 'archived'];

/** Visibility choices for a Program. */
const VISIBILITY_ORDER: readonly Visibility[] = ['public', 'private'];

/** Human labels for {@link Visibility}. */
const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: 'Public',
  private: 'Private',
};

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
}

/**
 * The robust program-create composer dialog.
 *
 * @param props - The {@link CreateProgramDialogProps}.
 * @returns the rendered composer.
 */
export function CreateProgramDialog({
  orgId,
  programNoun,
  open,
  onOpenChange,
  onCreated,
}: CreateProgramDialogProps): JSX.Element {
  const programNounLower = programNoun.toLowerCase();

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProgramStatus>('active');
  const [health, setHealth] = useState<Health | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Reset transient form state whenever the dialog closes. */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        setName('');
        setBody('');
        setOwnerId(null);
        setStatus('active');
        setHealth(null);
        setVisibility('public');
        setError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const canSubmit = name.trim().length > 0;

  /** Create the program with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const trimmedBody = body.trim();
      const res = await api.v1.orgs[':orgId'].programs.$post({
        param: { orgId },
        json: {
          name: trimmed,
          status,
          visibility,
          ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
          ...(ownerId ? { ownerId: ActorId.parse(ownerId) } : {}),
          ...(health ? { health } : {}),
        },
      });
      if (!res.ok) {
        setError(await readProblem(res, `Could not create the ${programNounLower}.`));
        return;
      }
      const created = await res.json();
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, `Something went wrong creating the ${programNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [
    name,
    body,
    status,
    visibility,
    ownerId,
    health,
    orgId,
    programNounLower,
    onOpenChange,
    onCreated,
  ]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={handleOpenChange}
      heading={`New ${programNoun}`}
      description={`Name your ${programNounLower}, then set its owner, status, and health now — or later.`}
      title={name}
      onTitleChange={setName}
      titlePlaceholder={`${programNoun} name`}
      body={body}
      onBodyChange={setBody}
      bodyPlaceholder="Add a description…"
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel={`Create ${programNoun}`}
    >
      <ActorPicker
        triggerVariant="outline"
        options={options.actorOptions}
        value={ownerId}
        onChange={setOwnerId}
        placeholder="Set owner"
        clearLabel="No owner"
        ariaLabel="Owner"
        disabled={creating}
      />
      <EnumPicker
        triggerVariant="outline"
        options={enumOptions(PROGRAM_STATUS_ORDER, STATUS_LABEL)}
        value={status}
        onChange={(next) => {
          if (next) setStatus(next);
        }}
        placeholder="Status"
        ariaLabel="Status"
        disabled={creating}
      />
      <EnumPicker
        triggerVariant="outline"
        options={HEALTH_OPTIONS}
        value={health}
        onChange={setHealth}
        placeholder="Set health"
        clearLabel="No health"
        ariaLabel="Health"
        disabled={creating}
      />
      <EnumPicker
        triggerVariant="outline"
        options={enumOptions(VISIBILITY_ORDER, VISIBILITY_LABEL)}
        value={visibility}
        onChange={(next) => {
          if (next) setVisibility(next);
        }}
        placeholder="Visibility"
        ariaLabel="Visibility"
        disabled={creating}
      />
    </ComposerShell>
  );
}
