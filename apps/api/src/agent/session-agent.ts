/** Resolve the existing registered-agent policy or the personal Athena identity. */
import { db, actor, agent } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { SessionRow } from '../routes/agent-session-helpers';
import { NotFoundError } from '../error';

/** The execution identity and approval ceiling supplied to the agent loop. */
export interface SessionAgentIdentity {
  readonly approvalPolicy: 'autonomous' | 'suggest' | 'act_with_approval';
  readonly guidance: string | null;
  readonly displayName: string;
  readonly actorId: string | null;
}

/** Load policy without giving personal Athena a workspace actor or widening a registered agent. */
export async function loadSessionAgent(
  session: SessionRow,
  orgId: string,
): Promise<SessionAgentIdentity> {
  if (session.executorKind === 'athena')
    return { approvalPolicy: 'autonomous', guidance: null, displayName: 'Athena', actorId: null };
  const [row] = await db
    .select({
      approvalPolicy: agent.approvalPolicy,
      guidance: agent.guidance,
      displayName: actor.displayName,
      actorId: actor.id,
    })
    .from(agent)
    .innerJoin(actor, eq(agent.actorId, actor.id))
    .where(and(eq(agent.id, session.agentId ?? ''), eq(agent.organizationId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Agent not found');
  return row;
}
