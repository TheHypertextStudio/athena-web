'use client';

/** The single editable agenda used while choosing and reviewing a day. */
import { instantAt } from '@docket/planning/zoned-time';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { DailyAgenda, SessionEditor } from './daily-planning-agenda';
import type { ReadyPlanningController } from './daily-planning-controller';
import { planSummary, remainingMinutes } from './daily-planning-model';
import { WorkColumn } from './daily-planning-work';

function AgendaColumn({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const unscheduled = plan.draft.tasks.filter(
    (entry) => remainingMinutes(plan.draft, entry.taskId) > 0,
  );
  return (
    <section
      className={
        plan.stage === 'review' ? 'order-2 min-w-0 space-y-4 lg:order-1' : 'min-w-0 space-y-4'
      }
    >
      <h2 className="text-title-large">Agenda</h2>
      {plan.editing ? (
        <SessionEditor
          key={`${plan.editing.taskId}:${plan.editing.sessionId ?? 'new'}`}
          date={plan.date}
          timezone={plan.timezone}
          earliestAt={plan.startAt}
          events={plan.fixed}
          draft={plan.draft}
          editing={plan.editing}
          names={plan.names}
          onCancel={() => {
            plan.setEditing(null);
          }}
          onSave={plan.saveSession}
          onRemove={(id) => {
            plan.editDraft({
              ...plan.draft,
              sessions: plan.draft.sessions.filter((session) => session.id !== id),
            });
            plan.setEditing(null);
          }}
        />
      ) : null}
      <DailyAgenda
        date={plan.date}
        timezone={plan.timezone}
        draft={plan.draft}
        events={plan.fixed}
        names={plan.names}
        onEdit={(session) => {
          plan.setEditing({ taskId: session.allocations[0]?.taskId ?? '', sessionId: session.id });
        }}
        onDropTask={(taskId, minute) => {
          const minutes = Math.min(30, remainingMinutes(plan.draft, taskId));
          if (!minutes) return;
          const startsAt = instantAt(plan.date, minute, plan.timezone).toISOString();
          plan.saveSession({
            id: crypto.randomUUID(),
            startsAt,
            endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
            allocations: [{ taskId, plannedMinutes: minutes }],
            pinned: false,
          });
        }}
      />
      {unscheduled.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Unscheduled</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {unscheduled.map((entry) => (
              <p key={entry.taskId} className="flex justify-between gap-2">
                <span>{plan.titleFor(entry.taskId)}</span>
                <span className="text-on-surface-variant shrink-0 tabular-nums">
                  {remainingMinutes(plan.draft, entry.taskId)}m
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

function PlanFooter({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const hasYesterday =
    (plan.dayQ.data?.carryover.length ?? 0) +
      (plan.previousQ.data?.tasks.length ?? 0) +
      (plan.previousQ.data?.actual.length ?? 0) >
    0;
  return (
    <div className="flex flex-wrap justify-between gap-3">
      {plan.stage === 'review' ? (
        <Button
          variant="ghost"
          onClick={() => {
            void plan.go('plan');
          }}
        >
          Edit plan
        </Button>
      ) : hasYesterday ? (
        <Button
          variant="ghost"
          onClick={() => {
            void plan.go('yesterday');
          }}
        >
          Review yesterday
        </Button>
      ) : (
        <span />
      )}
      {plan.stage === 'plan' ? (
        <Button
          onClick={() => {
            void plan.go('review');
          }}
        >
          Review plan
        </Button>
      ) : (
        <Button
          disabled={plan.confirm.isPending}
          onClick={() => {
            void (async () => {
              try {
                await plan.persist(plan.draft, 'review', plan.revision);
              } catch {
                return;
              }
              try {
                plan.setWasAdjustment(Boolean(plan.dayQ.data?.accepted));
                plan.setPreviousAccepted(plan.dayQ.data?.accepted?.current.snapshot ?? null);
                await plan.confirm.mutateAsync(undefined);
                plan.setStage('confirmed');
              } catch {
                plan.setError('Your edits are still here. Confirm failed.');
              }
            })();
          }}
        >
          Confirm plan
        </Button>
      )}
    </div>
  );
}

function PlanChanges({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element | null {
  const previous = plan.dayQ.data?.accepted?.current.snapshot;
  if (!previous || plan.stage !== 'review') return null;
  const before = new Set(previous.tasks.map((task) => task.taskId));
  const after = new Set(plan.draft.tasks.map((task) => task.taskId));
  const added = plan.draft.tasks.filter((task) => !before.has(task.taskId));
  const removed = previous.tasks.filter((task) => !after.has(task.taskId));
  const scheduleChanged = JSON.stringify(previous.sessions) !== JSON.stringify(plan.draft.sessions);
  return (
    <Card>
      <CardContent className="space-y-1 pt-5">
        <h2 className="text-title-medium">Changes to today</h2>
        {added.map((task) => (
          <p key={`add-${task.taskId}`}>Added {plan.titleFor(task.taskId)}</p>
        ))}
        {removed.map((task) => (
          <p key={`remove-${task.taskId}`}>Removed {plan.titleFor(task.taskId)}</p>
        ))}
        {scheduleChanged ? (
          <p>Schedule changed. Review the agenda below before confirming.</p>
        ) : null}
        {!scheduleChanged && added.length === 0 && removed.length === 0 ? (
          <p>No changes yet.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Edit work and timed placement together; review gives the agenda more space. */
export function PlanStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <>
      {plan.stage === 'review' ? (
        <Card className="bg-primary-container">
          <CardContent className="pt-5">
            <p className="text-label-medium">Summary</p>
            <p className="text-title-medium mt-2">
              {planSummary(plan.draft, plan.capacity, plan.names)}
            </p>
          </CardContent>
        </Card>
      ) : null}
      <PlanChanges plan={plan} />
      <div
        className={
          plan.stage === 'review'
            ? 'grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,1fr)]'
            : 'grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]'
        }
      >
        <WorkColumn plan={plan} />
        <AgendaColumn plan={plan} />
      </div>
      <PlanFooter plan={plan} />
    </>
  );
}
