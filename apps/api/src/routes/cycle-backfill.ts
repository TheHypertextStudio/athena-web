/**
 * `@docket/api` — cycle backlog-backfill: assign a team's unscoped tasks to one cycle.
 *
 * @remarks
 * Only ever fills the `cycle_id IS NULL` gap — a task already on any cycle, this one or
 * another, is left untouched, mirroring the reviewed-carryover posture of `POST /:id/close`
 * (`cycles.ts`). Terminal-state tasks (`completed`/`canceled`) are excluded, since a done or
 * abandoned task has no reason to join an active cycle. Idempotent: a repeat call only touches
 * tasks still missing a cycle.
 */
import { db, task } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { loadCycle, loadTeam, nonTerminalStateKeys } from './cycle-helpers';

/** Result of a backlog-backfill sweep: which task ids moved onto the cycle. */
export interface BackfillResult {
  readonly taskIds: readonly string[];
}

/** Sweep `cycleId`'s team for open, unscoped tasks and assign them to this cycle. */
export async function backfillCycleBacklog(
  orgId: string,
  cycleId: string,
): Promise<BackfillResult> {
  const cy = await loadCycle(orgId, cycleId);
  const teamRow = await loadTeam(orgId, cy.teamId);
  const openStateKeys = nonTerminalStateKeys(teamRow);
  if (openStateKeys.length === 0) return { taskIds: [] };

  const assigned = await db
    .update(task)
    .set({ cycleId })
    .where(
      and(
        eq(task.organizationId, orgId),
        eq(task.teamId, cy.teamId),
        isNull(task.cycleId),
        isNull(task.archivedAt),
        inArray(task.state, openStateKeys),
      ),
    )
    .returning({ id: task.id });

  return { taskIds: assigned.map((row) => row.id) };
}
