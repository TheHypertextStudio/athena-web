'use client';

/** The single editable agenda used while choosing and reviewing a day. */
import type { DailyPlanSession } from '@docket/planning/daily-plan-flow';
import { instantAt } from '@docket/planning/zoned-time';
import { Button, Card, CardContent } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { DailyAgenda } from './daily-planning-agenda';
import { SessionEditor } from './daily-planning-session-editor';
import { DailyPlanningAssessment } from './daily-planning-assessment';
import { ScheduleControls, WorkdayControls } from './daily-planning-schedule-controls';
import type { ReadyPlanningController } from './daily-planning-controller';
import {
  addTaskToSession,
  detachNextAllocation,
  unplacedMinutes,
  resizeSession,
} from './daily-planning-model';
import { UnplacedWork } from './daily-planning-unplaced';
import { OutsideWorkHours } from './daily-planning-outside-hours';
import { WorkColumn } from './daily-planning-work';

function agendaActions(plan: ReadyPlanningController) {
  const editable = (): boolean => {
    if (!plan.preview) return true;
    plan.setError('Apply or keep the current schedule before placing work.');
    return false;
  };
  return {
    onAddToBlock: (taskId: string, sessionId: string): void => {
      if (!editable()) return;
      if (
        plan.draft.sessions
          .find((value) => value.id === sessionId)
          ?.allocations.some((part) => part.taskId === taskId)
      )
        return;
      try {
        plan.editDraft(
          addTaskToSession(
            detachNextAllocation(plan.draft, taskId, plan.startAt, plan.dayQ.data?.actual ?? []),
            taskId,
            sessionId,
            plan.fixed,
            { startAt: plan.startAt, actual: plan.dayQ.data?.actual ?? [] },
          ),
        );
      } catch {
        plan.setError(
          'This task does not fit in that block. Move the following block or shorten Planned time.',
        );
      }
    },
    onChangeSession: (session: DailyPlanSession, startsAt: string, endsAt: string): void => {
      if (!editable()) return;
      try {
        const next = resizeSession(plan.draft, session, startsAt, endsAt);
        plan.saveSession(next.session, next.draft);
      } catch {
        plan.setError('This block is too short for its tasks.');
      }
    },
    onDropTask: (taskId: string, minute: number): void => {
      if (!editable()) return;
      const source = detachNextAllocation(
        plan.draft,
        taskId,
        plan.startAt,
        plan.dayQ.data?.actual ?? [],
      );
      const minutes = Math.min(60, unplacedMinutes(source, taskId, plan.dayQ.data?.actual ?? []));
      if (!minutes) return;
      const startsAt = instantAt(plan.date, minute, plan.timezone).toISOString();
      plan.saveSession(
        {
          id: crypto.randomUUID(),
          startsAt,
          endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
          allocations: [{ taskId, plannedMinutes: minutes }],
          pinned: false,
        },
        source,
      );
    },
  };
}

