'use client';

import { instantAt } from '@docket/planning/zoned-time';
import { Button, Card, CardContent, Input } from '@docket/ui/primitives';
import type { JSX } from 'react';
import type { ReadyPlanningController } from './daily-planning-controller';
import { clock, clockValue } from './daily-planning-agenda';

/** Edit the scheduling bounds and buffer used by the proposal service. */
export function WorkdayControls({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
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
      {plan.proposalContext?.workScheduleMissing ? (
        <p className="text-body-small text-on-surface-variant">
          No saved work schedule. Set the hours for this day.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-body-small">
          Start
          <Input
            controlSize="sm"
            className="w-28"
            type="time"
            value={clockValue(plan.startAt, plan.timezone)}
            onChange={(event) => {
              changeTime(event.target.value, 'start');
            }}
          />
        </label>
        <label className="text-body-small">
          Finish
          <Input
            controlSize="sm"
            className="w-28"
            type="time"
            value={clockValue(plan.draft.finishAt, plan.timezone)}
            onChange={(event) => {
              changeTime(event.target.value, 'finish');
            }}
          />
        </label>
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
      </div>
    </div>
  );
}

/** Keep a proposed revision separate until the person accepts the shown calendar. */
export function ScheduleControls({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
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
        {plan.canUndoSchedule ? (
          <Button size="sm" variant="ghost" onClick={plan.undoSchedule}>
            Undo schedule
          </Button>
        ) : null}
        <span className="text-body-small text-on-surface-variant">
          Drag work to a time or an existing block.
        </span>
      </div>
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
