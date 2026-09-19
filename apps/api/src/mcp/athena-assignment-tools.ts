/** Personal Athena tools for managing only the current owner's assignment triggers. */
import { athenaAssignment, athenaTrigger, db } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { jsonResult, runTool } from './result';
import { requireScope } from './scope';
import { NotFoundError } from '../error';

const triggerIdentity = {
  assignmentId: z.string().min(1),
  triggerId: z.string().min(1),
};

/**
 * Resolve the assignment a trigger belongs to, scoped to its owner.
 *
 * @remarks
 * Every trigger write reads the assignment first, so a trigger id belonging to someone else's
 * assignment reads as "not found" rather than as a refusal that confirms it exists.
 *
 * @param ownerUserId - The person whose personal Athena this is.
 * @param assignmentId - The assignment the trigger is claimed to belong to.
 * @returns The assignment's id.
 * @throws {NotFoundError} When the assignment is not this person's.
 */
async function requireOwnedAssignment(ownerUserId: string, assignmentId: string): Promise<string> {
  const [assignment] = await db
    .select({ id: athenaAssignment.id })
    .from(athenaAssignment)
    .where(
      and(eq(athenaAssignment.id, assignmentId), eq(athenaAssignment.ownerUserId, ownerUserId)),
    )
    .limit(1);
  if (!assignment) throw new NotFoundError('Assignment not found');
  return assignment.id;
}

/** The trigger a tool call names, once its assignment is known to be the caller's. */
interface TriggerTarget {
  readonly ownerUserId: string;
  readonly assignmentId: string;
  readonly triggerId: string;
}

/**
 * Pause one trigger, refusing anything outside the caller's own assignment.
 *
 * @param target - The trigger to pause.
 * @returns The paused trigger's id.
 * @throws {NotFoundError} When the assignment or trigger is not this person's.
 */
async function pauseOwnedTrigger(target: TriggerTarget): Promise<string> {
  const assignmentId = await requireOwnedAssignment(target.ownerUserId, target.assignmentId);
  const [updated] = await db
    .update(athenaTrigger)
    .set({ enabled: false })
    .where(
      and(
        eq(athenaTrigger.id, target.triggerId),
        eq(athenaTrigger.assignmentId, assignmentId),
        eq(athenaTrigger.ownerUserId, target.ownerUserId),
      ),
    )
    .returning({ id: athenaTrigger.id });
  if (!updated) throw new NotFoundError('Trigger not found');
  return updated.id;
}

/**
 * Remove one trigger, refusing anything outside the caller's own assignment.
 *
 * @param target - The trigger to remove.
 * @returns The removed trigger's id.
 * @throws {NotFoundError} When the assignment or trigger is not this person's.
 */
async function removeOwnedTrigger(target: TriggerTarget): Promise<string> {
  const assignmentId = await requireOwnedAssignment(target.ownerUserId, target.assignmentId);
  const [removed] = await db
    .delete(athenaTrigger)
    .where(
      and(
        eq(athenaTrigger.id, target.triggerId),
        eq(athenaTrigger.assignmentId, assignmentId),
        eq(athenaTrigger.ownerUserId, target.ownerUserId),
      ),
    )
    .returning({ id: athenaTrigger.id });
  if (!removed) throw new NotFoundError('Trigger not found');
  return removed.id;
}

/** Register owner-scoped trigger controls only for user principals. */
export function registerAthenaAssignmentTools(server: McpRegistrar, ctx: McpContext): void {
  if (ctx.principal.kind !== 'user') return;
  const ownerUserId = ctx.principal.userId;

  server.registerTool(
    'pause_athena_assignment_trigger',
    {
      title: 'Pause Athena assignment trigger',
      description: 'Pause one trigger belonging to the current user’s personal Athena assignment.',
      inputSchema: triggerIdentity,
      outputSchema: {
        id: z.string().describe('The paused trigger.'),
        enabled: z.literal(false).describe('Always false — pausing is what this tool does.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        requireScope(ctx.scopes, 'work:write');
        const id = await pauseOwnedTrigger({ ownerUserId, ...input });
        return jsonResult({ id, enabled: false });
      }),
  );

  server.registerTool(
    'remove_athena_assignment_trigger',
    {
      title: 'Remove Athena assignment trigger',
      description: 'Remove one trigger belonging to the current user’s personal Athena assignment.',
      inputSchema: triggerIdentity,
      outputSchema: {
        id: z.string().describe('The removed trigger.'),
        removed: z.literal(true).describe('Always true — the row is gone once this returns.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        requireScope(ctx.scopes, 'work:write');
        const id = await removeOwnedTrigger({ ownerUserId, ...input });
        return jsonResult({ id, removed: true });
      }),
  );
}
