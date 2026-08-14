/**
 * `@docket/api` — shared helpers action handlers close over: reading the firing event off the
 * context, and loading the task subject it fired on.
 *
 * @remarks
 * Split out from `handlers.ts` so single-action modules (e.g. `handlers-cycle.ts`) can reuse
 * these without importing the whole handler registry file and creating a cycle.
 */
import { db, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { ActionContext } from './engine';
import type { AutomationEvent } from './event';

/** Read the structured event off the action context. */
export function eventOf(ctx: ActionContext): AutomationEvent {
  return ctx.event as AutomationEvent;
}

/** Load the firing task subject (org-scoped, active), or `undefined` for a no-op. */
export async function taskOf(
  event: AutomationEvent,
): Promise<typeof task.$inferSelect | undefined> {
  if (event.subjectType !== 'task' || !event.subjectId) return undefined;
  const rows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.id, event.subjectId),
        eq(task.organizationId, event.organizationId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  return rows[0];
}
