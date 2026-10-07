'use client';

/** Typed, optional Athena read over one current planning proposal. */
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { api } from '@/lib/api';
import { unwrap, useApiMutation } from '@/lib/query';

/** Request a short assessment without holding up saving or confirming the plan. */
export function useDailyPlanAssessment(date: string) {
  return useApiMutation({
    mutationFn: ({
      draft,
      proposalFingerprint,
    }: {
      draft: DailyPlanSnapshot;
      proposalFingerprint: string;
    }) =>
      unwrap(
        () =>
          api.v1['daily-plan'].day[':date'].assessment.$post({
            param: { date },
            json: { draft, proposalFingerprint },
          }),
        'Athena could not review this plan.',
      ),
    invalidateKeys: [],
  });
}
