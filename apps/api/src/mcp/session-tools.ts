import { agent, agentSession, db, sessionActivity, task } from '@docket/db';
import { SessionTrigger } from '@docket/types';
import { AgentId, AgentSessionId, SessionActivityId, TaskId } from '@docket/types';
import { registerOptionalTaskTool, type McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
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

/** Register trigger_agent, respond_to_session, approve_action, reject_action, cancel_session. */
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
    'trigger_agent',
    {
      title: 'Trigger agent',
      description:
        'Create an agent session for a registered agent (optionally on a task) to be run.',
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
    'respond_to_session',
    {
      title: 'Respond to session',
      description:
        'Answer an agent elicitation in a live session (resumes an awaiting_input session).',
      inputSchema: {
        orgId: orgIdParam,
        sessionId: sessionIdParam,
        activityId: SessionActivityId.describe('The elicitation activity being answered.'),
        body: z.string().min(1).describe('The answer to give the agent.'),
      },
      outputSchema: {
        sessionId: AgentSessionId,
        status: z.string().describe('The session lifecycle status after the reply.'),
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
        // The reply route gates on `contribute`.
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const status = await replyToElicitation(
          input.orgId,
          input.sessionId,
          input.activityId,
          input.body,
        );
        await enqueueSearchUpsert(input.orgId, 'agent_session', input.sessionId);
        return jsonResult({ sessionId: input.sessionId, status });
      }),
  );

  server.registerTool(
    'approve_action',
    {
      title: 'Approve agent action',
      description:
        'Approve the latest proposed action of an awaiting-approval agent session (resumes it).',
      inputSchema: { orgId: orgIdParam, sessionId: sessionIdParam },
      outputSchema: sessionRefOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // The session approval gate is an `assign`-level act (permissions §9.3), exactly
        // as the agent-sessions router's approve route requires.
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'assign', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await resolveSessionAction(input.orgId, input.sessionId, 'approved');
        await enqueueSearchUpsert(input.orgId, 'agent_session', row.id);
        return jsonResult({ id: row.id, status: row.status });
      }),
  );

  server.registerTool(
    'reject_action',
    {
      title: 'Reject agent action',
      description:
        'Reject the latest proposed action of an awaiting-approval agent session (cancels it).',
      inputSchema: { orgId: orgIdParam, sessionId: sessionIdParam },
      outputSchema: sessionRefOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'assign', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await resolveSessionAction(input.orgId, input.sessionId, 'rejected');
        await enqueueSearchUpsert(input.orgId, 'agent_session', row.id);
        return jsonResult({ id: row.id, status: row.status });
      }),
  );

  server.registerTool(
    'cancel_session',
    {
      title: 'Cancel session',
      description: 'Cancel a non-terminal agent session (stamps endedAt).',
      inputSchema: { orgId: orgIdParam, sessionId: sessionIdParam },
      outputSchema: sessionRefOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Lifecycle transitions are gated on `contribute` in the agent-sessions router.
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await cancelSession(input.orgId, input.sessionId);
        await enqueueSearchUpsert(input.orgId, 'agent_session', row.id);
        return jsonResult({ id: row.id, status: row.status });
      }),
  );
}
