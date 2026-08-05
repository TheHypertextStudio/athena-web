/**
 * `@docket/api` — a team's workflow, and what a task's state key means inside it.
 *
 * @remarks
 * `task.state` holds a key that is scoped to one team's `workflow_states` array, so the same task
 * can be `in_progress` on one team and `doing` on another and mean the same thing. The five-value
 * type is what actually carries meaning across teams, and it is what drives the status glyph and
 * board grouping (see `StatusIcon.tsx` in `@docket/ui`).
 *
 * A reader that guesses the type from the key gets it wrong the first time a team renames a state,
 * which is precisely the case the type exists to survive. So anything that needs the type resolves
 * it through the owning team rather than pattern-matching the string, and anything that offers a
 * state *picker* takes the options from the same place rather than inventing a list.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, team } from '@docket/db';
import type { WorkflowState, WorkflowStateType } from '@docket/types';

/** Each team's ordered workflow, keyed by team id. */
export type TeamWorkflows = ReadonlyMap<string, readonly WorkflowState[]>;

/**
 * Load the workflow of several teams at once.
 *
 * @remarks
 * Batched deliberately. A list query returns rows across arbitrarily many teams, and resolving per
 * row would turn one page of results into one query per result — the same N+1 an earlier revision
 * of the state *filter* in `list-work.ts` had to be rewritten to avoid.
 *
 * @param orgId - The organization the teams belong to, which also scopes the lookup.
 * @param teamIds - The teams to load, duplicates permitted.
 * @returns each team's states in board order; teams not in `orgId` are simply absent.
 */
export async function teamWorkflows(
  orgId: string,
  teamIds: readonly string[],
): Promise<TeamWorkflows> {
  const unique = [...new Set(teamIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: team.id, workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.organizationId, orgId), inArray(team.id, unique)));

  const byTeam = new Map<string, readonly WorkflowState[]>();
  for (const row of rows) {
    byTeam.set(
      row.id,
      [...row.workflowStates].sort((left, right) => left.position - right.position),
    );
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
 * @param workflows - The mapping from {@link teamWorkflows}.
 * @param teamId - The task's owning team.
 * @param stateKey - The value stored on `task.state`.
 * @returns the canonical type, when it resolves.
 */
export function stateTypeOf(
  workflows: TeamWorkflows,
  teamId: string | null,
  stateKey: string | null,
): WorkflowStateType | undefined {
  if (!teamId || !stateKey) {
    return undefined;
  }
  return workflows.get(teamId)?.find((state) => state.key === stateKey)?.type;
}

/**
 * The states a task on this team may be moved to, in board order.
 *
 * @remarks
 * A widget offering a state picker has to be handed these. It cannot derive them: the keys are
 * per-team, and a card that guessed `done` would write nothing at all on a team whose completed
 * state is called `shipped`.
 *
 * @param workflows - The mapping from {@link teamWorkflows}.
 * @param teamId - The task's owning team.
 * @returns the team's states, or an empty list when the team is unknown.
 */
export function stateOptionsOf(
  workflows: TeamWorkflows,
  teamId: string | null,
): readonly WorkflowState[] {
  if (!teamId) {
    return [];
  }
  return workflows.get(teamId) ?? [];
}
