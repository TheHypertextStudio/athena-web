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
        const [assignment] = await db
          .select({ id: athenaAssignment.id })
          .from(athenaAssignment)
          .where(
            and(
              eq(athenaAssignment.id, input.assignmentId),
              eq(athenaAssignment.ownerUserId, ownerUserId),
            ),
          )
          .limit(1);
        if (!assignment) throw new NotFoundError('Assignment not found');
        const [updated] = await db
          .update(athenaTrigger)
          .set({ enabled: false })
          .where(
            and(
              eq(athenaTrigger.id, input.triggerId),
              eq(athenaTrigger.assignmentId, assignment.id),
              eq(athenaTrigger.ownerUserId, ownerUserId),
            ),
          )
          .returning({ id: athenaTrigger.id });
        if (!updated) throw new NotFoundError('Trigger not found');
        return jsonResult({ id: updated.id, enabled: false });
      }),
  );

  server.registerTool(
    'remove_athena_assignment_trigger',
    {
      title: 'Remove Athena assignment trigger',
      description: 'Remove one trigger belonging to the current user’s personal Athena assignment.',
      inputSchema: triggerIdentity,
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
        const [assignment] = await db
          .select({ id: athenaAssignment.id })
          .from(athenaAssignment)
          .where(
            and(
              eq(athenaAssignment.id, input.assignmentId),
              eq(athenaAssignment.ownerUserId, ownerUserId),
            ),
          )
          .limit(1);
        if (!assignment) throw new NotFoundError('Assignment not found');
        const [removed] = await db
          .delete(athenaTrigger)
          .where(
            and(
              eq(athenaTrigger.id, input.triggerId),
              eq(athenaTrigger.assignmentId, assignment.id),
              eq(athenaTrigger.ownerUserId, ownerUserId),
            ),
          )
          .returning({ id: athenaTrigger.id });
        if (!removed) throw new NotFoundError('Trigger not found');
        return jsonResult({ id: removed.id, removed: true });
      }),
  );
}
