'use client';

/** A geometric contribution in the task's one shared chronological timeline. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FileText,
  Flag,
  Link,
  MessageSquare,
  Edit,
  User,
} from '@docket/ui/icons';
import { ActorAvatar, type ActorKind } from '@docket/ui/components';
import { ActivityAgentAvatar } from './activity-agent-avatar';
import {
  Button,
  DecorativeIcon,
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
import { consolidateTaskChanges, type ConsolidatedTaskChange } from './consolidated-task-changes';
import { activityPerformer } from './format-activity';
import { StaticMarkdown } from '@/components/editor/static-markdown';

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
        <Button
          variant="ghost"
          size="sm"
          className="group coarse:min-h-10 text-body-medium h-auto min-h-8 justify-start gap-2 text-left whitespace-normal"
        >
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

/** Show the observed window of this contribution, independent of an execution lifecycle. */
function ContributionTime({
  entries,
}: {
  readonly entries: readonly TaskActivityOut[];
}): JSX.Element | null {
  const first = entries[0];
  const last = entries.at(-1);
  if (!first || !last) return null;
  if (first.createdAt === last.createdAt) return <EntryTime entry={last} />;
  const start = new Date(first.createdAt);
  const end = new Date(last.createdAt);
  const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const today =
    start.toDateString() === new Date().toDateString() &&
    end.toDateString() === start.toDateString();
  const display = today ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }) : full;
  return (
    <span
      className="text-label-small text-on-surface-variant tabular-nums"
      aria-label={`Recorded activity from ${full.format(start)} to ${full.format(end)}`}
      title={`${first.createdAt} — ${last.createdAt}`}
    >
      {display.formatRange(start, end)}
    </span>
  );
}

/** A recorded field change, with its related subject and complete before/after content. */
function SessionChange({ entry, history }: ConsolidatedTaskChange): JSX.Element | null {
  const change = entry.change;
  if (!change) return null;
  const label =
    history.length > 1
      ? `View ${history.length} ${change.label.toLowerCase()} edits`
      : `View ${change.label.toLowerCase()} change`;
  return (
    <li className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
      <DecorativeIcon variant="inline" icon={changeIcon(change.field)} />
      <div className="min-w-0">
        {entry.subjectTaskTitle ? (
          <p className="text-label-medium">{entry.subjectTaskTitle}</p>
        ) : null}
        <ChangeContent entry={entry} />
      </div>
      <div className="col-start-2 -ml-3 min-w-0">
        <Disclosure label={label}>
          <ol className="flex flex-col gap-4">
            {history.map((edit) => (
              <ChangeDetails key={edit.id} entry={edit} />
            ))}
          </ol>
        </Disclosure>
      </div>
    </li>
  );
}

/** Exact source values and time remain available for every individual edit. */
function ChangeDetails({ entry }: { readonly entry: TaskActivityOut }): JSX.Element | null {
  const change = entry.change;
  if (!change) return null;
  return (
    <li>
      <div className="mb-2 pl-3">
        <EntryTime entry={entry} exact />
      </div>
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
    </li>
  );
}

/** Semantic glyphs make different effects scannable without decorating each line of prose. */
function changeIcon(field: string) {
  const icons: Partial<Record<string, typeof Edit>> = {
    description: FileText,
    dependency: Link,
    relatedTask: Link,
    assigneeId: User,
    priority: Flag,
    state: CheckCircle2,
    dueDate: Calendar,
    startDate: Calendar,
  };
  return icons[field] ?? Edit;
}

/** Show recorded content and values directly, without manufacturing an agent-authored report. */
function ChangeContent({ entry }: { readonly entry: TaskActivityOut }): JSX.Element | null {
  const change = entry.change;
  if (!change) return null;
  if (change.field === 'description')
    return (
      <div>
        <p className="text-label-medium text-on-surface-variant mb-1">Description</p>
        {change.to ? (
          <StaticMarkdown
            value={change.to}
            className={
              change.to.length > 600
                ? 'text-body-medium line-clamp-6 [overflow-wrap:anywhere] [&>*]:max-w-none'
                : 'text-body-medium [overflow-wrap:anywhere] [&>*]:max-w-none'
            }
          />
        ) : (
          <p className="text-body-medium">Description removed</p>
        )}
      </div>
    );
  if (change.field === 'dependency' && change.to)
    return (
      <div className="text-body-medium flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-on-surface-variant">
          {change.to.startsWith('Blocked by ') ? 'Blocked by' : 'Blocks'}
        </span>
        <span className="[overflow-wrap:anywhere]">
          {change.to.replace(/^(Blocks|Blocked by) /, '')}
        </span>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
      <p className="text-label-medium text-on-surface-variant">{change.label}</p>
      <p className="text-body-medium [overflow-wrap:anywhere]">
        {change.from ? (
          <>
            <del className="text-on-surface-variant">{change.from}</del>
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> changed to </span>
          </>
        ) : null}
        {change.to ?? 'Removed'}
      </p>
    </div>
  );
}

