'use client';

/** Quiet controls for marking and returning to chapters in one conversation. */
import { MoreHorizontal } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
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
  readonly onRemove: (chapterId: string) => void;
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
}): JSX.Element | null {
  const startingHere = actions.chapters.find((chapter) => chapter.startActivityId === activityId);
  const active = actions.chapters.find((chapter) => chapter.id === actions.openChapterId);
  const canFinishHere = active !== undefined && actions.canEndAt(activityId);
  const [title, setTitle] = useState(() => text.replace(/\s+/g, ' ').trim().slice(0, 80));
  if (active && !startingHere && !canFinishHere) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          controlSize="sm"
          iconOnly
          disabled={actions.pending}
          aria-label={startingHere ? `Options for ${startingHere.title}` : 'Save or finish here'}
          className={cn(
            'absolute -top-3 right-0 group-hover:opacity-100 focus-visible:opacity-100',
            startingHere ? 'opacity-60' : 'opacity-0 [@media(hover:none)]:opacity-40',
          )}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!active && !startingHere ? (
          <label className="text-label-small text-on-surface-variant flex flex-col gap-1 px-2 py-1">
            Name
            <Input
              value={title}
              maxLength={80}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
              aria-label="Name this place"
            />
          </label>
        ) : null}
        {startingHere ? (
          <DropdownMenuItem
            onSelect={() => {
              actions.onRemove(startingHere.id);
            }}
          >
            Remove {startingHere.title}
          </DropdownMenuItem>
        ) : active && canFinishHere ? (
          <DropdownMenuItem
            onSelect={() => {
              actions.onEnd(activityId);
            }}
          >
            Finish {active.title} here
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={!title.trim()}
            onSelect={() => {
              actions.onStart(activityId, title.trim());
            }}
          >
            Save this place
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A compact chapter index above the current conversation. */
export function ConversationChapterIndex({
  chapters,
  onJump,
}: {
  readonly chapters: readonly ConversationChapter[];
  readonly onJump: (activityId: string) => void;
}): JSX.Element | null {
  if (chapters.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" controlSize="sm">
          Jump to
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
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
