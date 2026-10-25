/** Task work records, deliberately not a projection of the agent's conversation transcript. */
import { actor, agent, agentSession, db, sessionActivity } from '@docket/db';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { SessionRow } from './task-activity-entries';

/** A reply is work-relevant only when durable question linkage establishes what it answers. */
function knownWorkReply(): SQL<boolean> {
  return sql<boolean>`(${sessionActivity.type} = 'response'
    AND ${sessionActivity.body}->>'author' IS DISTINCT FROM 'athena' AND (
    EXISTS (SELECT 1 FROM session_activity AS question
      WHERE question.session_id = ${sessionActivity.sessionId} AND question.type = 'elicitation'
        AND (question.body->>'toolUseId' = ${sessionActivity.body}->>'toolUseId'
          OR question.id = ${sessionActivity.body}->>'elicitationActivityId'))
    OR EXISTS (SELECT 1 FROM agent_elicitation AS request
      WHERE request.session_id = ${sessionActivity.sessionId}
        AND request.id = ${sessionActivity.body}->>'elicitationId')
  ))`;
}

/** Read task-job questions, linked answers and failures, never ordinary session conversation. */
export async function readTaskSessionActivity(
  taskId: string,
  orgId: string,
  after: SQL | undefined,
  limit: number,
): Promise<SessionRow[]> {
  const performer = alias(actor, 'session_performer');
  const reply = knownWorkReply();
  return db
    .select({
      id: sessionActivity.id,
      sessionId: sessionActivity.sessionId,
      participantReply: reply,
      performerName: performer.displayName,
      executorKind: agentSession.executorKind,
      initiatorId: agentSession.initiatorId,
      type: sessionActivity.type,
      body: sessionActivity.body,
      createdAt: sessionActivity.createdAt,
    })
    .from(sessionActivity)
    .innerJoin(agentSession, eq(sessionActivity.sessionId, agentSession.id))
    .leftJoin(agent, eq(agent.id, agentSession.agentId))
    .leftJoin(performer, eq(performer.id, agent.actorId))
    .where(
      and(
        eq(agentSession.taskId, taskId),
        eq(agentSession.kind, 'job'),
        or(eq(agentSession.organizationId, orgId), eq(agentSession.contextOrganizationId, orgId)),
        inArray(sessionActivity.type, ['response', 'elicitation', 'error']),
        or(inArray(sessionActivity.type, ['elicitation', 'error']), reply),
        after,
      ),
    )
    .orderBy(asc(sessionActivity.createdAt), asc(sessionActivity.id))
    .limit(limit);
}
