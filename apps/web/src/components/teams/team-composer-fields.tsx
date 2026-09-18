'use client';

/**
 * The team composer's property strip: the key, the Triage toggle, and the agent guidance.
 *
 * @remarks
 * These are the team's own settings rather than references to other records, so they render as
 * plain inputs in the shell's freeform property slot. Editing the key directly marks it as taken
 * over, after which the name stops deriving it (see `teamNamePatch`).
 */
import { Input, Switch } from '@docket/ui/primitives';
import { type JSX, useId } from 'react';

import type { ComposerDraft } from '@/components/composer/use-composer-draft';

import type { TeamDraft } from './create-team';

/** Props for {@link TeamComposerFields}. */
export interface TeamComposerFieldsProps {
  readonly draft: TeamDraft;
  /** The singular, vocabulary-skinned team noun, for the key field's accessible name. */
  readonly teamNoun: string;
  readonly disabled: boolean;
  readonly setField: ComposerDraft<TeamDraft>['setField'];
  readonly updateDraft: ComposerDraft<TeamDraft>['updateDraft'];
}

/** The key, Triage, and guidance controls for one team draft. */
export function TeamComposerFields({
  draft,
  teamNoun,
  disabled,
  setField,
  updateDraft,
}: TeamComposerFieldsProps): JSX.Element {
  const keyFieldId = useId();
  const guidanceFieldId = useId();

  return (
    <div className="flex flex-1 flex-wrap items-end gap-x-4 gap-y-3">
      <label htmlFor={keyFieldId} className="flex flex-col gap-1.5">
        <span className="text-on-surface-variant text-label-small">Key</span>
        <Input
          id={keyFieldId}
          aria-label={`${teamNoun} key`}
          placeholder="ENG"
          value={draft.key}
          maxLength={10}
          disabled={disabled}
          className="h-8 w-28 uppercase"
          onChange={(event) => {
            updateDraft(() => ({ keyDirty: true, key: event.target.value.toUpperCase() }));
          }}
        />
      </label>
      <div className="flex h-8 items-center gap-2">
        <Switch
          aria-label="Triage queue"
          checked={draft.triageEnabled}
          disabled={disabled}
          onCheckedChange={(next) => {
            setField('triageEnabled', next);
          }}
        />
        <span className="text-on-surface text-body-medium">Triage queue</span>
      </div>
      <label htmlFor={guidanceFieldId} className="flex min-w-48 flex-1 flex-col gap-1.5">
        <span className="text-on-surface-variant text-label-small">Agent guidance (optional)</span>
        <Input
          id={guidanceFieldId}
          aria-label="Agent guidance"
          placeholder="How agents should work in this team…"
          value={draft.agentGuidance}
          disabled={disabled}
          className="h-8"
          onChange={(event) => {
            setField('agentGuidance', event.target.value);
          }}
        />
      </label>
    </div>
  );
}