/** Name only the work evidenced by the contribution, never an inferred assignment or outcome. */
function contributionHeading(group: ActivitySessionGroup): string {
  const fields = new Set(
    group.entries.flatMap((entry) => (entry.change ? [entry.change.field] : [])),
  );
  if (fields.has('description') && fields.has('dependency'))
    return 'Updated description and linked work';
  if (fields.has('description')) return 'Updated the task description';
  if (fields.has('dependency')) return 'Updated linked work';
  if (fields.size > 0) return 'Updated task details';
  if (group.entries.some((entry) => entry.sessionEvent === 'question'))
    return 'Question about this task';
  return 'Task update';
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

/** Use the existing verified provenance labels without inferring delegation or an assignment. */
function sessionAttribution(group: ActivitySessionGroup): {
  performer: string;
  detail: string | null;
  avatarKind: ActorKind;
} {
  const entry = group.entries[0];
  if (entry && (entry.origin || entry.actorId)) {
    const performer = activityPerformer(entry, null);
    return {
      performer: performer.name,
      detail: performer.detail,
      avatarKind: performer.avatarKind,
    };
  }
  return { performer: group.session?.title ?? 'Agent', detail: null, avatarKind: 'agent' };
}

/** One identity header on the spine; the time describes this visible contribution, not runtime. */
function SessionHeader({ group }: { readonly group: ActivitySessionGroup }): JSX.Element {
  const attribution = sessionAttribution(group);
  const artwork = group.entries.find((entry) => entry.agentIconUrl)?.agentIconUrl;
  return (
    <Surface
      as="header"
      tone="floating"
      shape="none"
      pad="comfortable"
      className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3"
    >
      {attribution.avatarKind === 'agent' ? (
        <ActivityAgentAvatar
          name={attribution.performer}
          iconUrl={artwork ?? null}
          native={group.entries[0]?.origin?.performerKind === 'athena'}
        />
      ) : (
        <ActorAvatar kind={attribution.avatarKind} name={attribution.performer} size={32} />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-title-small">{contributionHeading(group)}</h3>
        <div className="text-body-small text-on-surface-variant flex flex-wrap items-baseline gap-x-2">
          <span>{attribution.performer}</span>
          {attribution.detail ? <span>{attribution.detail}</span> : null}
          {group.session?.kind === 'connection' ? <span>Connection activity</span> : null}
          {group.continued ? <span>Continued</span> : null}
          <ContributionTime entries={group.entries} />
        </div>
      </div>
    </Surface>
  );
}

/** Keep ordinary lists readable; fold only the middle of unusually long change sequences. */
function SessionChanges({
  entries,
}: {
  readonly entries: readonly TaskActivityOut[];
}): JSX.Element | null {
  if (entries.length === 0) return null;
  const changes = consolidateTaskChanges(entries);
  const long = changes.length > 10;
  const rows = (items: readonly ConsolidatedTaskChange[]): JSX.Element => (
    <ol className="flex min-w-0 flex-col gap-4">
      {items.map((change) => (
        <SessionChange key={change.history[0]?.id} {...change} />
      ))}
    </ol>
  );
  if (!long) return rows(changes);
  return (
    <>
      {rows(changes.slice(0, 3))}
      <Disclosure
        label={`Show ${changes.slice(3, -3).reduce((count, change) => count + change.history.length, 0)} more changes`}
      >
        {rows(changes.slice(3, -3))}
      </Disclosure>
      {rows(changes.slice(-3))}
    </>
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
    <div className="flex min-w-0 flex-col gap-4">
      {parts.earlier.length > 0 ? (
        <Disclosure
          label={`${parts.earlier.length} earlier ${parts.earlier.length === 1 ? 'update' : 'updates'}`}
        >
          <ol className="flex flex-col gap-4">
            {parts.earlier.map((entry) => renderEntry(entry, true))}
          </ol>
        </Disclosure>
      ) : null}
      <SessionChanges entries={parts.changes} />
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
        pad="none"
        aria-label={group.session.title}
        className="overflow-hidden"
      >
        <SessionHeader group={group} />
        <div className="flex min-w-0 flex-col gap-4 p-3">
          {parts.visible.map((entry) => {
            const notice = entry.sessionEvent === 'question' || entry.sessionEvent === 'error';
            const content = <ol>{renderEntry(entry, true)}</ol>;
            return notice ? (
              <div
                key={entry.id}
                className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3"
              >
                <DecorativeIcon
                  variant="inline"
                  className="mt-3"
                  icon={entry.sessionEvent === 'question' ? MessageSquare : CircleAlert}
                />
                <Surface as="section" tone="page" shape="small" pad="comfortable">
                  <p className="text-label-large mb-2">
                    {entry.sessionEvent === 'question' ? 'Question' : 'Execution issue'}
                  </p>
                  {content}
                </Surface>
              </div>
            ) : (
              <div key={entry.id} className="min-w-0 pl-11">
                {content}
              </div>
            );
          })}
          {parts.facts.map((entry) => (
            <div key={entry.id} className="text-body-small flex flex-wrap justify-between gap-2">
              <span>Created this task</span>
              <EntryTime entry={entry} />
            </div>
          ))}
          <SessionDisclosures parts={parts} renderEntry={renderEntry} />
        </div>
      </Surface>
    </TimelineItem>
  );
}
