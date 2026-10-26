'use client';

/** The same recorded comment/change language inside and outside session metadata wrappers. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { ChevronDown } from '@docket/ui/icons';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@docket/ui/primitives';
import { useState, type JSX, type ReactNode } from 'react';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { relativeTime } from '@/components/project-detail/format-time';
import { activityPerformer, activitySentence, activityTimestampTitle } from './format-activity';

/** Exact source times are retained when a recorded edit is expanded or inspected. */
export function ActivityTime({
  entry,
  exact = false,
}: {
  readonly entry: TaskActivityOut;
  readonly exact?: boolean;
}): JSX.Element {
  return (
    <time
      data-entry-time
      dateTime={entry.createdAt}
      title={activityTimestampTitle(entry.createdAt, activityPerformer(entry, null).detail)}
      className="text-label-small text-on-surface-variant tabular-nums"
    >
      {exact
        ? new Date(entry.createdAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium',
          })
        : relativeTime(entry.createdAt)}
    </time>
  );
}

/** Application-owned actions stay concise while saved content remains visible below them. */
function changeAction(
  entry: TaskActivityOut & { change: NonNullable<TaskActivityOut['change']> },
): string {
  const change = entry.change;
  if (change.field === 'description')
    return change.to === null ? 'cleared the description' : 'updated the description';
  if (change.field === 'dependency') return change.to ?? `removed ${change.from ?? 'a dependency'}`;
  return activitySentence(entry);
}

/** Describe comments and notices using the same vocabulary as standalone activity. */
function action(entry: TaskActivityOut): string {
  if (entry.change) return changeAction({ ...entry, change: entry.change });
  if (entry.sessionEvent === 'question') return 'asked a question';
  if (entry.sessionEvent === 'error') return 'reported an issue';
  if (entry.type === 'comment') return entry.commentEdit ? 'started this comment' : 'commented';
  if (entry.type === 'session') return 'posted an update';
  return entry.body ?? 'created this task';
}

/** Individual source values, including intermediate edits, never disappear through consolidation. */
function EditDetails({
  entry,
  showTime,
}: {
  readonly entry: TaskActivityOut;
  readonly showTime: boolean;
}): JSX.Element | null {
  if (!entry.change) return null;
  return (
    <li className="min-w-0">
      {showTime ? <ActivityTime entry={entry} exact /> : null}
      <dl className="text-body-small mt-2 grid gap-3">
        <div>
          <dt className="text-label-small text-on-surface-variant">Before</dt>
          <dd className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {entry.change.from ?? 'Not set'}
          </dd>
        </div>
        <div>
          <dt className="text-label-small text-on-surface-variant">After</dt>
          <dd className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {entry.change.to ?? 'Not set'}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/** Inputs shared by standalone rows, grouped rows and the full recorded-activity inspector. */
export interface TaskActivityContentProps {
  readonly entry: TaskActivityOut;
  readonly history?: readonly TaskActivityOut[];
  readonly showPerformer?: boolean;
  readonly exactTime?: boolean;
  readonly expanded?: boolean;
}

/** One trigger is both the change summary and its disclosure; no redundant View change link. */
function ChangeTrigger({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <CollapsibleTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        className="group coarse:min-h-10 text-label-medium -ml-2 h-auto min-h-8 max-w-full min-w-0 justify-start gap-2 px-2 text-left whitespace-normal"
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 -rotate-90 transition-transform duration-[var(--dur-fast)] group-data-[state=open]:rotate-0 motion-reduce:transition-none"
        />
      </Button>
    </CollapsibleTrigger>
  );
}

/** The same action heading and exact edit disclosure belongs to every feed row. */
function ActivityHeading({
  entry,
  history,
  showPerformer,
  exactTime,
  open,
  onOpenChange,
}: {
  readonly entry: TaskActivityOut;
  readonly history: readonly TaskActivityOut[];
  readonly showPerformer: boolean;
  readonly exactTime: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const performer = activityPerformer(entry, null);
  const label = (
    <>
      {showPerformer ? <span className="text-on-surface">{performer.name} </span> : null}
      <span>{action(entry)}</span>
      {history.length > 1 ? (
        <span className="text-label-small"> · {history.length} edits</span>
      ) : null}
    </>
  );
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="text-on-surface-variant text-label-medium flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {entry.change ? <ChangeTrigger>{label}</ChangeTrigger> : <span>{label}</span>}
        <ActivityTime entry={entry} exact={exactTime} />
      </div>
      {entry.change ? (
        <CollapsibleContent className="pt-2">
          <ol className="flex flex-col gap-4">
            {history.map((edit) => (
              <EditDetails key={edit.id} entry={edit} showTime={!exactTime || history.length > 1} />
            ))}
          </ol>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

/** Edited attribution preserves the original author and names the recorded editor. */
function CommentEditAttribution({
  entry,
}: {
  readonly entry: TaskActivityOut;
}): JSX.Element | null {
  const edit = entry.commentEdit;
  if (!edit) return null;
  const name = activityPerformer(
    { ...entry, actorId: edit.actorId, actorName: edit.actorName, origin: edit.origin },
    null,
  ).name;
  return (
    <p className="text-label-medium text-on-surface-variant mt-1">
      Edited by {name}{' '}
      <time dateTime={edit.at} title={edit.at}>
        {relativeTime(edit.at)}
      </time>
    </p>
  );
}

/** Saved content stays visible until its complete edit details replace the preview. */
function ActivityBody({
  entry,
  open,
}: {
  readonly entry: TaskActivityOut;
  readonly open: boolean;
}): JSX.Element | null {
  if (entry.change) {
    if (open || entry.change.field !== 'description' || !entry.change.to) return null;
    return (
      <StaticMarkdown
        value={entry.change.to}
        className="mt-1 line-clamp-6 [overflow-wrap:anywhere] [&>*]:max-w-none"
      />
    );
  }
  if ((entry.type !== 'comment' && entry.type !== 'session') || !entry.body) return null;
  return (
    <StaticMarkdown value={entry.body} className="mt-1 [overflow-wrap:anywhere] [&>*]:max-w-none" />
  );
}

/** One recorded fact or authored comment, independent of its surrounding timeline container. */
export function TaskActivityContent({
  entry,
  history = [entry],
  showPerformer = true,
  exactTime = false,
  expanded = false,
}: TaskActivityContentProps): JSX.Element {
  const [open, setOpen] = useState(expanded);
  return (
    <div className="text-body-medium min-w-0">
      {entry.subjectTaskTitle ? (
        <p className="text-label-medium mb-1">{entry.subjectTaskTitle}</p>
      ) : null}
      <ActivityHeading
        entry={entry}
        history={history}
        showPerformer={showPerformer}
        exactTime={exactTime}
        open={open}
        onOpenChange={setOpen}
      />
      <CommentEditAttribution entry={entry} />
      <ActivityBody entry={entry} open={open} />
    </div>
  );
}
