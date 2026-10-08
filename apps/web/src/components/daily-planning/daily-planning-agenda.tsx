'use client';

/** Timed daily agenda and explicit block controls for keyboard and touch. */
import type { DailyPlanSession, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { instantAt, localMinuteOfDay } from '@docket/planning/zoned-time';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@docket/ui/primitives';
import { ChevronDown } from '@docket/ui/icons';
import type { JSX, ReactNode } from 'react';
import { SchedulingCanvas, type ScheduleItem } from '@/components/scheduling';
import { useDailyPlanDropTarget } from '@/components/dnd/use-daily-plan-drop-target';

import { type BusyInterval } from './daily-planning-model';

/** One fixed calendar event. */
export interface EventBlock extends BusyInterval {
  readonly title: string;
  readonly allDay?: boolean | undefined;
}

/** Format a timed agenda label in the workday timezone. */
export function clock(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
}

/** Format a time input value in the workday timezone. */
export function clockValue(instant: string, timezone: string): string {
  const minute = localMinuteOfDay(new Date(instant), timezone);
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

interface DailyAgendaProps {
  readonly date: string;
  readonly timezone: string;
  readonly startAt: string;
  readonly draft: DailyPlanSnapshot;
  readonly events: readonly EventBlock[];
  readonly names: ReadonlyMap<string, string>;
  readonly onEdit: (session: DailyPlanSession) => void;
  readonly onDropTask: (taskId: string, minute: number) => void;
  readonly onAddToBlock: (taskId: string, sessionId: string) => void;
  readonly onChangeSession: (session: DailyPlanSession, startsAt: string, endsAt: string) => void;
}

function AgendaTaskTarget({
  item,
  onDrop,
  children,
}: {
  readonly item: ScheduleItem;
  readonly onDrop: (taskId: string, sessionId: string) => void;
  readonly children: ReactNode;
}): JSX.Element {
  const drop = useDailyPlanDropTarget({
    startMinutesAt: () => 0,
    onDropTask: (taskId) => {
      onDrop(taskId, item.id);
    },
    priority: 5,
    effectLabel: 'Add task to block',
  });
  return (
    <span
      ref={drop.ref}
      className={`block h-full min-w-0 ${drop.isOver ? 'ring-primary ring-2' : ''}`}
    >
      {children}
    </span>
  );
}

function AgendaGridTarget({
  pixelsPerHour,
  onDropTask,
  date,
  timezone,
}: {
  readonly pixelsPerHour: number;
  readonly onDropTask: DailyAgendaProps['onDropTask'];
  readonly date: string;
  readonly timezone: string;
}): JSX.Element {
  const drop = useDailyPlanDropTarget({
    startMinutesAt: (clientY, bounds) =>
      Math.round((((clientY - bounds.top) / pixelsPerHour) * 60) / 15) * 15,
    onDropTask,
  });
  return (
    <div
      ref={drop.ref}
      className={`pointer-events-auto absolute inset-0 ${drop.isOver ? 'bg-primary/5 ring-primary ring-1' : ''}`}
      aria-label="Drop task at a time"
    >
      {drop.startMinutes !== null ? (
        <span
          className="text-primary text-label-small before:bg-primary pointer-events-none absolute inset-x-0 z-10 before:absolute before:inset-x-0 before:top-0 before:h-0.5"
          style={{ top: (drop.startMinutes / 60) * pixelsPerHour }}
        >
          {clock(instantAt(date, drop.startMinutes, timezone).toISOString(), timezone)}
        </span>
      ) : null}
    </div>
  );
}

function agendaItems(props: DailyAgendaProps): ScheduleItem[] {
  return [
    ...props.events
      .filter((event) => !event.allDay)
      .map((event, index) => ({
        ...event,
        id: `fixed-${index}`,
        editable: false,
        openable: false,
        appearance: 'event' as const,
      })),
    ...props.draft.sessions.map((session) => ({
      ...session,
      title: session.allocations.map((part) => props.names.get(part.taskId) ?? 'Task').join(' · '),
      appearance: 'timebox' as const,
      editable: !session.pinned && Date.parse(session.startsAt) >= Date.parse(props.startAt),
      readOnlyLabel: session.pinned ? 'Pinned' : undefined,
    })),
  ];
}

function AllDayContext({ events }: { readonly events: readonly EventBlock[] }): JSX.Element | null {
  const allDay = events.filter((event) => event.allDay);
  if (allDay.length === 0) return null;
  const busy = allDay.filter((event) => event.blocksTime !== false);
  const label =
    busy.length === 1
      ? `${busy[0]?.title} · Busy all day`
      : busy.length > 1
        ? `${busy.length} busy all-day events`
        : `${allDay.length} all-day ${allDay.length === 1 ? 'event' : 'events'}`;
  return (
    <Collapsible role="group" aria-label="All-day calendar context" className="space-y-1">
      <CollapsibleTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="group h-auto max-w-full justify-start gap-2 text-left"
        >
          <span className="text-body-small text-on-surface-variant min-w-0 text-wrap">{label}</span>
          <ChevronDown aria-hidden="true" className="shrink-0 group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="text-body-small text-on-surface-variant space-y-1 px-3">
          {allDay.map((event, index) => (
            <li key={`${event.title}-${index}`}>
              {event.title}
              {event.blocksTime !== false ? ' (busy)' : ''}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function changeAgendaSession(
  props: DailyAgendaProps,
  id: string,
  startMinutes: number,
  endMinutes: number,
): void {
  const session = props.draft.sessions.find((value) => value.id === id);
  if (!session) return;
  props.onChangeSession(
    session,
    instantAt(props.date, startMinutes, props.timezone).toISOString(),
    instantAt(props.date, endMinutes, props.timezone).toISOString(),
  );
}

/** Use the shared calendar geometry and move/resize gestures for the daily draft. */
export function DailyAgenda(props: DailyAgendaProps): JSX.Element {
  const items = agendaItems(props);
  return (
    <>
      <AllDayContext events={props.events} />
      <SchedulingCanvas
        presentation="agenda"
        preserveTimedGeometry
        displayTimezone={props.timezone}
        lanes={[{ id: props.date, date: props.date, label: 'Agenda', items }]}
        pixelsPerHour={84}
        viewportHeight={560}
        minimumLaneWidth={180}
        initialScrollMinutes={Math.max(
          0,
          localMinuteOfDay(new Date(props.startAt), props.timezone) - 15,
        )}
        onOpenItem={({ item }) => {
          const session = props.draft.sessions.find((value) => value.id === item.id);
          if (session) props.onEdit(session);
        }}
        onMoveItem={({ item, startMinutes, endMinutes }) => {
          changeAgendaSession(props, item.id, startMinutes, endMinutes);
        }}
        onResizeItem={({ item, startMinutes, endMinutes }) => {
          changeAgendaSession(props, item.id, startMinutes, endMinutes);
        }}
        renderTimedLaneContext={({ geometry }) => (
          <AgendaGridTarget
            pixelsPerHour={geometry.pixelsPerHour}
            onDropTask={props.onDropTask}
            date={props.date}
            timezone={props.timezone}
          />
        )}
        renderItem={({ item }) =>
          item.appearance === 'timebox' ? (
            <AgendaTaskTarget item={item} onDrop={props.onAddToBlock}>
              {item.title}
            </AgendaTaskTarget>
          ) : (
            item.title
          )
        }
      />
      <div className="space-y-1">
        {props.draft.sessions
          .filter(
            (session) =>
              session.allocations.length > 1 ||
              (Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000 < 20,
          )
          .map((session) => (
            <Button
              key={session.id}
              size="sm"
              variant="ghost"
              className="h-auto min-h-10 w-full justify-start text-left whitespace-normal"
              onClick={() => {
                props.onEdit(session);
              }}
            >
              {clock(session.startsAt, props.timezone)} ·{' '}
              {session.allocations
                .map((part) => props.names.get(part.taskId) ?? 'Task')
                .join(' · ')}
            </Button>
          ))}
      </div>
    </>
  );
}
