'use client';

/** A session is a quiet metadata boundary around ordinary recorded activity. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { ActorAvatar } from '@docket/ui/components';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Edit,
  FileText,
  Flag,
  Link as LinkIcon,
  MessageSquare,
  User,
} from '@docket/ui/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DecorativeIcon,
  Card,
  TimelineItem,
  TimelineMarker,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import type { ActivitySessionGroup } from './activity-session-groups';
import { ActivityAgentAvatar } from './activity-agent-avatar';
import { consolidateTaskChanges, type ConsolidatedTaskChange } from './consolidated-task-changes';
import { activityPerformer } from './format-activity';
import { ActivityTime, TaskActivityContent } from './task-activity-content';

/** The range describes recorded activity, never an inferred execution lifecycle. */
function ContributionTime({
  entries,
}: {
  readonly entries: readonly TaskActivityOut[];
}): JSX.Element | null {
  const first = entries[0];
  const last = entries.at(-1);
  if (!first || !last) return null;
  if (first.createdAt === last.createdAt) return <ActivityTime entry={last} />;
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

/** Glyphs distinguish recorded actions, not kinds of agent execution. */
function entryIcon(entry: TaskActivityOut) {
  if (entry.sessionEvent === 'error') return CircleAlert;
  if (!entry.change) return MessageSquare;
  const icons: Partial<Record<string, typeof Edit>> = {
    description: FileText,
    dependency: LinkIcon,
    relatedTask: LinkIcon,
    assigneeId: User,
    priority: Flag,
    state: CheckCircle2,
    dueDate: Calendar,
    startDate: Calendar,
  };
  return icons[entry.change.field] ?? Edit;
}

/** A grouped row keeps the same content and disclosure used by the main feed. */
function RecordedRow({
  entry,
  history,
  detail = false,
}: {
  readonly entry: TaskActivityOut;
  readonly history?: readonly TaskActivityOut[] | undefined;
  readonly detail?: boolean;
}): JSX.Element {
  return (
    <li className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-start gap-3">
      <DecorativeIcon variant="inline" className="mt-1 w-6" icon={entryIcon(entry)} />
      <TaskActivityContent
        entry={entry}
        history={history ?? [entry]}
        showPerformer={detail}
        exactTime={detail}
        expanded={detail && Boolean(entry.change)}
      />
    </li>
  );
}

/** Only task-relevant persisted records belong in an entity's activity inspector. */
function visibleRecord(entry: TaskActivityOut): boolean {
  if (entry.change || entry.type === 'created') return true;
  return Boolean(entry.body) && entry.sessionEvent !== 'change';
}

/** Prefer verified performer identity, retaining a label for historical anonymous records. */
function sessionName(group: ActivitySessionGroup): string {
  const first = group.entries[0];
  if (first && (first.origin || first.actorId)) return activityPerformer(first, null).name;
  return group.session?.title.replace(/ session$/, '') ?? 'Agent';
}

/** Keep authority distinct from agent authorship without “for” ownership wording. */
function SessionAuthority({
  entry,
}: {
  readonly entry: TaskActivityOut | undefined;
}): JSX.Element | null {
  if (!entry?.origin || entry.origin.performerKind === 'person' || !entry.actorName) return null;
  const name = entry.actorName;
  return (
    <span
      className="text-body-small text-on-surface-variant flex min-w-0 items-center gap-1.5"
      title={`Authorized by ${name}`}
    >
      <span className="sr-only">Authorized by </span>
      <ActorAvatar kind="human" name={name} size={16} />
      <span className="[overflow-wrap:anywhere]">{name}</span>
    </span>
  );
}

/** Identity and time annotate work without turning the wrapper into a separate work item. */
function SessionHeader({ group }: { readonly group: ActivitySessionGroup }): JSX.Element {
  const name = sessionName(group);
  const artwork = group.entries.find((entry) => entry.agentIconUrl)?.agentIconUrl;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-3">
      <ActivityAgentAvatar
        name={name}
        iconUrl={artwork ?? null}
        size={24}
        native={group.entries[0]?.origin?.performerKind === 'athena'}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-label-large min-w-0 [overflow-wrap:anywhere]">
          {name}{' '}
          <span className="text-on-surface-variant text-body-small">
            {group.session?.kind === 'connection' ? 'connection' : 'session'}
          </span>
        </h3>
        <SessionAuthority entry={group.entries[0]} />
        {group.continued ? (
          <span className="text-label-small text-on-surface-variant">Continued</span>
        ) : null}
        <ContributionTime entries={group.entries} />
      </div>
    </header>
  );
}

/** Keep consolidated values at their latest recorded position, interleaved with authored comments. */
function contributionRows(entries: readonly TaskActivityOut[]): ConsolidatedTaskChange[] {
  const changes = new Map(
    consolidateTaskChanges(entries).map((change) => [change.entry.id, change]),
  );
  return entries.filter(visibleRecord).flatMap((entry) => {
    if (!entry.change) return [{ entry, history: [entry] }];
    const change = changes.get(entry.id);
    return change ? [change] : [];
  });
}

/** Fold only the middle of unusually long contributions; ordinary recorded work stays visible. */
function SessionRows({ entries }: { readonly entries: readonly TaskActivityOut[] }): JSX.Element {
  const rows = contributionRows(entries);
  const render = (items: readonly ConsolidatedTaskChange[]) => (
    <ol className="flex min-w-0 flex-col gap-4">
      {items.map((row) => (
        <RecordedRow key={row.entry.id} {...row} />
      ))}
    </ol>
  );
  if (rows.length <= 10) return render(rows);
  const middle = rows.slice(3, -3);
  const count = middle.reduce((total, row) => total + row.history.length, 0);
  const kind = middle.every((row) => row.entry.change) ? 'changes' : 'activity entries';
  return (
    <>
      {render(rows.slice(0, 3))}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group coarse:min-h-10 justify-start gap-2">
            <ChevronDown
              aria-hidden="true"
              className="size-4 -rotate-90 transition-transform duration-[var(--dur-fast)] group-data-[state=open]:rotate-0 motion-reduce:transition-none"
            />
            Show {count} more {kind}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="py-4">{render(middle)}</CollapsibleContent>
      </Collapsible>
      {render(rows.slice(-3))}
    </>
  );
}

/** Props for a time-bound metadata wrapper in the entity's shared activity timeline. */
export interface TaskActivitySessionProps {
  readonly group: ActivitySessionGroup;
}

/** Keep the session boundary quiet while its contents use ordinary feed rows in recorded order. */
export function TaskActivitySession({ group }: TaskActivitySessionProps): JSX.Element | null {
  if (!group.session || !group.entries.some(visibleRecord)) return null;
  return (
    <TimelineItem connector node={<TimelineMarker />}>
      <Card
        role="article"
        variant="outlined"
        className="bg-surface rounded-lg"
        aria-label={group.session.title}
      >
        <SessionHeader group={group} />
        <div className="flex min-w-0 flex-col gap-4 px-3 pb-3">
          <SessionRows entries={group.entries} />
        </div>
      </Card>
    </TimelineItem>
  );
}
