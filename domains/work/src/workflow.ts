import { z } from 'zod';

import {
  compareWorkStatusOrder,
  DEFAULT_WORK_STATUSES,
  WorkStatusCategory,
} from './contracts/work-status';

/** One configurable state in a team's persisted workflow. */
export const WorkflowState = z
  .object({
    key: z
      .string()
      .min(1)
      .describe(
        "Stable per-team identifier for this state, stored on `task.state`. There is no global FK — keys are scoped to the team's `workflow_states` array — so keys need only be unique within one team's workflow.",
      ),
    name: z
      .string()
      .min(1)
      .describe('Human-readable label shown on the board column / status picker.'),
    type: WorkStatusCategory.describe(
      'The canonical category this state maps onto (backlog/unstarted/started/completed/canceled), used for icons and grouping.',
    ),
    position: z
      .number()
      .int()
      .describe(
        "Integer sort order of this state within the team's workflow (ascending, left-to-right on the board).",
      ),
  })
  .meta({ id: 'WorkflowState', description: "One state in a team's workflow." });
/** One configurable state in a team's persisted workflow. */
export type WorkflowState = z.infer<typeof WorkflowState>;

/** Default per-team workflow derived from the canonical Work status seed. */
export const DEFAULT_WORKFLOW_STATES: readonly WorkflowState[] = [...DEFAULT_WORK_STATUSES.task]
  .sort(compareWorkStatusOrder)
  .map((seed, index) => ({
    key: seed.key,
    name: seed.name,
    type: seed.category,
    position: index,
  }));
