'use client';

/** Fresh-view disclosure and chapter controls for the one durable conversation. */
import type { AgentSessionDetailOut } from '@docket/athena/agent-contract';
import { Button } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import {
  type JSX,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useConversationChapters, type ConversationChapter } from '@/lib/athena/chapters';
import type { ThreadEntry } from '@/lib/athena/job-presentation';

import { ConversationChapterIndex, type ChapterActions } from './conversation-chapter-menu';

/** A quiet conversation opens on a fresh surface after this much time. */
const FRESH_AFTER_MS = 6 * 60 * 60 * 1000;

/** One mounted conversation's fixed history boundary and disclosure state. */
interface HistoryState {
  readonly sessionId: string;
  readonly cutoff: string | null;
  readonly visible: boolean;
  readonly active: boolean;
}

/** Treat a long idle gap as a view boundary without changing the durable conversation. */
function historyCutoff(thread: AgentSessionDetailOut, openedAt: number): string | null {
  if (['pending', 'running', 'awaiting_input', 'awaiting_approval'].includes(thread.status)) {
    return null;
  }
  const latest = thread.activities.at(-1)?.createdAt;
  if (!latest || !Number.isFinite(Date.parse(latest))) return null;
  return openedAt - Date.parse(latest) >= FRESH_AFTER_MS ? latest : null;
}

/** Keep decisions visible on a fresh surface even when the job began earlier. */
function recentEntries(entries: readonly ThreadEntry[], cutoff: string): readonly ThreadEntry[] {
  return entries.filter(
    (entry) =>
      entry.at > cutoff ||
      (entry.kind === 'job' &&
        (entry.job.status === 'awaiting_approval' || entry.job.status === 'awaiting_input')),
  );
}

/** Reset the view boundary when the conversation changes or the rail reopens. */
function newHistoryState(thread: AgentSessionDetailOut, active: boolean): HistoryState {
  return {
    sessionId: thread.id,
    cutoff: active ? historyCutoff(thread, Date.now()) : null,
    visible: false,
    active,
  };
}

/** Whether the current view is hiding any earlier entry. */
function hasEarlierEntries(entries: readonly ThreadEntry[], cutoff: string | null): boolean {
  return cutoff !== null && entries.some((entry) => entry.at <= cutoff);
}

/** An end marker must follow the open chapter's start in durable activity order. */
function isLaterMessage(
  thread: AgentSessionDetailOut | null,
  startId: string,
  endId: string,
): boolean {
  const start = thread?.activities.find((activity) => activity.id === startId);
  const end = thread?.activities.find((activity) => activity.id === endId);
  if (!start || !end) return false;
  return (
    end.createdAt > start.createdAt || (end.createdAt === start.createdAt && end.id > start.id)
  );
}

/** The entries visible at this opening and controls for reaching the full stream. */
export function useConversationHistory(
  thread: AgentSessionDetailOut | null,
  entries: readonly ThreadEntry[],
  active = true,
) {
  const [history, setHistory] = useState<HistoryState | null>(null);
  const reveal = useCallback(() => {
    setHistory((state) => (state ? { ...state, visible: true } : state));
  }, []);
  let current = history;
  if (thread && (history?.sessionId !== thread.id || history.active !== active)) {
    current = newHistoryState(thread, active);
    setHistory(current);
  }
  const cutoff = current?.cutoff ?? null;
  const collapsed = cutoff !== null && !current?.visible;
  return {
    entries: collapsed ? recentEntries(entries, cutoff) : entries,
    hasEarlier: hasEarlierEntries(entries, cutoff),
    collapsed,
    reveal,
    toggle: () => {
      setHistory((state) => (state ? { ...state, visible: !state.visible } : state));
    },
  };
}

