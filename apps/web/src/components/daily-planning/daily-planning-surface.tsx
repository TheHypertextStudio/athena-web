'use client';

/** Focused morning planning flow, separate from the default Today page. */
import { InlineBanner } from '@docket/ui/components';
import { Skeleton, SkeletonText } from '@docket/ui/primitives';
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
  if (
    controller.dayQ.isError ||
    controller.previousQ.isError ||
    (!controller.draft && Boolean(controller.error))
  ) {
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
              void controller.retryInitialProposal();
            },
          }}
        />
      </div>
    );
  }
  if (controller.dayQ.isPending || controller.previousQ.isPending || !controller.draft) {
    return (
      <div
        role="status"
        aria-label="Loading daily plan"
        className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:gap-6 sm:py-8 @2xl:px-8"
      >
        <div className="space-y-2">
          <SkeletonText className="w-44" />
          <SkeletonText scale="headline" className="w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <SkeletonText scale="title" className="w-24" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <SkeletonText scale="title" className="w-28" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }
  const plan: ReadyPlanningController = { ...controller, draft: controller.draft };
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:gap-6 sm:py-8 @2xl:px-8">
      <DailyPlanningHeader plan={plan} />
      <StageView plan={plan} />
    </div>
  );
}
