import { agent, agentSession, db, sessionActivity, task } from '@docket/db';
import { SessionTrigger } from '@docket/athena/agent-contract';
import { AgentId, AgentSessionId, SessionActivityId } from '@docket/athena/ids';
import { TaskId } from '@docket/work/ids';
import { registerOptionalTaskTool, type McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { createTaskToolHandler } from './task-tools';
import {
  cancelSession,
  orgIdParam,
  replyToElicitation,
  resolveSessionAction,
} from './tools-shared';

const triggerAgentInputSchema = {
  orgId: orgIdParam,
  agentId: AgentId.describe('The registered agent to run.'),
  taskId: TaskId.optional().describe('Run the agent against this task.'),
  trigger: SessionTrigger.optional(),
  prompt: z.string().optional().describe('An opening instruction for the session.'),
};

const sessionRefOutputSchema = {
  id: AgentSessionId,
  status: z.string().describe('The session lifecycle status after the call.'),
};

/** Every session tool takes the session it acts on; only the verb differs. */
const sessionIdParam = AgentSessionId.describe('The agent session to act on.');

/** Register run_agent and manage_session on `server`. */
export function registerSessionTools(server: McpRegistrar, ctx: McpContext): void {
  const triggerAgent = (input: z.infer<z.ZodObject<typeof triggerAgentInputSchema>>) =>
    runTool(async () => {
      const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
      await authorize(actorCtx, 'contribute', {
        kind: 'organization',
        id: input.orgId,
        orgId: input.orgId,
      });

      const agentRows = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.id, input.agentId), eq(agent.organizationId, input.orgId)))
        .limit(1);
      if (!agentRows[0]) throw new NotFoundError('Agent not found');

      if (input.taskId !== undefined) {
        await authorize(actorCtx, 'contribute', {
          kind: 'task',
          id: input.taskId,
          orgId: input.orgId,
        });
        const taskRows = await db
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .limit(1);
        if (!taskRows[0]) throw new NotFoundError('Task not found');
      }

      const row = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(agentSession)
          .values({
            organizationId: input.orgId,
            agentId: input.agentId,
            taskId: input.taskId,
            trigger: input.trigger ?? 'delegation',
            status: 'pending',
            initiatorId: actorCtx.actorId,
          })
          .returning();
        const created = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!created) throw new Error('agent session insert returned no row');

        // Thread the freeform prompt through to the run: persist it as the session's
        // first `response` activity (no schema brief column), so `runSession` derives
        // it as the runtime `task` brief when the session is not task-bound. A
        // task-bound session keeps the task title as its brief; the prompt still rides
        // along as the opening human entry in the visible stream.
        if (input.prompt !== undefined) {
          await tx.insert(sessionActivity).values({
            sessionId: created.id,
            organizationId: input.orgId,
            type: 'response',
            body: { text: input.prompt },
          });
        }
        return created;
      });
      await enqueueSearchUpsert(input.orgId, 'agent_session', row.id);
      return jsonResult({ id: row.id, status: row.status });
    });

  registerOptionalTaskTool(
    server,
    'run_agent',
    {
      title: 'Run agent',
      description:
        'Start an agent working — on a task, or on a freeform instruction. Returns the session, which manage_session then drives: answering its questions, approving or rejecting what it proposes, or stopping it.',
      inputSchema: triggerAgentInputSchema,
      outputSchema: sessionRefOutputSchema,
      annotations: {
        title: 'Run agent',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        // Dispatching an agent run reaches an external runtime → open world.
        openWorldHint: true,
      },
      execution: { taskSupport: 'optional' },
    },
    createTaskToolHandler<typeof triggerAgentInputSchema>(triggerAgent),
    triggerAgent,
  );

  server.registerTool(
    'manage_session',
    {
      title: 'Manage agent session',
      description:
        'Drive a running agent session: `respond` answers a question it asked, `approve` and `reject` decide on the action it is waiting on, and `cancel` stops it. These were four tools with four shapes, but they are one thing — a decision about a session that is waiting on you.',
      inputSchema: {
        orgId: orgIdParam,
        sessionId: sessionIdParam,
        action: z
          .enum(SESSION_ACTIONS)
          .describe(
            'What to do. `respond` needs `activityId` and `body`; the rest need neither, since they act on whatever the session is currently waiting on.',
          ),
        activityId: SessionActivityId.optional().describe(
          'The question being answered. Required for `respond`.',
        ),
        body: z
          .string()
          .min(1)
          .optional()
          .describe('The answer to give the agent. Required for `respond`.'),
      },
      outputSchema: {
        id: AgentSessionId,
        status: z.string().describe('The session lifecycle status after the call.'),
      },
      annotations: {
        readOnlyHint: false,
        // `approve` executes whatever the agent proposed, and `cancel` ends a run.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Deciding on a proposed action is an `assign`-level act (permissions §9.3), exactly as
        // the agent-sessions router gates its approve route; answering and cancelling are
        // lifecycle acts gated on `contribute`.
        const needsAssign = input.action === 'approve' || input.action === 'reject';
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, needsAssign ? 'assign' : 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const result = await runSessionAction(input.orgId, input.sessionId, input);
        await enqueueSearchUpsert(input.orgId, 'agent_session', result.id);
        return jsonResult(result);
      }),
  );
}

/** The decisions a caller can make about a session that is waiting on them. */
const SESSION_ACTIONS = ['respond', 'approve', 'reject', 'cancel'] as const;

/** One session action, already authorized. */
interface SessionActionInput {
  readonly action: (typeof SESSION_ACTIONS)[number];
  readonly activityId?: string | undefined;
  readonly body?: string | undefined;
}

/**
 * Apply one session action.
 *
 * @param orgId - The organization the session runs in.
 * @param sessionId - The session.
 * @param input - What to do.
 * @returns the session and its status afterwards.
 * @throws {ValidationError} When `respond` is missing the question or the answer.
 */
async function runSessionAction(
  orgId: string,
  sessionId: string,
  input: SessionActionInput,
): Promise<{ id: string; status: string }> {
  switch (input.action) {
    case 'respond': {
      if (input.activityId === undefined || input.body === undefined) {
        throw new ValidationError(
          new z.ZodError([
            {
              code: 'custom',
              path: ['action'],
              message: 'Responding needs both activityId and body.',
              input: input.action,
            },
          ]),
        );
      }
      const status = await replyToElicitation(orgId, sessionId, input.activityId, input.body);
      return { id: sessionId, status };
    }
    case 'approve':
      return resolveSessionAction(orgId, sessionId, 'approved');
    case 'reject':
      return resolveSessionAction(orgId, sessionId, 'rejected');
    case 'cancel':
      return cancelSession(orgId, sessionId);
  }
}
