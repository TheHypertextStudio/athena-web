'use client';

import { Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for the prominent Unplanned-state Athena action. */
export interface PlanTodayCardProps {
  /** Expand the shared Athena session with planning intent. */
  readonly onPlan: () => void;
}

/** Invite Athena to build a reviewable day when no accepted plan exists. */
export default function PlanTodayCard({ onPlan }: PlanTodayCardProps): JSX.Element {
  return (
    <section className="border-primary/25 bg-primary/6 relative overflow-hidden rounded-2xl border p-5 @xl:p-6">
      <div className="bg-primary/10 absolute -top-12 -right-10 size-32 rounded-full" aria-hidden />
      <div className="relative flex flex-col items-start justify-between gap-5 @xl:flex-row @xl:items-center">
        <div className="max-w-xl">
          <p className="text-primary text-label-large mb-1 flex items-center gap-2 font-semibold">
            <Sparkles aria-hidden="true" className="size-4" /> Athena can shape this day
          </p>
          <h2 className="text-on-surface text-title-large font-semibold">Plan today with Athena</h2>
          <p className="text-on-surface-variant text-body-medium mt-1.5">
            Fit priorities and deadlines around the time you actually have. Review the plan before
            anything changes.
          </p>
        </div>
        <Button type="button" onClick={onPlan} className="min-h-11 shrink-0">
          <Sparkles aria-hidden="true" /> Plan today with Athena
        </Button>
      </div>
    </section>
  );
}
