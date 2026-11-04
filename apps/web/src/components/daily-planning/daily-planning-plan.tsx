'use client';

/** The single editable agenda used while choosing and reviewing a day. */
import type { DailyPlanSession } from '@docket/planning/daily-plan-flow';
import { instantAt } from '@docket/planning/zoned-time';
import { Button, Card, CardContent, Checkbox, IconButton } from '@docket/ui/primitives';
import { Calendar } from '@docket/ui/icons';
import { useState, type JSX } from 'react';
import { visiblePlanningPanels, type PlanningPanels } from './daily-planning-panels';
import { useMediaQuery } from '@docket/ui/hooks';
import { ActivityPanels, InlineBanner } from '@docket/ui/components';

import { DailyAgenda } from './daily-planning-agenda';
import { SessionEditor } from './daily-planning-session-editor';
import { DailyPlanningAssessment } from './daily-planning-assessment';
import { OrganizeDay, ScheduleControls, WorkdayControls } from './daily-planning-schedule-controls';
import type { ReadyPlanningController } from './daily-planning-controller';
import {
  addTaskToSession,
  detachNextAllocation,
  unplacedMinutes,
  resizeSession,
} from './daily-planning-model';
import { UnplacedWork } from './daily-planning-unplaced';
import { OutsideWorkHours } from './daily-planning-outside-hours';
import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import { useAppRouter } from '@/lib/interactions/navigation';
import { PlanningTimeSelection } from './daily-planning-time-selection';
import type { ScheduleRegionSelection } from '@/components/scheduling';
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

function toggleAllDayBlocking(plan: ReadyPlanningController, id: string, blocks: boolean): void {
  if (plan.preview) {
    plan.setError('Apply or keep the current schedule before changing availability.');
    return;
  }
  const ignored = new Set(plan.draft.settings?.ignoredAllDayEventIds ?? []);
  if (blocks) ignored.delete(id);
  else ignored.add(id);
  plan.editDraft({
    ...plan.draft,
    settings: { ...plan.draft.settings, ignoredAllDayEventIds: [...ignored] },
  });
}

function AgendaHeading({
  plan,
  onSchedule,
}: {
  readonly plan: ReadyPlanningController;
  readonly onSchedule: () => void;
}): JSX.Element {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title-large">Agenda</h2>
        <div className="flex items-center gap-1">
          <IconButton label="Schedule work" disabled={Boolean(plan.preview)} onClick={onSchedule}>
            <Calendar />
          </IconButton>
          <OrganizeDay plan={plan} />
        </div>
      </div>
      <WorkdayControls plan={plan} />
      <ScheduleControls plan={plan} />
    </>
  );
}

function AgendaSessionEditor({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element | null {
  if (!plan.editing) return null;
  return (
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
        // Saving an already-open editor is explicit manual intent. editDraft invalidates any
        // proposal that arrived meanwhile; requiring a decision behind this dialog traps the edit.
        plan.saveSession(session);
      }}
      onRemove={(id) => {
        plan.editDraft({
          ...plan.draft,
          sessions: plan.draft.sessions.filter((session) => session.id !== id),
        });
        plan.setEditing(null);
      }}
    />
  );
}

