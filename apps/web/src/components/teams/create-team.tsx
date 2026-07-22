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
import { Check } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Input } from '@docket/ui/primitives';
import { type JSX, useCallback, useId, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { userErrorMessage, readProblemError } from '@/lib/problem';

/** The longest auto-suggested key length (matches typical Linear-style team prefixes). */
const MAX_SUGGESTED_KEY = 5;

/** Derive a tidy key suggestion from a team name: uppercase alphanumerics, capped in length. */
function suggestKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_SUGGESTED_KEY);
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
}

/**
 * The robust team-create composer dialog.
 *
 * @param props - The {@link CreateTeamDialogProps}.
 * @returns the rendered composer.
 */
export function CreateTeamDialog({
  orgId,
  open,
  onOpenChange,
  onCreated,
}: CreateTeamDialogProps): JSX.Element {
  const keyFieldId = useId();
  const guidanceFieldId = useId();

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

  /** Update the name, keeping the key in sync until the user takes the key over. */
  const onNameChange = useCallback(
    (next: string): void => {
      setName(next);
      if (!keyDirty) setKey(suggestKey(next));
    },
    [keyDirty],
  );

  const canSubmit = name.trim().length > 0 && key.trim().length > 0;

  /** Reset transient form state whenever the dialog closes. */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        setName('');
        setKey('');
        setKeyDirty(false);
        setSummary('');
        setDescription('');
        setTriageEnabled(true);
        setAgentGuidance('');
        setError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  /** Create the team with the default workflow, then prepend it via the parent. */
  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
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
            await readProblemError(res, 'Could not create the team.'),
            'Could not create the team.',
          ),
        );
        return;
      }
      const created = await res.json();
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Something went wrong creating the team.'));
    } finally {
      setCreating(false);
    }
  }, [
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
  ]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={handleOpenChange}
      heading="New team"
      title={name}
      onTitleChange={onNameChange}
      titlePlaceholder="Team name"
      summary={summary}
      onSummaryChange={setSummary}
      summaryPlaceholder="One-sentence summary"
      summaryMaxLength={280}
      body={description}
      onBodyChange={setDescription}
      bodyPlaceholder="What does this team own? (optional)"
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel="Create team"
    >
      <div className="flex flex-1 flex-wrap items-end gap-x-4 gap-y-3">
        <label htmlFor={keyFieldId} className="flex flex-col gap-1.5">
          <span className="text-on-surface-variant text-xs font-medium">Key</span>
          <Input
            id={keyFieldId}
            aria-label="Team key"
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
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-outline-variant',
            )}
          >
            {triageEnabled ? <Check className="size-3" /> : null}
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
}
