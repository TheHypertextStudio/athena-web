'use client';
import { Suspense, type JSX } from 'react';
import { DailyPlanningSurface } from '@/components/daily-planning/daily-planning-surface';
/** Render the existing planning activity when an activity document is replayed offline. */
export default function DailyPlanClient(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <DailyPlanningSurface />
    </Suspense>
  );
}
