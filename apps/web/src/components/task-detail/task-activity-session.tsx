'use client';

/** A geometric contribution in the task's one shared chronological timeline. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
  TimelineItem,
  TimelineMarker,
} from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';
import { relativeTime } from '@/components/project-detail/format-time';
import type { ActivitySessionGroup } from './activity-session-groups';
import { activitySentence } from './format-activity';

/** Disclosure retains shared keyboard, focus and reduced-motion behavior. */
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
        <Button variant="ghost" size="sm" className="group justify-start gap-2">
          <ChevronDown
            aria-hidden="true"
            className="size-4 -rotate-90 transition-transform duration-[var(--dur-fast)] group-data-[state=open]:rotate-0 motion-reduce:transition-none"
          />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Preserve the exact time of each source record even when its details are collapsed. */
function EntryTime({
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
      title={entry.createdAt}
      className="text-label-small text-on-surface-variant font-mono tabular-nums"
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

/** A recorded field change, with its related subject and complete before/after content. */
function SessionChange({ entry }: { readonly entry: TaskActivityOut }): JSX.Element | null {
  const change = entry.change;
  if (!change) return null;
  const label = change.field === 'description' ? 'Description revised' : `${change.label} changed`;
  return (
    <li className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-label-medium">{entry.subjectTaskTitle}</span>
        <EntryTime entry={entry} exact />
      </div>
      {change.field !== 'description' && (change.to?.length ?? 0) < 100 ? (
        <p className="text-body-small text-on-surface-variant break-words">
          {activitySentence({ ...entry, change: { ...change, from: null } })}
        </p>
      ) : null}
      <Disclosure label={label}>
        <dl className="text-body-small grid min-w-0 gap-3 pl-3">
          <div>
            <dt className="text-label-small text-on-surface-variant">Before</dt>
            <dd className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
              {change.from ?? 'Not set'}
            </dd>
          </div>
          <div>
            <dt className="text-label-small text-on-surface-variant">After</dt>
            <dd className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
              {change.to ?? 'Not set'}
            </dd>
          </div>
        </dl>
      </Disclosure>
    </li>
  );
}

/** Props for a contribution; compact rendering keeps authorship notes without repeated avatars. */
export interface TaskActivitySessionProps {
  readonly group: ActivitySessionGroup;
  readonly renderEntry: (entry: TaskActivityOut, compact?: boolean) => ReactNode;
}

/** Partition source facts without treating thoughts or proposed actions as completed changes. */
function contributionParts(entries: readonly TaskActivityOut[]) {
  const updates = entries.filter(
    (entry) => entry.body && !entry.change && entry.sessionEvent !== 'change',
  );
  const authored = updates.filter(
    (entry) => entry.sessionEvent !== 'question' && entry.sessionEvent !== 'error',
  );
  const latest = authored.at(-1);
  const visible = updates.filter(
    (entry) =>
      entry === latest || entry.sessionEvent === 'question' || entry.sessionEvent === 'error',
  );
  const earlier = authored.filter((entry) => entry !== latest);
  const changes = entries.filter((entry) => entry.change !== null);
  const facts = entries.filter((entry) => entry.type === 'created');
  return { visible, earlier, changes, facts };
}

/** One identity header on the spine; the time describes this visible contribution, not runtime. */
function SessionHeader({ group }: { readonly group: ActivitySessionGroup }): JSX.Element {
  const last = group.entries.at(-1);
  return (
    <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="text-label-large flex min-w-0 flex-wrap items-baseline gap-2">
        <span>{group.session?.title}</span>
        {group.continued ? (
          <span className="text-label-small text-on-surface-variant">Continued</span>
        ) : null}
      </div>
      {last ? <EntryTime entry={last} /> : null}
    </header>
  );
}

/** Distinguish past authored updates, recorded mutations without exposing an execution transcript. */
function SessionDisclosures({
  parts,
  renderEntry,
}: {
  readonly parts: ReturnType<typeof contributionParts>;
  readonly renderEntry: TaskActivitySessionProps['renderEntry'];
}): JSX.Element | null {
  if (parts.earlier.length === 0 && parts.changes.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {parts.earlier.length > 0 ? (
        <Disclosure
          label={`${parts.earlier.length} earlier ${parts.earlier.length === 1 ? 'update' : 'updates'}`}
        >
          <ol className="flex flex-col gap-4">
            {parts.earlier.map((entry) => renderEntry(entry, true))}
          </ol>
        </Disclosure>
      ) : null}
      {parts.changes.length > 0 ? (
        <Disclosure
          label={`${parts.changes.length} ${parts.changes.length === 1 ? 'change' : 'changes'}`}
        >
          <ol className="flex min-w-0 flex-col gap-4">
            {parts.changes.map((entry) => (
              <SessionChange key={entry.id} entry={entry} />
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </div>
  );
}

/** Show results and notices prominently, with disclosures for recorded changes. */
export function TaskActivitySession({
  group,
  renderEntry,
}: TaskActivitySessionProps): JSX.Element | null {
  const first = group.entries[0];
  if (!first || !group.session) return null;
  const parts = contributionParts(group.entries);
  if (parts.visible.length + parts.changes.length + parts.facts.length === 0) return null;
  return (
    <TimelineItem connector node={<TimelineMarker />}>
      <Surface
        as="article"
        tone="card"
        shape="small"
        pad="comfortable"
        aria-label={group.session.title}
        className="flex min-w-0 flex-col gap-4"
      >
        <SessionHeader group={group} />
        {parts.visible.map((entry) => (
          <div key={entry.id} className="min-w-0">
            {entry.sessionEvent === 'question' || entry.sessionEvent === 'error' ? (
              <p className="text-label-medium mb-1">
                {entry.sessionEvent === 'question' ? 'Question' : 'Execution issue'}
              </p>
            ) : null}
            <ol>{renderEntry(entry, true)}</ol>
          </div>
        ))}
        {parts.facts.map((entry) => (
          <div key={entry.id} className="text-body-small flex flex-wrap justify-between gap-2">
            <span>Created this task</span>
            <EntryTime entry={entry} />
          </div>
        ))}
        <SessionDisclosures parts={parts} renderEntry={renderEntry} />
      </Surface>
    </TimelineItem>
  );
}
