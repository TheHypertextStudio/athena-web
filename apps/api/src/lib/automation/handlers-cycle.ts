/**
 * `@docket/api` — automation action: `task.assignToCycle`.
 *
 * @remarks
 * Files the firing task into its team's current cycle, but only when it has no cycle yet —
 * mirrors `resolveLandingTarget`'s capture-time behavior (`../task-landing.ts`) for existing
 * tasks moving through the workflow later, never overwriting a cycle someone assigned by hand.
 * See `docs/engineering/specs/automations.md`.
 */
import { db, task } from '@docket/db';
import { eq } from 'drizzle-orm';

import { resolveCurrentCycleId } from '../current-cycle';
import { eventOf, taskOf } from './handler-context';
import type { Registry } from './registry';

/** Register `task.assignToCycle` on the given registry. */
export function registerCycleAssignAction(registry: Registry): void {
  registry.register({
    type: 'task.assignToCycle',
    run: async (ctx): Promise<void> => {
      const event = eventOf(ctx);
      const row = await taskOf(event);
      if (row?.cycleId !== null) return;
      const cycleId = await resolveCurrentCycleId(event.organizationId, row.teamId);
      if (!cycleId) return; // no window covers today — leave it in triage
      await db.update(task).set({ cycleId }).where(eq(task.id, row.id));
    },
  });
}
