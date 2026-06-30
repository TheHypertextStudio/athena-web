/**
 * `@docket/api` — where a captured/accepted task lands.
 *
 * @remarks
 * The single definition of the "default landing target" rule, shared by quick-capture and the
 * email-suggestion accept flow (both create a task from loose input without a team picker): the
 * org's oldest active team, that team's first workflow state, the caller as assignee, and the
 * team's current cycle when a window covers today. Centralized so the rule lives in one place.
 */
import { actor, db, team } from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';

import { resolveCurrentCycleId } from './current-cycle';

/** The resolved landing target for a new task. */
export interface LandingTarget {
  readonly teamId: string;
  /** The team's first workflow-state key, or `backlog` for a stateless team. */
  readonly state: string;
  /** The caller as assignee, or `null` if they're not a resolvable actor in the org. */
  readonly assigneeId: string | null;
  /** The team's current cycle, or `null` when no window covers today. */
  readonly cycleId: string | null;
}

/**
 * Resolve where a new task should land for `actorId` in `orgId`, or `null` when the org has no
 * team to land in (callers surface that as a 404).
 *
 * @param orgId - The active organization id.
 * @param actorId - The calling actor (becomes the assignee when resolvable).
 */
export async function resolveLandingTarget(
  orgId: string,
  actorId: string,
): Promise<LandingTarget | null> {
  // Team and assignee lookups are independent — run them together; the cycle needs the team.
  const [teamRows, assigneeRows] = await Promise.all([
    db
      .select({ id: team.id, workflowStates: team.workflowStates })
      .from(team)
      .where(eq(team.organizationId, orgId))
      .orderBy(asc(team.createdAt))
      .limit(1),
    db
      .select({ id: actor.id })
      .from(actor)
      .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
      .limit(1),
  ]);
  const teamRow = teamRows[0];
  if (!teamRow) return null;

  return {
    teamId: teamRow.id,
    state: teamRow.workflowStates[0]?.key ?? 'backlog',
    assigneeId: assigneeRows[0]?.id ?? null,
    cycleId: await resolveCurrentCycleId(orgId, teamRow.id),
  };
}
