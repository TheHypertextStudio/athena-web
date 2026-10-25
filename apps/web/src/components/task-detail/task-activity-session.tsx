'use client';

/** A bounded agent contribution inside the task's shared chronological conversation. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { ActorAvatar } from '@docket/ui/components';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
} from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';
import { relativeTime } from '@/components/project-detail/format-time';
import type { ActivitySessionGroup } from './activity-session-groups';
import { activitySentence } from './format-activity';

/** Shared disclosure with a keyboard-operable trigger and visible expansion state. */
function Disclosure({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group justify-start gap-1.5">
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 -rotate-90 transition-transform group-data-[state=open]:rotate-0 motion-reduce:transition-none"
          />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Keep long descriptions out of the default history while preserving the exact before/after. */
function SessionChange({ entry }: { readonly entry: TaskActivityOut }): JSX.Element {
  const change = entry.change;
  if (!change)
    return (
      <p className="text-body-small text-on-surface-variant">
        {entry.body ??
          (entry.type === 'created' ? 'Created this task' : 'Recorded an execution update')}
      </p>
    );
  const label = change.field === 'description' ? 'Description revised' : `${change.label} changed`;
  return (
    <Disclosure label={label}>
      <dl className="text-body-small grid min-w-0 gap-3 pl-5">
        <div>
          <dt className="text-label-small text-on-surface-variant">Before</dt>
          <dd className="mt-1 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
            {change.from ?? 'Not set'}
          </dd>
        </div>
        <div>
          <dt className="text-label-small text-on-surface-variant">After</dt>
          <dd className="mt-1 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
            {change.to ?? 'Not set'}
          </dd>
        </div>
      </dl>
    </Disclosure>
  );
}

/** Props for one explicit session contribution. */
export interface TaskActivitySessionProps {
  readonly group: ActivitySessionGroup;
  /** Existing row renderer preserves original authorship and comment-edit attribution in disclosure. */
  readonly renderEntry: (entry: TaskActivityOut) => ReactNode;
}

/** Preserve each related subject and before/after inside the mechanical-change disclosure. */
function SessionChanges({
  entries,
}: {
  readonly entries: readonly TaskActivityOut[];
}): JSX.Element | null {
  if (entries.length === 0) return null;
  const changes = entries;
  const changeCount = `${entries.length} ${entries.length === 1 ? 'change' : 'changes'}`;
  return (
    <Disclosure label={changeCount}>
      <ul className="flex min-w-0 flex-col gap-2">
        {changes.map((entry) => (
          <li key={entry.id} className="min-w-0">
            {entry.change &&
            entry.change.field !== 'description' &&
            (entry.change.to?.length ?? 0) < 100 ? (
              <p className="text-body-small text-on-surface-variant break-words">
                {activitySentence({ ...entry, change: { ...entry.change, from: null } })}
              </p>
            ) : null}
            {entry.subjectTaskTitle ? (
              <p className="text-label-medium break-words">{entry.subjectTaskTitle}</p>
            ) : null}
            <SessionChange entry={entry} />
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** Keep session identity and its time span distinct from the authored updates below. */
function SessionHeader({ group }: { readonly group: ActivitySessionGroup }): JSX.Element | null {
  const session = group.session;
  const first = group.entries[0];
  const last = group.entries.at(-1);
  if (!session || !first || !last) return null;
  return (
    <header className="flex min-w-0 items-start gap-3">
      <ActorAvatar kind="agent" name={session.title} size={28} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-label-large flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>{session.title}</span>
          {group.continued ? (
            <span className="text-label-small text-on-surface-variant">Continued</span>
          ) : null}
        </div>
        <div className="text-label-small text-on-surface-variant flex flex-wrap gap-x-2">
          <span>{session.kind === 'connection' ? 'Connected client' : 'Agent work'}</span>
          <time dateTime={first.createdAt} title={first.createdAt}>
            {relativeTime(first.createdAt)}
          </time>
          {first.createdAt !== last.createdAt ? (
            <span title={last.createdAt}>Updated {relativeTime(last.createdAt)}</span>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Show the latest authored update prominently and retain every earlier update and mechanical edit. */
export function TaskActivitySession({
  group,
  renderEntry,
}: TaskActivitySessionProps): JSX.Element | null {
  const first = group.entries[0];
  const last = group.entries.at(-1);
  if (!first || !last || !group.session) return null;
  const updates = group.entries.filter(
    (entry) => entry.body && !entry.change && entry.sessionEvent !== 'change',
  );
  const authored = updates.filter(
    (entry) => entry.sessionEvent !== 'question' && entry.sessionEvent !== 'error',
  );
  const latest = authored.at(-1);
  const earlier = updates.filter(
    (entry) =>
      entry !== latest && entry.sessionEvent !== 'question' && entry.sessionEvent !== 'error',
  );
  const visible = updates.filter(
    (entry) =>
      entry === latest || entry.sessionEvent === 'question' || entry.sessionEvent === 'error',
  );
  const updateIds = new Set(updates.map((entry) => entry.id));
  const changes = group.entries.filter((entry) => !updateIds.has(entry.id));
  const changeCount = `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`;
  return (
    <li className="min-w-0">
      <Surface
        as="article"
        tone="card"
        pad="comfortable"
        aria-label={group.session.title}
        className="flex min-w-0 flex-col gap-4"
      >
        <SessionHeader group={group} />
        <div className="flex min-w-0 flex-col gap-3 sm:pl-10">
          {visible.map((entry) => (
            <div key={entry.id} className="min-w-0">
              {entry.sessionEvent === 'question' || entry.sessionEvent === 'error' ? (
                <p className="text-label-medium text-on-surface">
                  {entry.sessionEvent === 'question' ? 'Question' : 'Execution issue'}
                </p>
              ) : null}
              <ol>{renderEntry(entry)}</ol>
            </div>
          ))}
          {!latest ? (
            <p className="text-body-medium text-on-surface-variant">{changeCount} to this task</p>
          ) : null}
          {earlier.length > 0 ? (
            <Disclosure
              label={`${earlier.length} earlier ${earlier.length === 1 ? 'update' : 'updates'}`}
            >
              <ol className="flex flex-col gap-4">{earlier.map(renderEntry)}</ol>
            </Disclosure>
          ) : null}
          <SessionChanges entries={changes} />
        </div>
      </Surface>
    </li>
  );
}
