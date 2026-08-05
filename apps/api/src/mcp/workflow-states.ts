/**
 * `@docket/api` — resolving a task's per-team workflow state onto its canonical type.
 *
 * @remarks
 * `task.state` holds a key that is scoped to one team's `workflow_states` array, so the same task
 * can be `in_progress` on one team and `doing` on another and mean the same thing. The five-value
 * type is what actually carries meaning across teams, and it is what drives the status glyph and
 * board grouping (see `StatusIcon.tsx` in `@docket/ui`).
 *
 * A reader that guesses the type from the key gets it wrong the first time a team renames a state,
 * which is precisely the case the type exists to survive. So anything that needs the type resolves
 * it through the owning team rather than pattern-matching the string.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, team } from '@docket/db';
import type { WorkflowStateType } from '@docket/types';

/** Each team's `state key → canonical type` mapping, keyed by team id. */
export type WorkflowStateTypes = ReadonlyMap<string, ReadonlyMap<string, WorkflowStateType>>;

/**
 * Load the state-key mapping for several teams at once.
 *
 * @remarks
 * Batched deliberately. A list query returns rows across arbitrarily many teams, and resolving the
 * type per row would turn one page of results into one query per result — the same N+1 an earlier
 * revision of the state *filter* in `list-work.ts` had to be rewritten to avoid.
 *
 * @param orgId - The organization the teams belong to, which also scopes the lookup.
 * @param teamIds - The teams to load, duplicates permitted.
 * @returns the mapping per team; teams that do not exist in `orgId` are simply absent.
 */
export async function workflowStateTypes(
  orgId: string,
  teamIds: readonly string[],
): Promise<WorkflowStateTypes> {
  const unique = [...new Set(teamIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: team.id, workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.organizationId, orgId), inArray(team.id, unique)));

  const byTeam = new Map<string, ReadonlyMap<string, WorkflowStateType>>();
  for (const row of rows) {
    byTeam.set(row.id, new Map(row.workflowStates.map((state) => [state.key, state.type])));
  }
  return byTeam;
}

/**
 * The canonical type of one task's state.
 *
 * @remarks
 * Returns `undefined` rather than a default when the team is unknown or the key is not in its
 * workflow — a state whose type nobody can establish must render as no glyph, not as a wrong one.
 *
 * @param types - The mapping from {@link workflowStateTypes}.
 * @param teamId - The task's owning team.
 * @param stateKey - The value stored on `task.state`.
 * @returns the canonical type, when it resolves.
 */
export function stateTypeOf(
  types: WorkflowStateTypes,
  teamId: string | null,
  stateKey: string | null,
): WorkflowStateType | undefined {
  if (!teamId || !stateKey) {
    return undefined;
  }
  return types.get(teamId)?.get(stateKey);
}
