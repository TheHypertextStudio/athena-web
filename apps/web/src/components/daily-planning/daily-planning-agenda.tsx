'use client';

/** Timed daily agenda and explicit block controls for keyboard and touch. */
import type { DailyPlanSession, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { instantAt, localDateString, localMinuteOfDay } from '@docket/planning/zoned-time';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Select,
} from '@docket/ui/primitives';
import { useEffect, useRef, useState, type JSX } from 'react';
import { useDailyPlanDropTarget } from '@/components/dnd/use-daily-plan-drop-target';

import { nextAvailableStart, remainingMinutes, type BusyInterval } from './daily-planning-model';

/** One fixed calendar event. */
export interface EventBlock extends BusyInterval {
  readonly title: string;
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

interface SessionEditorProps {
  readonly date: string;
  readonly timezone: string;
  readonly earliestAt: string;
  readonly events: readonly EventBlock[];
  readonly draft: DailyPlanSnapshot;
  readonly editing: { taskId: string; sessionId?: string };
  readonly names: ReadonlyMap<string, string>;
  readonly onCancel: () => void;
  readonly onSave: (session: DailyPlanSession) => void;
  readonly onRemove: (id: string) => void;
}

interface SessionValues {
  readonly id: string;
  readonly date: string;
  readonly timezone: string;
  readonly start: string;
  readonly duration: number;
  readonly primary: string;
  readonly secondTask: string;
  readonly pinned: boolean;
}

function toSession(values: SessionValues): DailyPlanSession {
  const [hour, minute] = values.start.split(':').map(Number);
  const startsAt = instantAt(
    values.date,
    (hour ?? 9) * 60 + (minute ?? 0),
    values.timezone,
  ).toISOString();
  const primaryMinutes = values.secondTask ? Math.ceil(values.duration / 2) : values.duration;
  return {
    id: values.id,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + values.duration * 60_000).toISOString(),
    allocations: [
      { taskId: values.primary, plannedMinutes: primaryMinutes },
      ...(values.secondTask
        ? [{ taskId: values.secondTask, plannedMinutes: values.duration - primaryMinutes }]
        : []),
    ],
    pinned: values.pinned,
  };
}

interface SessionFieldsProps {
  readonly draft: DailyPlanSnapshot;
  readonly names: ReadonlyMap<string, string>;
  readonly primary: string;
  readonly start: string;
  readonly setStart: (value: string) => void;
  readonly duration: number;
  readonly setDuration: (value: number) => void;
  readonly secondTask: string;
  readonly setSecondTask: (value: string) => void;
  readonly pinned: boolean;
  readonly setPinned: (value: boolean) => void;
}

function sessionDuration(existing: DailyPlanSession | undefined, fallback: number): number {
  return existing
    ? Math.round((Date.parse(existing.endsAt) - Date.parse(existing.startsAt)) / 60_000)
    : fallback;
}

function initialSessionFields(props: SessionEditorProps) {
  const existing = props.draft.sessions.find((session) => session.id === props.editing.sessionId);
  const defaultDuration = Math.min(30, remainingMinutes(props.draft, props.editing.taskId));
  const firstSlot = nextAvailableStart(props.earliestAt, defaultDuration, props.draft.finishAt, [
    ...props.events,
    ...props.draft.sessions,
  ]);
  return {
    existing,
    start: clockValue(existing?.startsAt ?? firstSlot ?? props.earliestAt, props.timezone),
    duration: sessionDuration(existing, defaultDuration),
    secondTask: existing?.allocations[1]?.taskId ?? '',
    pinned: existing?.pinned ?? false,
    primary: existing?.allocations[0]?.taskId ?? props.editing.taskId,
  };
}