/** Saved chapter index, marker commands, and a jump that reveals hidden history first. */
export function useThreadChapters(
  thread: AgentSessionDetailOut | null,
  scrollerRef: RefObject<HTMLDivElement | null>,
  visibleEntries: readonly ThreadEntry[],
  revealHistory: () => void,
  jumpToActivityId?: string | null,
) {
  const chapters = useConversationChapters(thread !== null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const rows =
    thread && chapters.query.data?.sessionId === thread.id ? chapters.query.data.items : [];
  const open = rows.find((chapter) => chapter.endActivityId === null);
  useEffect(() => {
    if (!jumpToActivityId || !thread?.id) return;
    revealHistory();
    setTargetId(jumpToActivityId);
  }, [jumpToActivityId, thread?.id, revealHistory]);
  useEffect(() => {
    if (!targetId) return;
    const target = Array.from(
      scrollerRef.current?.querySelectorAll<HTMLElement>('[data-athena-activity]') ?? [],
    ).find((entry) => entry.dataset['athenaActivity'] === targetId);
    if (!target) return;
    // Revealing history resizes the column; let its follow-latest observer settle first.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        target.scrollIntoView({
          block: 'center',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        });
        setTargetId(null);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [targetId, scrollerRef, visibleEntries]);
  const actions: ChapterActions = {
    chapters: rows,
    openChapterId: open?.id ?? null,
    pending: chapters.start.isPending || chapters.end.isPending || chapters.remove.isPending,
    canEndAt: (activityId) => !!open && isLaterMessage(thread, open.startActivityId, activityId),
    onStart: (activityId, title) => {
      chapters.start.mutate({ startActivityId: activityId, title });
    },
    onEnd: (activityId) => {
      if (open) chapters.end.mutate({ chapterId: open.id, endActivityId: activityId });
    },
    onRemove: (chapterId) => {
      chapters.remove.mutate(chapterId);
    },
  };
  return {
    rows,
    actions,
    jump: (activityId: string) => {
      revealHistory();
      setTargetId(activityId);
    },
  };
}

/** Props for the conversation's one scrollable viewport. */
interface ConversationScrollAreaProps {
  readonly scrollerRef: RefObject<HTMLDivElement | null>;
  readonly columnRef: RefObject<HTMLDivElement | null>;
  readonly layout: 'page' | 'panel' | undefined;
  readonly history: ReturnType<typeof useConversationHistory>;
  readonly chapters: readonly ConversationChapter[];
  readonly onJumpChapter: (activityId: string) => void;
  readonly children: ReactNode;
}

/** A single scroll region with a small history affordance at its top. */
export function ConversationScrollArea({
  scrollerRef,
  columnRef,
  layout,
  history,
  chapters,
  onJumpChapter,
  children,
}: ConversationScrollAreaProps): JSX.Element {
  const touchStartY = useRef<number | null>(null);
  return (
    <div
      ref={scrollerRef}
      data-slot="athena-thread"
      className="absolute inset-0 overflow-y-auto"
      onWheel={(event) => {
        if (history.collapsed && event.deltaY < 0 && event.currentTarget.scrollTop <= 0) {
          history.reveal();
        }
      }}
      onTouchStart={(event) => {
        touchStartY.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchMove={(event) => {
        const start = touchStartY.current;
        if (
          history.collapsed &&
          start !== null &&
          (event.touches[0]?.clientY ?? start) - start > 24 &&
          event.currentTarget.scrollTop <= 0
        ) {
          history.reveal();
          touchStartY.current = null;
        }
      }}
    >
      <div
        ref={columnRef}
        className={cn(
          'flex min-h-full flex-col gap-7 py-4',
          layout === 'page'
            ? 'mx-auto w-full max-w-3xl justify-start pt-8 pb-12'
            : history.hasEarlier && history.collapsed
              ? 'justify-between'
              : 'justify-end',
        )}
      >
        {history.hasEarlier || chapters.length > 0 ? (
          <div className="flex w-full flex-wrap items-center gap-1">
            {history.hasEarlier ? (
              <Button type="button" variant="ghost" controlSize="sm" onClick={history.toggle}>
                {history.collapsed ? 'Earlier messages' : 'Recent messages'}
              </Button>
            ) : null}
            <ConversationChapterIndex chapters={chapters} onJump={onJumpChapter} />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
