'use client';

/** Final screen after a person accepts or adjusts the day. */
import { Button, Card, CardContent } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { useState, type JSX } from 'react';

import { clock } from './daily-planning-agenda';
import type { ReadyPlanningController } from './daily-planning-controller';

function nextFocus(plan: ReadyPlanningController) {
  const now = Date.now();
  const session = plan.draft.sessions.find((item) => Date.parse(item.endsAt) > now);
  const event = plan.fixed.find((item) => Date.parse(item.endsAt) > now);
  const workingTaskId = plan.timer.phase === 'running' ? plan.timer.record?.taskId : null;
  const taskId = workingTaskId ?? session?.allocations[0]?.taskId ?? plan.draft.tasks[0]?.taskId;
  return {
    taskId,
    event,
    eventFirst: !workingTaskId && event && (!session || event.startsAt < session.startsAt),
    continueTask: Boolean(taskId && workingTaskId === taskId),
  };
}

type NextFocus = ReturnType<typeof nextFocus>;

function NextDescription({
  plan,
  next,
}: {
  readonly plan: ReadyPlanningController;
  readonly next: NextFocus;
}): JSX.Element {
  if (next.eventFirst && next.event)
    return (
      <p>
        Next: {next.event.title} at {clock(next.event.startsAt, plan.timezone)}
      </p>
    );
  if (next.taskId)
    return (
      <p>
        {next.continueTask ? 'In progress: ' : 'Next: '}
        {plan.titleFor(next.taskId)}
      </p>
    );
  return <p>Open Today when you are ready.</p>;
}

function StartTaskAction({
  plan,
  next,
}: {
  readonly plan: ReadyPlanningController;
  readonly next: NextFocus;
}): JSX.Element | null {
  const [starting, setStarting] = useState(false);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: plan.timezone });
  if (next.eventFirst || !next.taskId || plan.wasAdjustment || plan.date !== today) return null;
  const taskId = next.taskId;
  const label = `${next.continueTask ? 'Continue' : 'Start'} ${plan.titleFor(taskId)}`;
  return (
    <Button
      disabled={starting}
      onClick={() => {
        void (async () => {
          if (next.continueTask) {
            window.location.assign('/focus');
            return;
          }
          setStarting(true);
          try {
            await plan.timerControls.start({ taskId, label: plan.titleFor(taskId) });
            window.location.assign('/focus');
          } catch {
            plan.setError('Could not start tracking. Your plan is still saved.');
            setStarting(false);
          }
        })();
      }}
    >
      {label}
    </Button>
  );
}

/** Offer an explicit start while leaving confirmation itself timer-free. */
export function ConfirmedStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const next = nextFocus(plan);
  return (
    <Card className="bg-primary-container mx-auto w-full max-w-xl">
      <CardContent className="space-y-5 py-10 text-center">
        <span className="text-display-medium" aria-hidden="true">
          ✳
        </span>
        <h2 className="text-headline-medium">
          {plan.wasAdjustment ? 'Plan updated' : 'Your plan is set'}
        </h2>
        <NextDescription plan={plan} next={next} />
        <StartTaskAction plan={plan} next={next} />
        {plan.wasAdjustment && plan.previousAccepted ? (
          <Button
            variant="ghost"
            onClick={() => {
              void plan.undoAdjustment();
            }}
          >
            Undo update
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link href="/today">Go to Today</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
