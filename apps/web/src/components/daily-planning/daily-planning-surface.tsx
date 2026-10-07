'use client';

/** Focused morning planning flow, separate from the default Today page. */
import { ImmersiveShell, InlineBanner } from '@docket/ui/components';
import { Skeleton, SkeletonText } from '@docket/ui/primitives';
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { useOptionalResolvedAccountId } from '@/components/resolved-account';
import { dailyPlanningEntryKey, recordDailyPlanningEntry } from './automatic-daily-planning-model';

import { AddWorkStage } from './daily-planning-add';
import { ConfirmedStage } from './daily-planning-confirmed';
import {
  useDailyPlanningController,
  type ReadyPlanningController,
} from './daily-planning-controller';
import { DailyPlanningHeader } from './daily-planning-header';
import { PlanningPanelControls, type PlanningPanels } from './daily-planning-panels';
import { PlanStage, PlanningActions } from './daily-planning-plan';
import { YesterdayStage } from './daily-planning-yesterday';

function StageView({
  plan,
  panels,
}: {
  readonly plan: ReadyPlanningController;
  readonly panels: PlanningPanels;
}): JSX.Element {
  switch (plan.stage) {
    case 'yesterday':
      return <YesterdayStage plan={plan} />;
    case 'add':
      return <AddWorkStage plan={plan} />;
    case 'confirmed':
      return <ConfirmedStage plan={plan} />;
    default:
      return <PlanStage plan={plan} panels={panels} />;
  }
}

function PlanningLoading({ exit }: { readonly exit: ReactNode }): JSX.Element {
  return (
    <ImmersiveShell header={exit}>
      <div
        role="status"
        aria-label="Loading daily plan"
        className="flex w-full flex-col gap-4 px-4 pb-4 sm:px-6 sm:pb-6"
      >
        <div className="space-y-2">
          <SkeletonText className="w-44" />
          <SkeletonText scale="headline" className="w-56" />
        </div>
        <div className="flex flex-wrap gap-2">
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
    </ImmersiveShell>
  );
}

/** Enter a resumable day draft from Today, or adjust an accepted plan. */
export function DailyPlanningSurface(): JSX.Element {
  const controller = useDailyPlanningController();
  const [panels, setPanels] = useState<PlanningPanels>({ work: true, agenda: true });
  const userId = useOptionalResolvedAccountId();
  useEffect(() => {
    if (userId)
      recordDailyPlanningEntry(dailyPlanningEntryKey(userId, controller.timezone, controller.date));
  }, [userId, controller.timezone, controller.date]);
  useEffect(() => {
    document.getElementById('main-content')?.scrollTo({ top: 0 });
  }, [controller.stage]);
  const exit = (
    <Button variant="secondary" asChild>
      <Link href="/today">Today</Link>
    </Button>
  );
  if (
    controller.dayQ.isError ||
    controller.previousQ.isError ||
    (!controller.draft && Boolean(controller.error))
  ) {
    return (
      <ImmersiveShell header={exit}>
        <div className="p-4 sm:p-6">
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
      </ImmersiveShell>
    );
  }
  if (controller.dayQ.isPending || controller.previousQ.isPending || !controller.draft) {
    return <PlanningLoading exit={exit} />;
  }
  const plan: ReadyPlanningController = { ...controller, draft: controller.draft };
  return (
    <ImmersiveShell
      footer={
        plan.stage === 'plan' || plan.stage === 'review' ? (
          <PlanningActions plan={plan} />
        ) : undefined
      }
      header={
        <DailyPlanningHeader
          plan={plan}
          panelControls={
            plan.stage === 'plan' || plan.stage === 'review' ? (
              <PlanningPanelControls panels={panels} onChange={setPanels} />
            ) : undefined
          }
        />
      }
    >
      <div className="px-3 pb-4 sm:px-6 sm:pb-6">
        <StageView plan={plan} panels={panels} />
      </div>
    </ImmersiveShell>
  );
}
