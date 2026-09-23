'use client';

/** Focused morning planning flow, separate from the default Today page. */
import { InlineBanner } from '@docket/ui/components';
import type { JSX } from 'react';

import { AddWorkStage } from './daily-planning-add';
import { ConfirmedStage } from './daily-planning-confirmed';
import {
  useDailyPlanningController,
  type ReadyPlanningController,
} from './daily-planning-controller';
import { DailyPlanningHeader } from './daily-planning-header';
import { PlanStage } from './daily-planning-plan';
import { YesterdayStage } from './daily-planning-yesterday';

function StageView({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  switch (plan.stage) {
    case 'yesterday':
      return <YesterdayStage plan={plan} />;
    case 'add':
      return <AddWorkStage plan={plan} />;
    case 'confirmed':
      return <ConfirmedStage plan={plan} />;
    default:
      return <PlanStage plan={plan} />;
  }
}

/** Enter a resumable day draft from Today, or adjust an accepted plan. */
export function DailyPlanningSurface(): JSX.Element {
  const controller = useDailyPlanningController();
  if (controller.dayQ.isError || controller.previousQ.isError) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <InlineBanner
          tone="critical"
          title="Could not load your plan."
          action={{
            label: 'Retry',
            onSelect: () => {
              void controller.dayQ.refetch();
              void controller.previousQ.refetch();
            },
          }}
        />
      </div>
    );
  }
  if (controller.dayQ.isPending || controller.previousQ.isPending || !controller.draft) {
    return <div className="mx-auto max-w-5xl p-8">Loading daily plan…</div>;
  }
  const plan: ReadyPlanningController = { ...controller, draft: controller.draft };
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 @2xl:px-8">
      <DailyPlanningHeader plan={plan} />
      <StageView plan={plan} />
    </div>
  );
}
