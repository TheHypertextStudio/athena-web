'use client';

import { instantAt } from '@docket/planning/zoned-time';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  Card,
  CardContent,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
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
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <CollapsibleTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Workday settings"
          className="group max-w-full justify-start gap-2"
        >
          <span className="text-on-surface-variant">Work hours</span>
          <span>
            {clock(plan.startAt, plan.timezone)} – {clock(plan.draft.finishAt, plan.timezone)}
          </span>
          <ChevronDown aria-hidden="true" className="group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        <p className="text-body-small text-on-surface-variant">Timezone: {plan.timezone}</p>
        {plan.proposalContext?.workScheduleMissing ? (
          <p className="text-body-small text-on-surface-variant">
            No saved work schedule. Set the hours for this day.
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <WorkdayTimeInput
            label="Start"
            value={clockValue(plan.startAt, plan.timezone)}
            onChange={(value) => {
              changeTime(value, 'start');
            }}
          />
          <WorkdayTimeInput
            label="Finish"
            value={clockValue(plan.draft.finishAt, plan.timezone)}
            onChange={(value) => {
              changeTime(value, 'finish');
            }}
          />
          <WorkdayBuffer plan={plan} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Rebuild flexible work without replacing the current agenda until it is accepted. */
export function OrganizeDay({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={plan.proposalPending}
      onClick={() => {
        void plan.rebuild();
      }}
    >
      Organize day
    </Button>
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
        <Button size="sm" variant="ghost" onClick={plan.undoSchedule}>
          Undo schedule
        </Button>
      ) : null}
      {plan.preview ? (
        <Card>
          <CardContent className="space-y-2 pt-3">
            <p className="text-label-large">{plan.preview.title}</p>
            <ul className="text-body-small text-on-surface-variant space-y-1">
              {plan.preview.proposal?.changes.slice(0, 5).map((change) => (
                <li key={`${change.type}-${change.sessionId}`}>
                  {change.taskIds.map(plan.titleFor).join(', ')}
                  {change.startsAt
                    ? ` → ${clock(change.startsAt, plan.timezone)}`
                    : ' → Unscheduled'}
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
