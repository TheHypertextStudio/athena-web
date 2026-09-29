'use client';

/**
 * `thread-entries` — one merged conversation thread: your messages, replies, quiet work lines,
 * work entries, and questions.
 *
 * @remarks
 * Split out of `athena-conversation.tsx` so {@link mergeThreadEntries}'s output has its own home:
 * an activity renders through the chat presentation (your right-aligned bubble, a left-aligned
 * reply with no surface, a quiet work line with its MCP app card, or a plan entry), a job
 * renders as the flat {@link AthenaJobCard} entry, and a question as a flat entry at the time it was
 * asked. Every entry is one level deep. See §4.2 and §4.6 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`.
 */
import { type SessionActivityOut } from '@docket/athena/agent-contract';
import { type JSX } from 'react';

import { StaticMarkdown } from '@/components/editor/static-markdown';
import type { ThreadEntry } from '@/lib/athena/job-presentation';
import { personalAthenaTransport, type PersonalAthenaTransport } from '@/lib/athena/query-defs';

import { AthenaJobCard } from './athena-job-card';
import { ChapterMarkerMenu, type ChapterActions } from './conversation-chapter-menu';
import { ThreadQuestion } from './elicitation-queue';
import { ThreadActionEntry } from './thread-action-entry';

/** Props for {@link ThreadEntries}. */
export interface ThreadEntriesProps {
  /** The thread's activities, jobs, and questions, merged and ordered by {@link mergeThreadEntries}. */
  readonly entries: readonly ThreadEntry[];
  /** The workspace the thread belongs to, for a question whose task names none. */
  readonly workspaceId: string;
  /** The question a notification landed on, rung and scrolled to. */
  readonly landingQuestionId?: string | null | undefined;
  /** Transport a job entry drives its own detail read and actions through. */
  readonly transport?: PersonalAthenaTransport;
  /** Posts a widget-composed `ui/message` into this thread, as the user. */
  readonly onWidgetMessage: (text: string) => Promise<boolean>;
  /** Mark the start or end of a chapter at a saved message. */
  readonly chapterActions?: ChapterActions | undefined;
}

/** Props for {@link ThreadEntryView}. */
interface ThreadEntryViewProps extends Omit<ThreadEntriesProps, 'entries'> {
  readonly entry: ThreadEntry;
  readonly transport: PersonalAthenaTransport;
}

/** One merged entry: a work entry, a question, or a conversational beat. */
function ThreadEntryView({
  entry,
  workspaceId,
  landingQuestionId,
  transport,
  onWidgetMessage,
  chapterActions,
}: ThreadEntryViewProps): JSX.Element | null {
  if (entry.kind === 'job') return <AthenaJobCard job={entry.job} transport={transport} />;
  if (entry.kind === 'question') {
    return (
      <ThreadQuestion
        question={entry.question}
        workspaceId={workspaceId}
        focused={entry.question.id === landingQuestionId}
      />
    );
  }
  return (
    <ChatEntry
      activity={entry.activity}
      onWidgetMessage={onWidgetMessage}
      chapterActions={chapterActions}
    />
  );
}

/** The key one merged entry renders under, unique across the three kinds. */
function entryKey(entry: ThreadEntry): string {
  if (entry.kind === 'job') return `job-${entry.job.id}`;
  if (entry.kind === 'question') return `question-${entry.question.id}`;
  return entry.activity.id;
}

/** Render the thread's merged entries, in the order {@link mergeThreadEntries} gave them. */
export function ThreadEntries({
  entries,
  transport = personalAthenaTransport,
  ...rest
}: ThreadEntriesProps): JSX.Element {
  return (
    <>
      {entries.map((entry) => (
        <ThreadEntryView key={entryKey(entry)} entry={entry} transport={transport} {...rest} />
      ))}
    </>
  );
}

/** Props for {@link ChatEntry}. */
interface ChatEntryProps {
  activity: SessionActivityOut;
  /** Posts a widget-composed `ui/message` into this thread, as the user. */
  onWidgetMessage: (text: string) => Promise<boolean>;
  chapterActions?: ChapterActions | undefined;
}

/** One conversational beat: user bubble, Athena text, quiet work chip, or question. */
function ChatEntry({
  activity,
  onWidgetMessage,
  chapterActions,
}: ChatEntryProps): JSX.Element | null {
  const text = typeof activity.body['text'] === 'string' ? activity.body['text'] : '';
  const fromUser = activity.body['author'] === 'user';

  if (activity.type === 'response') {
    const ends = chapterActions?.chapters.find((chapter) => chapter.endActivityId === activity.id);
    return (
      <div className="group relative flex w-full flex-col" data-athena-activity={activity.id}>
        {fromUser ? <UserMessage text={text} /> : <AthenaMessage text={text} />}
        {ends ? <span className="sr-only">End of {ends.title}</span> : null}
        {chapterActions ? (
          <ChapterMarkerMenu activityId={activity.id} text={text} actions={chapterActions} />
        ) : null}
      </div>
    );
  }
  if (activity.type === 'elicitation') {
    return <AthenaMessage text={text} />;
  }
  if (activity.type === 'error') {
    // The failed-turn state owns recovery. Provider error text is not conversation copy.
    return null;
  }
  if (activity.type === 'action') {
    return <ThreadActionEntry activity={activity} onWidgetMessage={onWidgetMessage} />;
  }
  // Thoughts stay out of the conversation — the work-log session view carries them.
  return null;
}

/** The sender's message, shared by saved activity and the local optimistic turn. */
export function UserMessage({ text }: { readonly text: string }): JSX.Element {
  return (
    <div className="bg-primary-container text-on-primary-container text-body-medium rounded-corner-lg rounded-br-corner-xs ml-auto max-w-[85%] px-4 py-3 whitespace-pre-wrap">
      {text}
    </div>
  );
}

/** A left-aligned answer; the user's right-aligned bubbles establish the speaker. */
function AthenaMessage({ text }: { readonly text: string }): JSX.Element {
  return (
    <div className="text-on-surface mr-auto max-w-[75ch] min-w-0">
      <StaticMarkdown value={text} />
    </div>
  );
}
