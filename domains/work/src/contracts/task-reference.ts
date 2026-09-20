import { z } from 'zod';
import { TaskId, ProjectId } from '../ids';

/** A lightweight Task reference carrying its project for cross-project dependency display. */
export const TaskRef = z
  .object({
    id: TaskId.describe('Referenced task id.'),
    title: z.string().describe('Referenced task title, for display without a second fetch.'),
    state: z.string().describe('Referenced task’s current workflow-state key.'),
    projectId: ProjectId.nullable()
      .optional()
      .describe(
        'Referenced task’s project; null when project-less. Lets the UI render cross-project links.',
      ),
  })
  .meta({ id: 'TaskRef', description: 'A task reference with its project.' });
/** Task reference value. */
export type TaskRef = z.infer<typeof TaskRef>;
