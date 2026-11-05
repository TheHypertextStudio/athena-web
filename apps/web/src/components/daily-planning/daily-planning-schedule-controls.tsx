'use client';

import { instantAt } from '@docket/planning/zoned-time';
import { AlarmClock, Sparkles } from '@docket/ui/icons';
import {
  Button,
  IconButton,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
} from '@docket/ui/primitives';
import { useState, type JSX } from 'react';
import type { ReadyPlanningController } from './daily-planning-controller';
import { clock, clockValue } from './daily-planning-agenda';

function WorkdayTimeInput({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="text-body-small">
      {label}
      <Input
        controlSize="sm"
        className="w-28"
        type="time"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function WorkdayBuffer({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <label className="text-body-small">
      Buffer %
      <Input
        controlSize="sm"
        className="w-16"
        type="number"
        min={0}
        max={50}
        value={plan.draft.settings?.bufferPercent ?? 15}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (value >= 0 && value <= 50)
            plan.editDraft({
              ...plan.draft,
              settings: { ...plan.draft.settings, bufferPercent: value },
            });
        }}
      />
    </label>
  );
}

/** Edit the scheduling bounds and buffer used by the proposal service. */
export function WorkdayControls({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const [open, setOpen] = useState(false);
  const configuredStart = plan.draft.settings?.startAt ?? plan.planningStartAt;
  const ended = Date.parse(plan.startAt) >= Date.parse(plan.draft.finishAt);
  const invalid = Date.parse(configuredStart) >= Date.parse(plan.draft.finishAt);
  const changeTime = (value: string, field: 'start' | 'finish'): void => {
    if (!value) return;
    const [hours, minutes] = value.split(':').map(Number);
    const instant = instantAt(
      plan.date,
      (hours ?? 0) * 60 + (minutes ?? 0),
      plan.timezone,
    ).toISOString();
    plan.editDraft(
      field === 'finish'
        ? { ...plan.draft, finishAt: instant }
        : { ...plan.draft, settings: { ...plan.draft.settings, startAt: instant } },
    );
  };
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Workday hours"
            className="max-w-full justify-start gap-2 px-2"
          >
            <AlarmClock aria-hidden="true" className="text-on-surface-variant size-4" />
            <span className="text-label-medium">
              {invalid
                ? 'Set hours'
                : `${clock(configuredStart, plan.timezone)} – ${clock(plan.draft.finishAt, plan.timezone)}`}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" presentation="panel" width="lg" aria-label="Workday">
          <PopoverHeader inset="compact">
            <h3 className="text-title-small text-on-surface">Workday</h3>
          </PopoverHeader>
          <PopoverBody inset="compact" className="space-y-3">
            <p className="text-body-small text-on-surface-variant">
              Times shown in {plan.timezone}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <WorkdayTimeInput
                label="Starts"
                value={clockValue(configuredStart, plan.timezone)}
                onChange={(value) => {
                  changeTime(value, 'start');
                }}
              />
              <WorkdayTimeInput
                label="Ends"
                value={clockValue(plan.draft.finishAt, plan.timezone)}
                onChange={(value) => {
                  changeTime(value, 'finish');
                }}
              />
              <WorkdayBuffer plan={plan} />
            </div>
          </PopoverBody>
        </PopoverContent>
      </Popover>
      {invalid || ended ? (
        <p role="status" className="text-body-small text-on-surface-variant">
          {invalid
            ? 'Start must be before finish. Adjust the workday to schedule this day.'
            : 'The workday has ended. Change its finish time to schedule more work.'}
        </p>
      ) : null}
    </div>
  );
}

/** Rebuild flexible work without replacing the current agenda until it is accepted. */
export function OrganizeDay({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <IconButton
      label="Organize day"
      disabled={plan.proposalPending}
      onClick={() => {
        void plan.rebuild();
      }}
    >
      <Sparkles />
    </IconButton>
  );
}

/** Keep a proposed revision separate until the person accepts the shown calendar. */
export function ScheduleControls({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element | null {
  if (!plan.preview && !plan.canUndoSchedule) return null;
  return (
    <div className="space-y-2">
      {plan.canUndoSchedule && !plan.preview ? (
        <Button size="sm" variant="ghost" className="px-0" onClick={plan.undoSchedule}>
          Undo schedule
        </Button>
      ) : null}
      {plan.preview ? (
        <section aria-label="Proposed schedule" className="space-y-2 py-2">
          <p className="text-label-large">{plan.preview.title}</p>
          <ul className="text-body-small text-on-surface-variant space-y-1">
            {plan.preview.proposal?.changes.slice(0, 5).map((change) => (
              <li key={`${change.type}-${change.sessionId}`}>
                {change.taskIds.map(plan.titleFor).join(', ')}
                {change.startsAt ? ` → ${clock(change.startsAt, plan.timezone)}` : ' → Unscheduled'}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" onClick={plan.applyPreview}>
              Apply schedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                plan.setPreview(null);
              }}
            >
              Keep current
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
