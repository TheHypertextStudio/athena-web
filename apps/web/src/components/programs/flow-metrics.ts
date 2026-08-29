/** Pure aggregation for the Program Overview's health-and-flow snapshot. */
import type { ProgramWorkOut } from '@docket/types';

import type { CategoryOfState } from '@/lib/work-category';

/** The operational counts consumed by {@link FlowSnapshot}. */
export interface ProgramFlowMetrics {
  readonly inFlight: number;
  readonly queued: number;
  readonly done: number;
  readonly activeCycles: number;
}

/** Derive flow from the same visible program work that the Work tab serves. */
export function programFlowMetrics(
  work: ProgramWorkOut | undefined,
  categoryOf: CategoryOfState,
): ProgramFlowMetrics {
  if (!work) return { inFlight: 0, queued: 0, done: 0, activeCycles: 0 };

  let inFlight = 0;
  let queued = 0;
  let done = 0;
  for (const group of work.groups) {
    for (const segment of group.segments) {
      for (const task of segment.tasks) {
        const category = categoryOf(task.state);
        if (category === 'started') inFlight += 1;
        if (category === 'backlog' || category === 'unstarted') queued += 1;
        if (category === 'completed') done += 1;
      }
    }
  }
  return {
    inFlight,
    queued,
    done,
    activeCycles: work.groups.filter((group) => group.cycle.id !== null).length,
  };
}
