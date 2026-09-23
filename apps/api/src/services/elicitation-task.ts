/**
 * `@docket/api` — create the task an Athena question exists to implement.
 *
 * @remarks
 * Split from `elicitation-service.ts` so the insert and its change set live together. The task is
 * recorded under the provenance of whoever raised the question: Athena's session when the agent
 * loop materializes it, or the MCP or app caller that raised it directly.
 */
import { db, task } from '@docket/db';

import { recordCreatedRow } from '../lib/provenance/record-created';
import type { LandingTarget } from '../lib/task-landing';

/** Where an elicitation task lands and what it says. */
export interface ElicitationTaskInput {
  readonly organizationId: string;
  /** The owner's actor in that workspace; the task's creator. */
  readonly actorId: string;
  readonly landing: LandingTarget;
  /** The action the answer authorizes; the task's title. */
  readonly actionSummary: string;
  /** The question; the task's description. */
  readonly question: string;
}

/**
 * Insert the task one question implements and record its creation.
 *
 * @param input - Workspace, creator, landing, title source, and description.
 * @returns the new task's id.
 */
export async function insertElicitationTask(input: ElicitationTaskInput): Promise<string> {
  const { organizationId, actorId, landing } = input;
  const [created] = await db
    .insert(task)
    .values({
      organizationId,
      title: input.actionSummary.slice(0, 120),
      description: input.question,
      teamId: landing.teamId,
      statusId: landing.statusId,
      state: landing.state,
      assigneeId: landing.assigneeId,
      cycleId: landing.cycleId,
      source: 'native',
      createdBy: actorId,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!created) throw new Error('elicitation task insert returned no row');
  await recordCreatedRow('task', created, 'elicitation_task');
  return created.id;
}
