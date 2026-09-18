'use client';

import { MenuActionRow } from '@docket/ui/components';
import { NotePen, Trash2 } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Text,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { relativeTime } from '@/components/settings/format-time';

import type {
  ComposerDraftControls,
  ComposerDraftSaveState,
  ComposerDraftSummary,
} from './use-composer-draft-persistence';

/** Props for {@link ComposerDraftsChip}. */
export interface ComposerDraftsChipProps {
  readonly drafts: ComposerDraftControls;
  /** The noun an untitled draft is called by, already vocabulary-skinned ("task"). */
  readonly noun: string;
  /** Whether the composer's controls are locked. */
  readonly disabled: boolean;
}

/** The copy a save state reads as; only a failure is shown, the rest is announced. */
const SAVE_STATE_COPY: Readonly<Record<ComposerDraftSaveState, string>> = {
  idle: '',
  saving: 'Saving draft',
  saved: 'Draft saved',
  error: 'Not saved',
};

/** Props for {@link DraftRow}. */
interface DraftRowProps {
  readonly draft: ComposerDraftSummary;
  readonly noun: string;
  readonly current: boolean;
  readonly onLoad: (draftId: string) => void;
  readonly onDelete: (draftId: string) => void;
}

/** One row of the chip's list: the draft to load, and a trailing delete. */
function DraftRow({ draft, noun, current, onLoad, onDelete }: DraftRowProps): JSX.Element {
  const label = draft.title ?? `Untitled ${noun}`;
  return (
    <MenuActionRow
      label={label}
      selected={current}
      renderPrimary={(children, className) => (
        <button
          type="button"
          className={cn(className, 'text-left')}
          onClick={() => {
            onLoad(draft.id);
          }}
        >
          {children}
          <Text as="span" token="label-small" tone="muted" className="shrink-0 pr-2">
            {relativeTime(draft.updatedAt)}
          </Text>
        </button>
      )}
      actionLabel={`Delete draft ${label}`}
      actionIcon={<Trash2 aria-hidden="true" />}
      onAction={() => {
        onDelete(draft.id);
      }}
    />
  );
}

/**
 * The composer's way in to its saved drafts: a "Drafts (n)" chip that opens the list, plus the
 * polite status of the draft being written.
 *
 * The chip appears only once there is a draft to return to, so a first-time composer shows no
 * dead control. Choosing a draft replaces the composer's content with it; the content being
 * edited is already saved, so nothing is lost.
 */
export function ComposerDraftsChip({
  drafts,
  noun,
  disabled,
}: ComposerDraftsChipProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const count = drafts.items.length;
  const status = SAVE_STATE_COPY[drafts.saving];

  return (
    <>
      {count > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              controlSize="sm"
              disabled={disabled}
              aria-label={`Drafts, ${count}`}
            >
              <NotePen aria-hidden="true" />
              Drafts ({count})
            </Button>
          </PopoverTrigger>
          {/* Above the trigger: the chip sits on the composer's bottom edge, so the list opens
              over the form rather than past the dialog. Wide enough for a title and its time. */}
          <PopoverContent presentation="panel" width="wide" side="top" align="start">
            <PopoverHeader>
              <Text as="p" token="title-small">
                Drafts
              </Text>
            </PopoverHeader>
            <PopoverBody>
              <div role="list" className="flex flex-col gap-0.5" aria-label="Saved drafts">
                {drafts.items.map((draft) => (
                  <DraftRow
                    key={draft.id}
                    draft={draft}
                    noun={noun}
                    current={draft.id === drafts.currentId}
                    onLoad={(draftId) => {
                      setOpen(false);
                      drafts.onLoad(draftId);
                    }}
                    onDelete={drafts.onDelete}
                  />
                ))}
              </div>
            </PopoverBody>
          </PopoverContent>
        </Popover>
      ) : null}
      <Text
        as="span"
        token="label-small"
        tone={drafts.saving === 'error' ? 'error' : 'muted'}
        role="status"
        aria-live="polite"
        className={cn(drafts.saving !== 'error' && 'sr-only')}
      >
        {status}
      </Text>
    </>
  );
}
