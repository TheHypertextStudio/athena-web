import { z } from 'zod';
import { setTaskState } from '../task-state';
import { eventOf } from './handler-context';
import type { Registry } from './registry';
const SetStatusParams = z.object({ state: z.string().min(1) });

/** Register the exact persisted task-state action; event attribution never stands in for rule authority. */
export function registerTaskStatusAction(registry: Registry): void {
  // task.setStatus — move the firing task to a workflow state (shared transition lib).
  registry.register({
    type: 'task.setStatus',
    run: async (ctx, params): Promise<void> => {
      const event = eventOf(ctx);
      const parsed = SetStatusParams.safeParse(params);
      if (!parsed.success || event.subjectType !== 'task' || !event.subjectId || !ctx.execution)
        return;
      try {
        await setTaskState({
          automationExecution: ctx.execution,
          organizationId: event.organizationId,
          taskId: event.subjectId,
          state: parsed.data.state,
          actorId: event.actorId ?? null,
        });
      } catch (error) {
        // Unknown state key for the task's team — a rule-config problem, not a throw.
        console.warn('[automation] task.setStatus skipped', {
          taskId: event.subjectId,
          state: parsed.data.state,
          error,
        });
      }
    },
  });
}
