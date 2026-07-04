'use client';

/**
 * `agenda/agenda-entry-card` — the shared agenda entry primitive.
 *
 * @remarks
 * One entry, one component, used by every view — the list stacks it, the timeline positions it. It
 * both **rearranges** (the view places it) and **reshapes** (the `layout` prop): a compact `row`
 * (time · title · org) in the list, a fill-height `block` (title / time / org) in the timeline.
 * Because it's the same element keyed by a stable `view-transition-name`, switching views morphs
 * each card from one shape/position to the other rather than swapping.
 *
 * The card carries the check-off control (when the entry is on the plan) as a sibling of the
 * navigating content, so neither nests inside the other.
 */
import { Calendar, CheckCircle2, Circle } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import Link from 'next/link';
import { type JSX, useRef } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { OrgChip } from '@/components/org-chip';
import { formatClock } from '@/lib/format-time';
import { prefersReducedMotion } from '@/lib/motion';

import AgendaEntryActions from './agenda-entry-actions';
import {
  type AgendaEntry,
  agendaEntryTransitionName,
  isTimeboxed,
  useAgenda,
} from './agenda-context';

/** How the card lays out: a compact list `row`, or a fill-height timeline `block`. */
export type AgendaEntryLayout = 'row' | 'block';

/** Props for {@link AgendaEntryCard}. */
export interface AgendaEntryCardProps {
  /** The entry to render. */
  entry: AgendaEntry;
  /** How the card lays out (default `row`). */
  layout?: AgendaEntryLayout;
}

/** The shared entry card, reshaped by `layout`, with a check-off and a link to the task. */
export default function AgendaEntryCard({
  entry,
  layout = 'row',
}: AgendaEntryCardProps): JSX.Element {
  const { orgName } = useActiveOrg();
  const { toggleDone } = useAgenda();
  const checkRef = useRef<HTMLButtonElement>(null);
  const block = layout === 'block';

  /** Toggle done, and on *completing* a task give the check a quick satisfying pop (Web Animations). */
  function onToggle(): void {
    const marking = !entry.done;
    toggleDone(entry);
    const el = checkRef.current;
    if (marking && el && 'animate' in el && !prefersReducedMotion()) {
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }],
        { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
  }
  const time = isTimeboxed(entry)
    ? block
      ? `${formatClock(entry.startsAt)} – ${formatClock(entry.endsAt)}`
      : formatClock(entry.startsAt)
    : block
      ? 'Anytime'
      : '—';
  const taskOrgId = entry.source === 'task' ? entry.organizationId : undefined;
  const taskId = entry.source === 'task' ? entry.taskId : undefined;
  const isTask = taskId !== undefined && taskOrgId !== undefined;
  const titleClass = cn(
    'truncate text-sm font-medium',
    entry.done ? 'text-on-surface-variant line-through' : 'text-on-surface',
  );
  const contextLabel =
    entry.source === 'google_calendar_event'
      ? [entry.calendar?.title, entry.calendar?.accountEmail].filter(Boolean).join(' · ')
      : null;
  const content = block ? (
    <>
      <span className={titleClass}>{entry.title}</span>
      <span className="text-on-surface-variant truncate text-xs tabular-nums">{time}</span>
      <div className="mt-auto pt-1">
        {isTask ? (
          <OrgChip orgId={taskOrgId} name={orgName(taskOrgId)} />
        ) : (
          <span className="text-on-surface-variant truncate text-xs">{contextLabel}</span>
        )}
      </div>
    </>
  ) : (
    <>
      <span className="text-on-surface-variant w-14 shrink-0 pt-0.5 text-xs tabular-nums">
        {time}
      </span>
      <span className={cn('flex-1', titleClass)}>{entry.title}</span>
      {isTask ? (
        <OrgChip orgId={taskOrgId} name={orgName(taskOrgId)} />
      ) : (
        <span className="text-on-surface-variant max-w-28 truncate text-xs">{contextLabel}</span>
      )}
    </>
  );

  return (
    <div
      style={{ viewTransitionName: agendaEntryTransitionName(entry.id) }}
      className={cn(
        'border-outline-variant bg-surface-container-low hover:bg-surface-container hover:border-outline flex h-full w-full items-start gap-2 overflow-hidden rounded-lg border px-2.5 py-2 transition-[opacity,background-color,border-color,box-shadow,transform] duration-(--dur-base) ease-(--ease-out) hover:shadow-sm motion-safe:hover:-translate-y-px',
        entry.done && 'opacity-60',
      )}
    >
      {entry.planItemId ? (
        <button
          ref={checkRef}
          type="button"
          aria-pressed={entry.done}
          aria-label={entry.done ? 'Mark not done' : 'Mark done'}
          onClick={onToggle}
          className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring mt-0.5 shrink-0 rounded-full transition-[color,transform] duration-(--dur-fast) hover:scale-110 focus-visible:ring-2 focus-visible:outline-none active:scale-90 [&_svg]:size-4"
        >
          {entry.done ? <CheckCircle2 className="text-primary" /> : <Circle />}
        </button>
      ) : entry.source === 'google_calendar_event' ? (
        <span
          aria-hidden="true"
          className="text-on-surface-variant mt-0.5 shrink-0 rounded-full [&_svg]:size-4"
        >
          <Calendar style={{ color: entry.calendar?.color ?? undefined }} />
        </span>
      ) : null}
      {isTask ? (
        <Link
          href={`/orgs/${taskOrgId}/tasks/${taskId}`}
          className={cn(
            'focus-visible:ring-ring flex min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none',
            block ? 'flex-col gap-0.5' : 'flex-row items-start gap-3',
          )}
        >
          {content}
        </Link>
      ) : entry.externalUrl ? (
        <a
          href={entry.externalUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'focus-visible:ring-ring flex min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none',
            block ? 'flex-col gap-0.5' : 'flex-row items-start gap-3',
          )}
        >
          {content}
        </a>
      ) : (
        <div
          className={cn('flex min-w-0 flex-1', block ? 'flex-col gap-0.5' : 'items-start gap-3')}
        >
          {content}
        </div>
      )}
      {entry.planItemId && isTask ? <AgendaEntryActions entry={entry} /> : null}
    </div>
  );
}
