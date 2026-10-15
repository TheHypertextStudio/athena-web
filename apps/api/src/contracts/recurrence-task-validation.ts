/** Shared validation for task specifications stored in immutable process revisions. */
import { validateWorkTemplateSelection } from '@docket/work/work-template-reference';
import type { z } from 'zod';

interface TaskSelection {
  workTypeId?: string | undefined;
  workTypeVersionId?: string | undefined;
  projectId?: string | undefined;
  projectKey?: string | undefined;
  milestoneId?: string | undefined;
  milestoneKey?: string | undefined;
  parentTaskId?: string | undefined;
  parentTaskKey?: string | undefined;
  startOffsetDays?: number | undefined;
  dueOffsetDays?: number | undefined;
}

/** Refuse incomplete identities, conflicting placements, and reversed task dates. */
export function validateProcessTaskSelection(value: TaskSelection, ctx: z.RefinementCtx): void {
  validateWorkTemplateSelection(value, ctx);
  for (const [fixed, generated] of [
    ['projectId', 'projectKey'],
    ['milestoneId', 'milestoneKey'],
    ['parentTaskId', 'parentTaskKey'],
  ] as const) {
    if (value[fixed] === undefined || value[generated] === undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: [fixed],
      message: 'A task reference must be either fixed or generated, not both',
    });
  }
  if (
    value.startOffsetDays !== undefined &&
    value.dueOffsetDays !== undefined &&
    value.dueOffsetDays < value.startOffsetDays
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueOffsetDays'],
      message: 'Due-date offset cannot fall before the start-date offset',
    });
  }
}
