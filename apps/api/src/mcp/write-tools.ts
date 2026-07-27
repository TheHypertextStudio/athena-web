/**
 * `@docket/api` — the intent-shaped write tools, and the undo that makes them safe.
 *
 * @remarks
 * These are named for what a person is trying to do rather than for the row they touch. `capture`
 * exists because "add a task from what we just discussed" should not require knowing an org's team
 * layout, its workflow states, or which cycle is current — `resolveLandingTarget` knows all three,
 * and an agent that has to ask first is an agent that gets them wrong.
 *
 * Every write here records a change set, because the surface executes immediately instead of
 * proposing. That is only a defensible trade if the caller can see what happened and reverse it.
 */
import { changeSet, db, task } from '@docket/db';
import { TaskId } from '@docket/types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { deriveCaptureTitle } from '../lib/capture-title';
import { resolveLandingTarget } from '../lib/task-landing';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, undoChangeSet } from './change-set';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

/** Register capture and undo on `server`. */
export function registerWriteTools(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null,
): void {
  /** The origin stamped on everything these tools record. */
  const originFor = (tool: string) => ({
    tool,
    ...(sessionId ? { sessionId } : {}),
    ...(ctx.principal.kind === 'agent' ? { client: ctx.principal.displayName } : {}),
  });

  server.registerTool(
    'capture',
    {
      title: 'Capture',
      description:
        'Turn something said into a task, without needing to know where it should go. The team, workflow state, current cycle, and assignee are all resolved for you, so this is the cheapest path from a sentence to a tracked piece of work. Use organize when you need to place it precisely, or file several things at once.',
      inputSchema: {
        orgId: orgIdParam,
        text: z
          .string()
          .min(1)
          .describe(
            'The text to capture. The first line becomes the title; the whole thing becomes the description, so pasting several lines is fine.',
          ),
      },
      outputSchema: {
        id: TaskId,
        title: z.string(),
        state: z.string().describe("The workflow state it landed in — the team's first."),
        teamId: z.string().describe('The team it landed on.'),
        changeSetId: z.string().describe('Pass to `undo` to take this back.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const landing = await resolveLandingTarget(input.orgId, actorCtx.actorId);
        if (!landing) throw new NotFoundError('No team to capture into');

        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: deriveCaptureTitle(input.text),
            description: input.text,
            teamId: landing.teamId,
            state: landing.state,
            assigneeId: landing.assigneeId,
            cycleId: landing.cycleId,
            source: 'native',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert always returns a row */
        if (!row) throw new Error('capture insert returned no row');
        await enqueueSearchUpsert(input.orgId, 'task', row.id);

        const changeSetId = await recordChangeSet({
          orgId: input.orgId,
          actorId: actorCtx.actorId,
          origin: originFor('capture'),
          summary: `Captured "${row.title}"`,
          changes: [{ kind: 'task', id: row.id, op: 'create', after: trackedFields('task', row) }],
        });

        return jsonResult({
          id: row.id,
          title: row.title,
          state: row.state,
          teamId: row.teamId,
          changeSetId,
        });
      }),
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description:
        'Reverse a change a tool made, by its changeSetId. Omit the id to reverse the most recent change you made in this workspace. Anything edited by someone else since is left alone and reported back rather than overwritten, so a partial undo is a normal outcome worth reading.',
      inputSchema: {
        orgId: orgIdParam,
        changeSetId: z
          .string()
          .optional()
          .describe('The change to reverse. Defaults to your most recent one in this workspace.'),
      },
      outputSchema: {
        summary: z.string().describe('What the reversed change had done.'),
        reverted: z.number().int().describe('How many entities were put back.'),
        skipped: z
          .array(
            z.object({
              kind: z.string(),
              id: z.string(),
              reason: z.string(),
            }),
          )
          .describe('Entities left alone, and why — `changed_since` means someone else edited it.'),
      },
      annotations: {
        title: 'Undo',
        readOnlyHint: false,
        // Reversing a change is itself a change: it can archive rows a create added.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        // Defaulting to the caller's own latest change is scoped to their actor on purpose:
        // "undo that" should never reach for something a colleague did.
        const targetId =
          input.changeSetId ??
          (
            await db
              .select({ id: changeSet.id })
              .from(changeSet)
              .where(
                and(
                  eq(changeSet.organizationId, input.orgId),
                  eq(changeSet.actorId, actorCtx.actorId),
                  isNull(changeSet.undoneAt),
                ),
              )
              .orderBy(desc(changeSet.createdAt))
              .limit(1)
          )[0]?.id;
        if (!targetId) throw new NotFoundError('Nothing to undo');

        const { summary, outcomes } = await undoChangeSet(input.orgId, targetId);
        for (const outcome of outcomes) {
          if (outcome.reverted) await enqueueSearchUpsert(input.orgId, outcome.kind, outcome.id);
        }

        return jsonResult({
          summary,
          reverted: outcomes.filter((outcome) => outcome.reverted).length,
          skipped: outcomes
            .filter((outcome) => !outcome.reverted)
            .map(({ kind, id, reason }) => ({ kind, id, reason: reason ?? 'unknown' })),
        });
      }),
  );
}
