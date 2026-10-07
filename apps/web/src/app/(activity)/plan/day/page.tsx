import { Suspense, type JSX } from 'react';
import { DailyPlanningSurface } from '@/components/daily-planning/daily-planning-surface';

/** Daily planning owns an activity route separate from Today and weekly planning. */
export default function DailyPlanPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <DailyPlanningSurface />
    </Suspense>
  );
}
