'use client';

import { instantAt } from '@docket/planning/zoned-time';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
} from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useState, type JSX } from 'react';
import type { ScheduleRegionSelection } from '@/components/scheduling';
import type { ReadyPlanningController } from './daily-planning-controller';
import { clockValue } from './daily-planning-agenda';
import { ExistingWorkBrowser } from './daily-planning-add';
import { newSessionSlot } from './daily-planning-session-defaults';
import { unplacedMinutes } from './daily-planning-model';

interface SelectionProps {
  readonly plan: ReadyPlanningController;
  readonly region: ScheduleRegionSelection | null;
  readonly onClose: () => void;
}

function initialTimeSelection(
  plan: ReadyPlanningController,
  region: ScheduleRegionSelection | null,
) {
  const slot = newSessionSlot(plan.startAt, plan.draft.finishAt, 30, [
    ...plan.fixed,
    ...plan.draft.sessions,
  ]);
  const initialStart = region
    ? instantAt(plan.date, region.startMinutes, plan.timezone).toISOString()
    : (slot?.startsAt ?? plan.startAt);
  return {
    start: clockValue(initialStart, plan.timezone),
    minutes: region ? region.endMinutes - region.startMinutes : (slot?.minutes ?? 30),
  };
}

function useTimeSelection({ plan, region, onClose }: SelectionProps) {
  const tasks = plan.draft.tasks.filter(
    (task) => unplacedMinutes(plan.draft, task.taskId, plan.dayQ.data?.actual ?? []) > 0,
  );
  const [chosenTask, setTaskId] = useState<string | null>(null);
  const taskId = chosenTask ?? tasks[0]?.taskId ?? '';
  const initial = initialTimeSelection(plan, region);
  const [start, setStart] = useState(initial.start);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [failed, setFailed] = useState(false);
  const valid = Boolean(
    taskId && start && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440,
  );
  const save = (): void => {
    if (!valid) return;
    const [hour, minute] = start.split(':').map(Number);
    const startsAt = instantAt(
      plan.date,
      (hour ?? 0) * 60 + (minute ?? 0),
      plan.timezone,
    ).toISOString();
    const saved = plan.saveSession({
      id: crypto.randomUUID(),
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
      allocations: [{ taskId, plannedMinutes: minutes }],
      pinned: false,
      placementSource: 'manual',
    });
    if (saved) onClose();
    else setFailed(true);
  };
  return { tasks, taskId, setTaskId, start, setStart, minutes, setMinutes, failed, valid, save };
}

function TimeSelectionFields({
  plan,
  form,
}: {
  readonly plan: ReadyPlanningController;
  readonly form: ReturnType<typeof useTimeSelection>;
}): JSX.Element {
  return (
    <>
      <label className="text-body-small block">
        Task to schedule
        <Select
          value={form.taskId}
          onChange={(event) => {
            form.setTaskId(event.target.value);
          }}
        >
          {form.tasks.map((task) => (
            <option key={task.taskId} value={task.taskId}>
              {plan.titleFor(task.taskId)}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="text-body-small">
          Start time
          <Input
            type="time"
            value={form.start}
            onChange={(event) => {
              form.setStart(event.target.value);
            }}
          />
        </label>
        <label className="text-body-small">
          Duration in minutes
          <Input
            type="number"
            min={1}
            max={1440}
            value={form.minutes}
            onChange={(event) => {
              form.setMinutes(Number(event.target.value));
            }}
          />
        </label>
      </div>
      <p className="text-body-small text-on-surface-variant">{plan.timezone}</p>
    </>
  );
}

/** Choose existing work for an explicit time range using keyboard, touch, or pointer input. */
export function PlanningTimeSelection(props: SelectionProps): JSX.Element {
  const form = useTimeSelection(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'standard' }}>
        <DialogHeader>
          <DialogTitle>Schedule work</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {form.tasks.length ? (
            <TimeSelectionFields plan={props.plan} form={form} />
          ) : (
            <>
              <p>
                Choose existing work to schedule. Fully scheduled tasks can be adjusted by opening
                their blocks.
              </p>
              <ExistingWorkBrowser plan={props.plan} />
            </>
          )}
          {form.failed ? (
            <InlineBanner
              tone="critical"
              title="Choose a time within work hours that does not overlap another block or busy event."
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!form.valid} onClick={form.save}>
            Save block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