function SessionFields(props: SessionFieldsProps): JSX.Element {
  const options = [...new Set([props.duration, 15, 30, 45, 60, 90, 120])].sort((a, b) => a - b);
  const otherTasks = props.draft.tasks.filter(
    (task) =>
      task.taskId !== props.primary &&
      (remainingMinutes(props.draft, task.taskId) > 0 || task.taskId === props.secondTask),
  );
  return (
    <>
      <p>{props.names.get(props.primary) ?? 'Task'}</p>
      <label className="block">
        Start{' '}
        <Input
          type="time"
          value={props.start}
          onChange={(event) => {
            props.setStart(event.target.value);
          }}
        />
      </label>
      <label className="block">
        Duration{' '}
        <Select
          value={props.duration}
          onChange={(event) => {
            props.setDuration(Number(event.target.value));
          }}
        >
          {options.map((minute) => (
            <option key={minute} value={minute}>
              {minute} minutes
            </option>
          ))}
        </Select>
      </label>
      <label className="block">
        Add task to block{' '}
        <Select
          value={props.secondTask}
          onChange={(event) => {
            props.setSecondTask(event.target.value);
          }}
        >
          <option value="">None</option>
          {otherTasks.map((task) => (
            <option key={task.taskId} value={task.taskId}>
              {props.names.get(task.taskId) ?? 'Task'}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={props.pinned}
          onChange={(event) => {
            props.setPinned(event.target.checked);
          }}
        />
        Keep this block in place
      </label>
    </>
  );
}

/** Move, resize, pin, or add work to a timed block without dragging. */
export function SessionEditor(props: SessionEditorProps): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    editorRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const initial = initialSessionFields(props);
  const [start, setStart] = useState(initial.start);
  const [duration, setDuration] = useState(initial.duration);
  const [secondTask, setSecondTask] = useState(initial.secondTask);
  const [pinned, setPinned] = useState(initial.pinned);
  const { existing, primary } = initial;
  return (
    <div ref={editorRef}>
      <Card>
        <CardHeader>
          <CardTitle>{existing ? 'Move block' : 'Schedule task'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SessionFields
            draft={props.draft}
            names={props.names}
            primary={primary}
            start={start}
            setStart={setStart}
            duration={duration}
            setDuration={setDuration}
            secondTask={secondTask}
            setSecondTask={setSecondTask}
            pinned={pinned}
            setPinned={setPinned}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                props.onSave(
                  toSession({
                    id: existing?.id ?? crypto.randomUUID(),
                    date: props.date,
                    timezone: props.timezone,
                    start,
                    duration,
                    primary,
                    secondTask,
                    pinned,
                  }),
                );
              }}
            >
              Save block
            </Button>
            <Button variant="ghost" onClick={props.onCancel}>
              Cancel
            </Button>
            {existing ? (
              <Button
                variant="ghost"
                onClick={() => {
                  props.onRemove(existing.id);
                }}
              >
                Unschedule
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface DailyAgendaProps {
  readonly date: string;
  readonly timezone: string;
  readonly draft: DailyPlanSnapshot;
  readonly events: readonly EventBlock[];
  readonly names: ReadonlyMap<string, string>;
  readonly onEdit: (session: DailyPlanSession) => void;
  readonly onDropTask: (taskId: string, minute: number) => void;
}

function HourLabels({
  first,
  last,
  pixelsPerMinute,
}: {
  readonly first: number;
  readonly last: number;
  readonly pixelsPerMinute: number;
}): JSX.Element {
  return (
    <>
      {Array.from({ length: Math.ceil((last - first) / 60) + 1 }, (_, index) => (
        <span
          key={index}
          className="text-on-surface-variant text-label-small absolute -left-12"
          style={{ top: index * 60 * pixelsPerMinute }}
        >
          {String((first / 60 + index) % 24).padStart(2, '0')}:00
        </span>
      ))}
    </>
  );
}

function SessionBlocks({
  sessions,
  names,
  timezone,
  top,
  height,
  onEdit,
}: {
  readonly sessions: DailyPlanSnapshot['sessions'];
  readonly names: DailyAgendaProps['names'];
  readonly timezone: string;
  readonly top: (instant: string) => number;
  readonly height: (start: string, end: string) => number;
  readonly onEdit: DailyAgendaProps['onEdit'];
}): JSX.Element {
  return (
    <>
      {sessions.map((session) => (
        <Button
          key={session.id}
          variant="secondary"
          className="absolute right-0 left-0 h-auto justify-start overflow-hidden text-left"
          style={{ top: top(session.startsAt), height: height(session.startsAt, session.endsAt) }}
          aria-label={`Edit ${session.allocations.map((part) => names.get(part.taskId) ?? 'Task').join(' and ')} at ${clock(session.startsAt, timezone)}`}
          onClick={() => {
            onEdit(session);
          }}
        >
          <span className="truncate">
            {session.allocations.map((part) => names.get(part.taskId) ?? 'Task').join(' · ')}
          </span>
        </Button>
      ))}
    </>
  );
}

function ShortBlockDetails({
  sessions,
  names,
  timezone,
  height,
  onEdit,
}: {
  readonly sessions: DailyPlanSnapshot['sessions'];
  readonly names: DailyAgendaProps['names'];
  readonly timezone: string;
  readonly height: (start: string, end: string) => number;
  readonly onEdit: DailyAgendaProps['onEdit'];
}): JSX.Element {
  return (
    <>
      {sessions
        .filter((session) => height(session.startsAt, session.endsAt) < 24)
        .map((session) => (
          <Button
            key={`detail-${session.id}`}
            variant="ghost"
            className="mt-2 w-full justify-start"
            onClick={() => {
              onEdit(session);
            }}
          >
            {clock(session.startsAt, timezone)} ·{' '}
            {session.allocations.map((part) => names.get(part.taskId) ?? 'Task').join(' · ')}
          </Button>
        ))}
    </>
  );
}

/** Show timed events and planned sessions with direct scheduling controls. */
export function DailyAgenda({
  date,
  timezone,
  draft,
  events,
  names,
  onEdit,
  onDropTask,
}: DailyAgendaProps): JSX.Element {
  const pixelsPerMinute = 0.8;
  const minuteOf = (instant: string): number => {
    const value = new Date(instant);
    const day = localDateString(value, timezone);
    return localMinuteOfDay(value, timezone) + (day > date ? 1440 : day < date ? -1440 : 0);
  };
  const intervals = [...events, ...draft.sessions];
  const first = Math.min(
    8 * 60,
    ...intervals.map((item) => Math.floor(minuteOf(item.startsAt) / 60) * 60),
  );
  const last = Math.max(
    19 * 60,
    Math.ceil(minuteOf(draft.finishAt) / 60) * 60,
    ...intervals.map((item) => Math.ceil(minuteOf(item.endsAt) / 60) * 60),
  );
  const top = (instant: string): number => (minuteOf(instant) - first) * pixelsPerMinute;
  const height = (start: string, end: string): number =>
    (minuteOf(end) - minuteOf(start)) * pixelsPerMinute;
  const drop = useDailyPlanDropTarget({
    startMinutesAt: (clientY, bounds) =>
      Math.round((first + (clientY - bounds.top) / pixelsPerMinute) / 15) * 15,
    onDropTask,
  });
  return (
    <Card>
      <CardContent className="pt-5">
        <div
          ref={drop.ref}
          aria-label="Day agenda"
          className={`relative ml-12 ${drop.isOver ? 'ring-primary ring-2' : ''}`}
          data-drop-state={drop.isOver ? 'accept' : 'idle'}
          style={{ height: (last - first) * pixelsPerMinute }}
        >
          <HourLabels first={first} last={last} pixelsPerMinute={pixelsPerMinute} />
          {events.map((event, index) => (
            <div
              key={`${event.startsAt}-${index}`}
              className="bg-surface-container-high text-on-surface text-body-small absolute right-0 left-0 overflow-hidden rounded-lg px-2 py-1"
              style={{ top: top(event.startsAt), height: height(event.startsAt, event.endsAt) }}
            >
              <strong>{event.title}</strong>
              <span className="ml-2">{clock(event.startsAt, timezone)}</span>
            </div>
          ))}
          <SessionBlocks
            sessions={draft.sessions}
            names={names}
            timezone={timezone}
            top={top}
            height={height}
            onEdit={onEdit}
          />
        </div>
        <ShortBlockDetails
          sessions={draft.sessions}
          names={names}
          timezone={timezone}
          height={height}
          onEdit={onEdit}
        />
      </CardContent>
    </Card>
  );
}
