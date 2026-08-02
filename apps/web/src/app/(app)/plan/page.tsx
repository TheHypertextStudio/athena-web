'use client';

import type { JSX } from 'react';
import { Suspense } from 'react';

import { PlanSurface } from '@/components/scheduling-plan/plan-surface';

/**
 * The plan route — the generated week and the daily loop that runs off it.
 *
 * @remarks
 * A thin route: everything lives in `components/scheduling-plan/` so the same three lenses can be
 * mounted anywhere else (a rail panel, a focused dialog) without a second copy.
 */
export default function PlanPage(): JSX.Element {
  // `useSearchParams` needs a Suspense boundary in the App Router; the surface owns its own
  // skeletons, so the fallback here is only for the split second before hydration.
  return (
    <Suspense fallback={null}>
      <PlanSurface />
    </Suspense>
  );
}
