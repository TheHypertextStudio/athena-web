import type { z } from 'zod';
import { CursorQuery } from '../cursor-query';
import { LabelId, MilestoneId, ProgramId } from '../ids';

/** Query filters for listing tasks. */
export const TaskListQuery = CursorQuery.extend({
  programId: ProgramId.optional().describe(
    'Restrict the list to tasks under a Program — carrying its `programId` directly, or belonging to one of the Program’s Projects. Omit for the full active-task list.',
  ),
  labelId: LabelId.optional().describe(
    'Restrict the list to tasks carrying this label. Combines with `programId` as an AND. Omit for no label filter.',
  ),
  milestoneId: MilestoneId.optional().describe(
    'Restrict the list to tasks on this milestone. Combines with the other filters as an AND. Omit for no milestone filter.',
  ),
}).meta({ id: 'TaskListQuery', description: 'Query filters for listing tasks.' });
/** Validated task-list query value. */
export type TaskListQuery = z.infer<typeof TaskListQuery>;
