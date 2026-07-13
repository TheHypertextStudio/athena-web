'use client';

/**
 * The robust "New {initiative}" create composer for the Initiatives list.
 *
 * @remarks
 * An Initiative is a cross-cutting *theme* that holds no work of its own — it associates
 * many-to-many with Projects + Programs (those links come later on the detail screen). The
 * composer still captures the framing fields: a title + description body, and an inline strip of
 * compact pickers — its owner, its status (active / completed), its target date, and its health
 * verdict. Sensible defaults keep it fast: only a name is required; status defaults to "Active".
 * Built on the shared {@link ComposerShell} + the `@docket/ui` compact pickers.
 *
 * The dialog is *controlled* by the host page so its header "New {initiative}" button and
 * empty-state CTA open the *same* dialog. This component owns only the form's transient field
 * state (reset whenever the dialog closes). The parent is handed the created {@link InitiativeOut}
 * through {@link CreateInitiativeDialogProps.onCreated} so it can route to its (empty) detail.
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
import { ActorPicker, DatePicker, EnumPicker } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { enumOptions, HEALTH_OPTIONS } from '@/components/pickers/options';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { formatCalendarDate } from '@/lib/format-date';
import { userErrorMessage, readProblemError } from '@/lib/problem';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors'] as const;

/** The Initiative statuses, ordered open → done. */
const INITIATIVE_STATUS_ORDER: readonly InitiativeStatus[] = [
  'proposed',
  'active',
  'completed',
  'canceled',
];
const INITIATIVE_STATUS_LABEL: Record<InitiativeStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};
const PRIORITY_ORDER: readonly InitiativePriority[] = ['none', 'low', 'medium', 'high'];
const PRIORITY_LABEL: Record<InitiativePriority, string> = {
  none: 'No priority',
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
};
const CADENCE_ORDER: readonly InitiativeUpdateCadence[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'none',
];
const CADENCE_LABEL: Record<InitiativeUpdateCadence, string> = {
  weekly: 'Weekly updates',
  biweekly: 'Biweekly updates',
  monthly: 'Monthly updates',
  quarterly: 'Quarterly updates',
  none: 'No update cadence',
};
const GUIDED_DOCUMENT = `# Overview

# Motivation and Purpose

# Desired Outcome

# Approach`;

/** Format an ISO date for a picker trigger, narrowing the app helper's `null` to `undefined`. */
function triggerDate(value: string | null): string | undefined {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' }) ?? undefined;
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
}

/**
 * The robust initiative-create composer dialog.
 *
 * @param props - The {@link CreateInitiativeDialogProps}.
 * @returns the rendered composer.
 */
export function CreateInitiativeDialog({
  orgId,
  initiativeNoun,
  open,
  onOpenChange,
  onCreated,
}: CreateInitiativeDialogProps): JSX.Element {
  const initiativeNounLower = initiativeNoun.toLowerCase();

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [status, setStatus] = useState<InitiativeStatus>('active');
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [priority, setPriority] = useState<InitiativePriority>('none');
  const [updateCadence, setUpdateCadence] = useState<InitiativeUpdateCadence>('monthly');
  const [template, setTemplate] = useState<'blank' | 'strategic' | 'objective'>('blank');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Reset transient form state whenever the dialog closes. */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        setName('');
        setSummary('');
        setBody('');
        setOwnerId(null);
        setStatus('active');
        setTargetDate(null);
        setHealth(null);
        setPriority('none');
        setUpdateCadence('monthly');
        setTemplate('blank');
        setError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const canSubmit = name.trim().length > 0;

  /** Create the theme with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const trimmedBody = body.trim();
      const res = await api.v1.orgs[':orgId'].initiatives.$post({
        param: { orgId },
        json: {
          name: trimmed,
          ...(summary.trim() ? { summary: summary.trim() } : {}),
          status,
          priority,
          updateCadence,
          ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
          ...(ownerId ? { ownerId: ActorId.parse(ownerId) } : {}),
          ...(targetDate ? { targetDate } : {}),
          ...(health ? { health } : {}),
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
  }, [
    name,
    body,
    summary,
    status,
    ownerId,
    targetDate,
    health,
    priority,
    updateCadence,
    orgId,
    initiativeNounLower,
    onOpenChange,
    onCreated,
  ]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={handleOpenChange}
      heading={`New ${initiativeNoun.toLowerCase()}`}
      title={name}
      onTitleChange={setName}
      titlePlaceholder={`${initiativeNoun} name`}
      body={body}
      onBodyChange={setBody}
      bodyPlaceholder="Add a description…"
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel={`Create ${initiativeNoun}`}
    >
      <div className="flex w-full flex-col gap-2">
        <input
          value={summary}
          maxLength={280}
          onChange={(event) => {
            setSummary(event.target.value);
          }}
          placeholder="One-sentence summary"
          aria-label="Summary"
          className="border-outline-variant bg-surface text-on-surface placeholder:text-on-surface-variant h-8 w-full rounded-md border px-2 text-sm"
        />
        <div className="flex flex-wrap gap-1" aria-label="Document template">
          {(['blank', 'strategic', 'objective'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={template === value ? 'secondary' : 'ghost'}
              onClick={() => {
                setTemplate(value);
                setBody(value === 'blank' ? '' : GUIDED_DOCUMENT);
              }}
            >
              {value === 'blank'
                ? 'Blank'
                : value === 'strategic'
                  ? 'Strategic initiative'
                  : 'Objective'}
            </Button>
          ))}
        </div>
      </div>
      <ActorPicker
        options={options.actorOptions}
        value={ownerId}
        onChange={setOwnerId}
        placeholder="Set owner"
        clearLabel="No owner"
        ariaLabel="Owner"
        disabled={creating}
      />
      <EnumPicker
        options={enumOptions(INITIATIVE_STATUS_ORDER, INITIATIVE_STATUS_LABEL)}
        value={status}
        onChange={(next) => {
          if (next) setStatus(next);
        }}
        placeholder="Status"
        ariaLabel="Status"
        disabled={creating}
      />
      <DatePicker
        value={targetDate}
        onChange={setTargetDate}
        placeholder="Set target"
        formatLabel={triggerDate}
        ariaLabel="Target date"
        disabled={creating}
      />
      <EnumPicker
        options={HEALTH_OPTIONS}
        value={health}
        onChange={setHealth}
        placeholder="Set health"
        clearLabel="No health"
        ariaLabel="Health"
        disabled={creating}
      />
      <EnumPicker
        options={enumOptions(PRIORITY_ORDER, PRIORITY_LABEL)}
        value={priority}
        onChange={(next) => {
          if (next) setPriority(next);
        }}
        placeholder="Priority"
        ariaLabel="Priority"
        disabled={creating}
      />
      <EnumPicker
        options={enumOptions(CADENCE_ORDER, CADENCE_LABEL)}
        value={updateCadence}
        onChange={(next) => {
          if (next) setUpdateCadence(next);
        }}
        placeholder="Update cadence"
        ariaLabel="Update cadence"
        disabled={creating}
      />
    </ComposerShell>
  );
}