function AgendaColumn({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const displayed = plan.preview?.draft ?? plan.draft;
  const [calendarItemId, setCalendarItemId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ region: ScheduleRegionSelection | null } | null>(
    null,
  );
  const router = useAppRouter();
  return (
    <section className="min-w-0 space-y-3" aria-label="Planned agenda">
      <AgendaHeading
        plan={plan}
        onSchedule={() => {
          setSelection({ region: null });
        }}
      />
      <AgendaSessionEditor plan={plan} />
      {selection ? (
        <PlanningTimeSelection
          plan={plan}
          region={selection.region}
          onClose={() => {
            setSelection(null);
          }}
        />
      ) : null}
      <CalendarItemDrawer
        displayTimezone={plan.timezone}
        itemId={calendarItemId}
        onClose={() => {
          setCalendarItemId(null);
          void plan.dayQ.refetch();
        }}
        onOpenTask={(orgId, taskId) => {
          router.push(`/orgs/${orgId}/tasks/${taskId}`);
        }}
      />
      <DailyAgenda
        date={plan.date}
        timezone={plan.timezone}
        startAt={plan.startAt}
        draft={displayed}
        events={plan.fixed}
        names={plan.names}
        onOpenEvent={setCalendarItemId}
        onToggleAllDayBlocking={(id, blocks) => {
          toggleAllDayBlocking(plan, id, blocks);
        }}
        onSelectRegion={(region) => {
          if (plan.preview) {
            plan.setError('Apply or keep the current schedule before placing work.');
            return;
          }
          setSelection({ region });
        }}
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

function ConfirmPlanButton({
  plan,
  allowEmpty = false,
}: {
  readonly plan: ReadyPlanningController;
  readonly allowEmpty?: boolean;
}): JSX.Element {
  return (
    <Button
      disabled={confirmationDisabled(plan) || (plan.draft.tasks.length === 0 && !allowEmpty)}
      onClick={() => {
        void confirmPlan(plan);
      }}
    >
      Confirm plan
    </Button>
  );
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
        {hasYesterday ? (
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
        <Button
          disabled={plan.deferPending}
          onClick={() => {
            void plan.go('review');
          }}
        >
          Review plan
        </Button>
      </CardContent>
    </Card>
  );
}

function EditPlanButton({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <Button
      variant="secondary"
      disabled={plan.deferPending}
      onClick={() => {
        void plan.go('plan');
      }}
    >
      Edit plan
    </Button>
  );
}

function EmptyDayConfirmation({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <div className="w-full space-y-2">
      <InlineBanner tone="warning" title="No work is selected for this day." />
      <label className="text-body-small inline-flex min-h-10 items-center gap-2">
        <Checkbox
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledged(event.target.checked);
          }}
        />
        Keep this day without planned work
      </label>
      <div className="flex items-center justify-between gap-3">
        <EditPlanButton plan={plan} />
        <ConfirmPlanButton plan={plan} allowEmpty={acknowledged} />
      </div>
    </div>
  );
}

function ReviewFooter({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
        {plan.draft.tasks.length === 0 ? (
          <EmptyDayConfirmation key={plan.date} plan={plan} />
        ) : (
          <>
            <EditPlanButton plan={plan} />
            <ConfirmPlanButton plan={plan} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Keep the current stage's main action independent of panel visibility and scrolling. */
export function PlanningActions({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <fieldset
      disabled={plan.confirming}
      aria-busy={plan.confirming}
      className="min-w-0 border-0 p-0"
    >
      {plan.stage === 'review' ? <ReviewFooter plan={plan} /> : <PlanFooter plan={plan} />}
    </fieldset>
  );
}

function assessmentToken(plan: ReadyPlanningController): string {
  let hash = 2166136261;
  for (const character of [...plan.names].map(([id, title]) => `${id}:${title}`).join('|'))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `titles:${hash >>> 0}`;
}

/** Give the final agenda precedence while keeping its chosen work directly editable. */
export function PlanStage({
  plan,
  panels = { work: true, agenda: true },
}: {
  readonly plan: ReadyPlanningController;
  readonly panels?: PlanningPanels;
}): JSX.Element {
  const reviewing = plan.stage === 'review';
  const wide = useMediaQuery('(min-width: 64rem)');
  const visible = visiblePlanningPanels(panels, reviewing, wide);
  return (
    <fieldset
      disabled={plan.confirming}
      aria-busy={plan.confirming}
      className={`min-w-0 space-y-4 ${plan.confirming ? 'pointer-events-none' : ''}`}
    >
      {reviewing ? (
        <div className="px-3 sm:px-0">
          <DailyPlanningAssessment
            proposalToken={assessmentToken(plan)}
            draft={plan.draft}
            onTaskCreated={(task) => {
              plan.addTask(task.id, task.organizationId, task.title);
            }}
          />
        </div>
      ) : null}
      <ActivityPanels
        showPrimary={visible.work}
        showSecondary={visible.agenda}
        primary={<WorkColumn plan={plan} />}
        secondary={<AgendaColumn plan={plan} />}
      />
    </fieldset>
  );
}
