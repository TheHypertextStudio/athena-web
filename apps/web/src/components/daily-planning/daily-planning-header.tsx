'use client';

/** Date, stage and save state above the focused flow. */
import { InlineBanner } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives';
import { addDays } from '@docket/planning/zoned-time';
import { formatDay } from '@/components/date-picker';
import { PageHeader, PageHeading, PageTitle } from '@/components/views/page-layout';
import type { JSX, ReactNode } from 'react';

import type { ReadyPlanningController } from './daily-planning-controller';

const HEADINGS = {
  add: 'Add work',
  review: 'Review plan',
} as const;

function PlanningSteps({
  plan,
  planLabel,
}: {
  readonly plan: ReadyPlanningController;
  readonly planLabel: string;
}): JSX.Element | null {
  if (plan.stage === 'confirmed' || plan.stage === 'add') return null;
  const hasYesterday =
    plan.dayReview ||
    (plan.dayQ.data?.carryover.length ?? 0) +
      (plan.previousQ.data?.tasks.length ?? 0) +
      (plan.previousQ.data?.actual.length ?? 0) >
      0;
  return (
    <nav aria-label="Planning steps" className="flex flex-wrap items-center gap-2">
      {(
        [
          ...(hasYesterday ? ([['yesterday', plan.reviewLabel]] as const) : []),
          ['plan', planLabel],
          ['review', 'Review plan'],
        ] as const
      ).map(([step, label]) => (
        <Button
          disabled={plan.confirming || plan.deferPending}
          key={step}
          size="sm"
          variant={plan.stage === step ? 'default' : 'secondary'}
          className="min-h-10 min-w-10 rounded-lg px-3 sm:min-h-8"
          aria-current={plan.stage === step ? 'step' : undefined}
          onClick={() => {
            void plan.go(step);
          }}
        >
          {label}
        </Button>
      ))}
    </nav>
  );
}

function planningHeading(plan: ReadyPlanningController) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: plan.timezone });
  const planLabel =
    plan.date === today
      ? 'Plan today'
      : plan.date === addDays(today, 1)
        ? 'Plan tomorrow'
        : 'Plan day';
  const heading =
    plan.stage === 'confirmed'
      ? plan.wasAdjustment
        ? 'Plan updated'
        : 'Your plan is set'
      : plan.stage === 'plan'
        ? planLabel
        : plan.stage === 'yesterday'
          ? plan.reviewLabel
          : HEADINGS[plan.stage];
  return { planLabel, heading };
}

function RecoveryControls({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element | null {
  if (!plan.savedDraftReview && !plan.error) return null;
  return (
    <fieldset
      disabled={plan.confirming || plan.deferPending}
      aria-busy={plan.confirming}
      className="min-w-0 space-y-3 border-0 p-0"
    >
      {plan.savedDraftReview ? (
        <InlineBanner
          tone="info"
          title={`Saved plan: ${plan.savedDraftReview.draft.tasks.length} tasks and ${plan.savedDraftReview.draft.sessions.length} blocks. Applying it replaces the edits shown here.`}
          action={{
            label: 'Use saved plan',
            onSelect: () => {
              if (!plan.confirming && !plan.isMovingTask()) void plan.applySavedDraft();
            },
          }}
        />
      ) : null}
      {plan.error ? (
        <InlineBanner
          tone="critical"
          title={plan.error}
          action={{
            label: plan.conflict ? 'Review saved plan' : 'Retry',
            onSelect: () => {
              if (plan.confirming || plan.isMovingTask()) return;
              if (plan.conflict) void plan.reviewSavedDraft();
              else void plan.persist(plan.draft, plan.stage, plan.revision).catch(() => undefined);
            },
          }}
        />
      ) : null}
    </fieldset>
  );
}

/** Render the current planning stage and a safe exit back to Today. */
export function DailyPlanningHeader({
  plan,
  panelControls,
}: {
  readonly plan: ReadyPlanningController;
  readonly panelControls?: ReactNode;
}): JSX.Element {
  const { planLabel, heading } = planningHeading(plan);
  return (
    <div className="space-y-3">
      <PageHeader className="items-center">
        <PageHeading>
          <p className="text-on-surface-variant text-label-medium">
            {formatDay(plan.date, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <PageTitle>{heading}</PageTitle>
        </PageHeading>
        <Button
          variant="secondary"
          disabled={plan.confirming || plan.deferPending}
          onClick={() => {
            if (plan.isMovingTask()) return;
            void (async () => {
              if (plan.stage !== 'confirmed') {
                try {
                  await plan.persist(plan.draft, plan.stage, plan.revision);
                } catch {
                  return;
                }
              }
              if (plan.isCurrentDate()) window.location.assign('/today');
            })();
          }}
        >
          Today
        </Button>
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PlanningSteps plan={plan} planLabel={planLabel} />
        {panelControls}
      </div>
      <RecoveryControls plan={plan} />
    </div>
  );
}
