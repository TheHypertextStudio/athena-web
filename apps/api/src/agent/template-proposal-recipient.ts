/** Resolve proposal recipients exclusively from persisted session and review-routing authority. */
import { actor, agent, agentSession, type Database } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { CapabilityError, NotFoundError } from '../error';
import { requireTemplateAuthor } from '../lib/templates/authorization';
import { assertProductCapability } from '../product-capability';

/** Actual proposer and human reviewer for a persisted execution. */
export interface TemplateProposalRecipient {
  readonly session: typeof agentSession.$inferSelect;
  readonly proposerActorId: string;
  readonly recipientActorId: string;
  readonly recipientUserId: string;
}

/** Resolve and recheck live assignment/review authority, membership, Pro and authoring policy. */
export async function templateProposalRecipient(
  database: Database,
  sessionId: string,
  orgId: string,
): Promise<TemplateProposalRecipient> {
  const [session] = await database
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, sessionId));
  if (!session) throw new NotFoundError();
  const registered = await registeredReviewer(database, session, orgId);
  const recipientId = registered.recipientId;
  const [recipient] = await database
    .select()
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        recipientId ? eq(actor.id, recipientId) : eq(actor.userId, session.ownerUserId ?? ''),
      ),
    );
  if (!recipient?.userId) throw new NotFoundError();
  const proposerActorId = registered.proposerActorId ?? recipient.id;
  const [proposer] = await database
    .select()
    .from(actor)
    .where(
      and(
        eq(actor.id, proposerActorId),
        eq(actor.organizationId, orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  if (!proposer) throw new NotFoundError();
  await assertProductCapability(orgId, 'athena', database);
  await requireTemplateAuthor({ orgId, actorId: proposerActorId }, database);
  await requireTemplateAuthor({ orgId, actorId: recipient.id }, database);
  return {
    session,
    proposerActorId,
    recipientActorId: recipient.id,
    recipientUserId: recipient.userId,
  };
}

async function registeredReviewer(
  database: Database,
  session: typeof agentSession.$inferSelect,
  orgId: string,
): Promise<{ recipientId: string | null; proposerActorId: string | null }> {
  if (session.executorKind !== 'registered_agent')
    return { recipientId: null, proposerActorId: null };
  let recipientId: string | null = null;
  {
    if (session.organizationId !== orgId || !session.agentId) throw new NotFoundError();
    const [registered] = await database
      .select()
      .from(agent)
      .where(and(eq(agent.id, session.agentId), eq(agent.organizationId, orgId)));
    if (!registered) throw new NotFoundError();
    const proposerActorId = registered.actorId;
    const routing = registered.approvalRouting;
    if (!routing || routing.mode === 'assigner') recipientId = session.initiatorId;
    else if (routing.mode === 'fixed') recipientId = routing.approverActorId ?? null;
    // Role routing does not identify one recipient. Never pick an arbitrary role holder.
    if (!recipientId) throw new CapabilityError();
    return { recipientId, proposerActorId };
  }
}
