import type { DirectiveOut } from '@docket/planning/scheduling-directive-contract';
import type { z } from 'zod';
import type { DayBlock } from './day-loop';

/** Serialize a block as a directive plan item. */
export function toPlanItem(
  block: DayBlock,
  appUrl: string | null,
): z.input<typeof DirectiveOut>['plan'][number] {
  return {
    taskId: block.taskId,
    calendarItemId: block.calendarItemId,
    organizationId: block.organizationId,
    title: block.title,
    shape: block.shape,
    status: block.done ? 'done' : 'planned',
    startsAt: new Date(block.start).toISOString(),
    endsAt: new Date(block.end).toISOString(),
    url: appUrl === null ? null : `${appUrl}/calendar?item=${block.calendarItemId}`,
  };
}