function AgendaColumn({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const displayed = plan.preview?.draft ?? plan.draft;
  return (
    <section className="min-w-0 space-y-4">
      <h2 className="text-title-large">Agenda</h2>
      <WorkdayControls plan={plan} />
      <ScheduleControls plan={plan} />
      {plan.editing ? (
        <SessionEditor
          key={`${plan.editing.taskId}:${plan.editing.sessionId ?? 'new'}`}
          actual={plan.dayQ.data?.actual ?? []}
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
          onSave={(session) => {
            if (plan.preview) {
              plan.setError('Apply or keep the current schedule before editing a block.');
              return;
            }
            plan.saveSession(session);
          }}
          onRemove={(id) => {
            if (plan.preview) {
              plan.setError('Apply or keep the current schedule before editing a block.');
              return;
            }
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
        startAt={plan.startAt}
        draft={displayed}
        events={plan.fixed}
        names={plan.names}
        onEdit={(session) => {
          if (plan.preview) {
            plan.setError('Apply or keep the current schedule before editing a block.');
            return;
          }
          plan.setEditing({ taskId: session.allocations[0]?.taskId ?? '', sessionId: session.id });
        }}
        {...agendaActions(plan)}
      />
      <OutsideWorkHours plan={plan} />
      <UnplacedWork plan={plan} />
    </section>
  );
}

function confirmationDisabled(plan: ReadyPlanningController): boolean {
  return plan.confirming || plan.deferPending || plan.confirm.isPending || Boolean(plan.preview);
}

async function confirmPlan(plan: ReadyPlanningController): Promise<void> {
  if (plan.isMovingTask()) return;
  plan.setConfirming(true);
  try {
    await plan.persist(plan.draft, 'review', plan.revision);
  } catch {
    plan.setConfirming(false);
    return;
  }
  if (!plan.isCurrentDate()) {
    plan.setConfirming(false);
    return;
  }
  try {
    plan.setWasAdjustment(Boolean(plan.dayQ.data?.accepted));
    plan.setPreviousAccepted(plan.dayQ.data?.accepted?.current.snapshot ?? null);
    const accepted = await plan.confirm.mutateAsync({
      expectedRevision: plan.serverRevision.current,
    });
    if (!plan.isCurrentDate()) return;
    plan.serverRevision.current = accepted.revision;
    plan.setStage('confirmed');
  } catch {
    if (plan.isCurrentDate()) plan.setError('Your edits are still here. Confirm failed.');
  } finally {
    plan.setConfirming(false);
  }
}

function PlanFooter({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const hasYesterday =
    (plan.dayQ.data?.carryover.length ?? 0) +
      (plan.previousQ.data?.tasks.length ?? 0) +
      (plan.previousQ.data?.actual.length ?? 0) >
    0;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
        {plan.stage === 'review' ? (
          <Button
            variant="ghost"
            disabled={plan.deferPending}
            onClick={() => {
              void plan.go('plan');
            }}
          >
            Edit plan
          </Button>
        ) : hasYesterday ? (
          <Button
            variant="ghost"
            disabled={plan.deferPending}
            onClick={() => {
              void plan.go('yesterday');
            }}
          >
            {plan.reviewLabel}
          </Button>
        ) : (
          <span />
        )}
        {plan.stage === 'plan' ? (
          <Button
            disabled={plan.deferPending}
            onClick={() => {
              void plan.go('review');
            }}
          >
            Review plan
          </Button>
        ) : (
          <Button
            disabled={confirmationDisabled(plan)}
            onClick={() => {
              void confirmPlan(plan);
            }}
          >
            Confirm plan
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function assessmentToken(plan: ReadyPlanningController): string {
  let hash = 2166136261;
  for (const character of [...plan.names].map(([id, title]) => `${id}:${title}`).join('|'))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `titles:${hash >>> 0}`;
}

/** Keep work and agenda in the same positions through editing and review. */
export function PlanStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const displayed = plan.preview?.draft ?? plan.draft;
  const unplaced = displayed.tasks.filter(
    (entry) => unplacedMinutes(displayed, entry.taskId, plan.dayQ.data?.actual ?? []) > 0,
  ).length;
  return (
    <fieldset
      disabled={plan.confirming}
      aria-busy={plan.confirming}
      className={`min-w-0 space-y-4 ${plan.confirming ? 'pointer-events-none' : ''}`}
    >
      {plan.stage === 'review' ? (
        <DailyPlanningAssessment
          proposalToken={assessmentToken(plan)}
          draft={plan.draft}
          onTaskCreated={(task) => {
            plan.addTask(task.id, task.organizationId, task.title);
          }}
        />
      ) : null}
      {plan.stage === 'review' ? (
        <p className="text-on-surface-variant text-body-medium">
          {unplaced > 0
            ? `${unplaced} ${unplaced === 1 ? 'task still needs' : 'tasks still need'} a block.`
            : 'All selected work has a block.'}
        </p>
      ) : null}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <div className={plan.stage === 'review' ? 'order-2 min-w-0 xl:order-1' : 'min-w-0'}>
          <WorkColumn plan={plan} />
        </div>
        <div
          className={
            plan.stage === 'review' ? 'order-1 min-w-0 space-y-4 xl:order-2' : 'min-w-0 space-y-4'
          }
        >
          <AgendaColumn plan={plan} />
        </div>
      </div>
      <PlanFooter plan={plan} />
    </fieldset>
  );
}
