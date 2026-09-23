'use client';

/** Date, stage and save state above the focused flow. */
import { InlineBanner } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives';
import { addDays } from '@docket/planning/zoned-time';
import { formatDay } from '@/components/date-picker';
import type { JSX } from 'react';

import type { ReadyPlanningController } from './daily-planning-controller';

const HEADINGS = {
  yesterday: 'Review yesterday',
  add: 'Add work',
  review: 'Review plan',
} as const;

function PlanningSteps({
  stage,
  planLabel,
}: {
  readonly stage: ReadyPlanningController['stage'];
  readonly planLabel: string;
}): JSX.Element | null {
  if (stage === 'confirmed' || stage === 'add') return null;
  return (
    <nav
      aria-label="Planning steps"
      className="text-on-surface-variant text-label-medium flex flex-wrap gap-3"
    >
      <span aria-current={stage === 'yesterday' ? 'step' : undefined}>Review yesterday</span>
      <span aria-hidden="true">→</span>
      <span aria-current={stage === 'plan' ? 'step' : undefined}>{planLabel}</span>
      <span aria-hidden="true">→</span>
      <span aria-current={stage === 'review' ? 'step' : undefined}>Review plan</span>
    </nav>
  );
}

/** Render the current planning stage and a safe exit back to Today. */
export function DailyPlanningHeader({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element {
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
        : HEADINGS[plan.stage];
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-on-surface-variant text-label-medium">
            {formatDay(plan.date, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <h1 className="text-on-surface text-headline-medium">{heading}</h1>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void (async () => {
              if (plan.stage !== 'confirmed') {
                try {
                  await plan.persist(plan.draft, plan.stage, plan.revision);
                } catch {
                  return;
                }
              }
              window.location.assign('/today');
            })();
          }}
        >
          Today
        </Button>
      </header>
      <PlanningSteps stage={plan.stage} planLabel={planLabel} />
      {plan.error ? (
        <InlineBanner
          tone="critical"
          title={plan.error}
          action={{
            label: 'Retry',
            onSelect: () => {
              void plan.persist(plan.draft, plan.stage, plan.revision).catch(() => undefined);
            },
          }}
        />
      ) : null}
    </>
  );
}
