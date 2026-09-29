'use client';

/** Quiet controls for marking and returning to chapters in one conversation. */
import { MoreHorizontal } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import type { ConversationChapter } from '@/lib/athena/chapters';

/** Commands available on a persisted conversation message. */
export interface ChapterActions {
  readonly chapters: readonly ConversationChapter[];
  readonly openChapterId: string | null;
  readonly pending: boolean;
  readonly canEndAt: (activityId: string) => boolean;
  readonly onStart: (activityId: string, text: string) => void;
  readonly onEnd: (activityId: string) => void;
}

/** A message's start or end marker, visible on focus and touch as well as hover. */
export function ChapterMarkerMenu({
  activityId,
  text,
  actions,
}: {
  readonly activityId: string;
  readonly text: string;
  readonly actions: ChapterActions;
}): JSX.Element {
  const open = actions.openChapterId !== null;
  const [title, setTitle] = useState(() => text.replace(/\s+/g, ' ').trim().slice(0, 80));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          controlSize="sm"
          iconOnly
          disabled={actions.pending}
          aria-label="Section options"
          className="absolute -top-3 right-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-40"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!open ? (
          <label className="text-label-small text-on-surface-variant flex flex-col gap-1 px-2 py-1">
            Section name
            <Input
              value={title}
              maxLength={80}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
              aria-label="Section name"
            />
          </label>
        ) : null}
        <DropdownMenuItem
          disabled={open ? !actions.canEndAt(activityId) : !title.trim()}
          onSelect={() => {
            if (open) actions.onEnd(activityId);
            else actions.onStart(activityId, title.trim());
          }}
        >
          {open ? 'End section here' : 'Start section here'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A compact chapter index above the current conversation. */
export function ConversationChapterIndex({
  chapters,
  onJump,
  onRemove,
}: {
  readonly chapters: readonly ConversationChapter[];
  readonly onJump: (activityId: string) => void;
  readonly onRemove: (chapterId: string) => void;
}): JSX.Element | null {
  if (chapters.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" controlSize="sm">
          Sections
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {chapters.map((chapter) => (
          <DropdownMenuItem
            key={chapter.id}
            onSelect={() => {
              onJump(chapter.startActivityId);
            }}
          >
            {chapter.title}
            {chapter.endActivityId === null ? ' · Open' : ''}
          </DropdownMenuItem>
        ))}
        {chapters.map((chapter) => (
          <DropdownMenuItem
            key={`remove-${chapter.id}`}
            onSelect={() => {
              onRemove(chapter.id);
            }}
          >
            Remove {chapter.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
