'use client';

import type { DailyPlanSession, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { instantAt } from '@docket/planning/zoned-time';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Select,
} from '@docket/ui/primitives';
import { useState, type JSX } from 'react';
import { clockValue, type EventBlock } from './daily-planning-agenda';
import { unplacedMinutes } from './daily-planning-model';
import { newSessionSlot } from './daily-planning-session-defaults';

interface SessionEditorProps {
  readonly actual?: readonly { taskId: string | null; recordedMinutes: number }[];
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

function initialValues(props: SessionEditorProps) {
  const existing = props.draft.sessions.find((session) => session.id === props.editing.sessionId);
  const minutes = Math.max(
    1,
    Math.min(
      60,
      unplacedMinutes(
        props.draft,
        props.editing.taskId,
        props.actual ?? [],
        Date.parse(props.earliestAt),
      ),
    ),
  );
  const firstSlot = newSessionSlot(props.earliestAt, props.draft.finishAt, minutes, [
    ...props.events,
    ...props.draft.sessions,
  ]);
  return {
    existing,
    noTimeLeft: !existing && !firstSlot,
    start: clockValue(
      existing?.startsAt ?? firstSlot?.startsAt ?? props.earliestAt,
      props.timezone,
    ),
    allocations: existing?.allocations ?? [
      { taskId: props.editing.taskId, plannedMinutes: firstSlot?.minutes ?? minutes },
    ],
  };
}

function AllocationFields({
  allocations,
  names,
  onChange,
}: {
  readonly allocations: DailyPlanSession['allocations'];
  readonly names: ReadonlyMap<string, string>;
  readonly onChange: (value: DailyPlanSession['allocations']) => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      {allocations.map((part, index) => (
        <div key={part.taskId} className="flex items-center gap-2">
          <span className="text-body-medium min-w-0 flex-1">
            {names.get(part.taskId) ?? 'Task'}
          </span>
          <Input
            className="w-16"
            type="number"
            min={1}
            inputMode="numeric"
            aria-label={`Duration for ${names.get(part.taskId) ?? 'Task'}`}
            value={part.plannedMinutes}
            onChange={(event) => {
              onChange(
                allocations.map((value, i) =>
                  i === index ? { ...value, plannedMinutes: Number(event.target.value) } : value,
                ),
              );
            }}
          />
          <span className="text-body-small">min</span>
          {allocations.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${names.get(part.taskId) ?? 'Task'} from block`}
              onClick={() => {
                onChange(allocations.filter((_, i) => i !== index));
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function useSessionForm(props: SessionEditorProps) {
  const initial = initialValues(props);
  const [start, setStart] = useState(initial.start);
  const [allocations, setAllocations] = useState(initial.allocations);
  const [pinned, setPinned] = useState(initial.existing?.pinned ?? false);
  const duration = allocations.reduce((sum, part) => sum + part.plannedMinutes, 0);
  const save = (): void => {
    if (initial.noTimeLeft) return;
    const [hour, minute] = start.split(':').map(Number);
    const startsAt = instantAt(
      props.date,
      (hour ?? 0) * 60 + (minute ?? 0),
      props.timezone,
    ).toISOString();
    props.onSave({
      id: initial.existing?.id ?? crypto.randomUUID(),
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + duration * 60_000).toISOString(),
      allocations,
      pinned,
      placementSource: 'manual',
    });
  };
  const otherTasks = props.draft.tasks.filter(
    (task) =>
      !allocations.some((part) => part.taskId === task.taskId) &&
      unplacedMinutes(props.draft, task.taskId, props.actual ?? [], Date.parse(props.earliestAt)) >
        0,
  );
  return {
    initial,
    start,
    setStart,
    allocations,
    setAllocations,
    pinned,
    setPinned,
    duration,
    save,
    otherTasks,
  };
}

function SessionActions({
  props,
  existingId,
  allocations,
  noTimeLeft,
  save,
}: {
  readonly props: SessionEditorProps;
  readonly existingId: string | undefined;
  readonly allocations: DailyPlanSession['allocations'];
  readonly noTimeLeft: boolean;
  readonly save: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {existingId ? (
        <Button
          variant="ghost"
          onClick={() => {
            props.onRemove(existingId);
          }}
        >
          Unschedule
        </Button>
      ) : null}
      <Button variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button
        onClick={save}
        disabled={
          noTimeLeft ||
          !allocations.every(
            (part) => Number.isInteger(part.plannedMinutes) && part.plannedMinutes > 0,
          )
        }
      >
        Save block
      </Button>
    </div>
  );
}

function AddAllocation({
  props,
  tasks,
  onAdd,
}: {
  readonly props: SessionEditorProps;
  readonly tasks: DailyPlanSnapshot['tasks'];
  readonly onAdd: (taskId: string) => void;
}): JSX.Element | null {
  if (!tasks.length) return null;
  return (
    <label className="text-body-small block">
      Add to block
      <Select
        value=""
        onChange={(event) => {
          if (event.target.value) onAdd(event.target.value);
        }}
      >
        <option value="">Choose task</option>
        {tasks.map((task) => (
          <option key={task.taskId} value={task.taskId}>
            {props.names.get(task.taskId) ?? 'Task'}
          </option>
        ))}
      </Select>
    </label>
  );
}

function SessionDuration({
  minutes,
  noTimeLeft,
}: {
  readonly minutes: number;
  readonly noTimeLeft: boolean;
}): JSX.Element {
  return (
    <>
      <p className="text-body-small text-on-surface-variant">{minutes} minutes in this block</p>
      {noTimeLeft ? (
        <p role="status" className="text-body-small text-on-surface-variant">
          No time remains before your finish time. Change your finish time or unschedule a block.
        </p>
      ) : null}
    </>
  );
}

/** Edit block placement and every allocation without requiring a drag gesture. */
export function SessionEditor(props: SessionEditorProps): JSX.Element {
  const {
    initial,
    start,
    setStart,
    allocations,
    setAllocations,
    pinned,
    setPinned,
    duration,
    save,
    otherTasks,
  } = useSessionForm(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'standard' }}>
        <DialogTitle>{initial.existing ? 'Edit block' : 'Schedule task'}</DialogTitle>
        <div className="space-y-4">
          <label className="text-body-medium flex items-center justify-between gap-2">
            Start
            <Input
              className="w-32"
              type="time"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            />
          </label>
          <AllocationFields
            allocations={allocations}
            names={props.names}
            onChange={setAllocations}
          />
          <SessionDuration minutes={duration} noTimeLeft={initial.noTimeLeft} />
          <AddAllocation
            props={props}
            tasks={otherTasks}
            onAdd={(taskId) => {
              setAllocations([
                ...allocations,
                {
                  taskId,
                  plannedMinutes: unplacedMinutes(
                    props.draft,
                    taskId,
                    props.actual ?? [],
                    Date.parse(props.earliestAt),
                  ),
                },
              ]);
            }}
          />
          <label className="text-body-small flex items-center gap-2">
            <Checkbox
              checked={pinned}
              onChange={(event) => {
                setPinned(event.target.checked);
              }}
            />
            Keep this block in place
          </label>
          <SessionActions
            props={props}
            existingId={initial.existing?.id}
            allocations={allocations}
            noTimeLeft={initial.noTimeLeft}
            save={save}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
