import type { z } from 'zod';
import type {
  TemplateTailoringSources,
  TemplateTailoringStatus,
} from '@docket/work/template-gallery-contract';
/** Existing runner delivery and recipient-safe status for saved-context requests. */
import { agentSession, db, sessionTemplateProposal } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import {
  BillingGraceExpiredError,
  CapabilityError,
  ConflictError,
  NotFoundError,
  ProductRequiredError,
} from '../error';
import { admitAthenaGeneration } from './async-runner';
import { driveSession } from './loop';
import { postReplyAndResume } from '../routes/agent-session-runner';
import {
  requireTailoringAuthor,
  requireTailoringCaller,
  tailoringSourceOptions,
  type TailoringCaller,
} from './template-tailoring-context';
import { isTemplateTailoring } from './template-tailoring-policy';
import { tailoredSessionAuthorized } from './template-tailoring';

/** Offer manual selection independently while accurately explaining optional Athena availability. */
export async function listTailoringSources(
  caller: TailoringCaller,
): Promise<z.infer<typeof TemplateTailoringSources>> {
  await requireTailoringCaller(caller);
  try {
    return await tailoringSourceOptions(caller);
  } catch (error) {
    if (error instanceof ProductRequiredError || error instanceof BillingGraceExpiredError)
      return { availability: 'requires_pro' as const, conversations: [], importedWork: [] };
    if (error instanceof CapabilityError)
      return {
        availability: 'authoring_unavailable' as const,
        conversations: [],
        importedWork: [],
      };
    throw error;
  }
}
/** Read only the actual user's request and its persisted Inbox outcomes. */
export async function tailoringStatus(
  caller: TailoringCaller,
  sessionId: string,
): Promise<z.infer<typeof TemplateTailoringStatus>> {
  const session = await ownedRequest(caller, sessionId);
  const proposals = await db
    .select({ id: sessionTemplateProposal.activityId })
    .from(sessionTemplateProposal)
    .where(
      and(
        eq(sessionTemplateProposal.sessionId, session.id),
        eq(sessionTemplateProposal.organizationId, caller.orgId),
        eq(sessionTemplateProposal.recipientUserId, caller.userId),
      ),
    );
  return {
    sessionId: session.id,
    status: session.status,
    proposalIds: proposals.map((row) => row.id),
  };
}
async function ownedRequest(caller: TailoringCaller, sessionId: string) {
  await requireTailoringAuthor(caller);
  const [session] = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.id, sessionId),
        eq(agentSession.ownerUserId, caller.userId),
        eq(agentSession.contextOrganizationId, caller.orgId),
      ),
    );
  if (!session || !isTemplateTailoring(session)) throw new NotFoundError();
  return session;
}
/** Dispatch only pending saved requests; concurrent delivery uses the existing generation lease. */
export async function deliverTailoredRequest(
  caller: TailoringCaller,
  sessionId: string,
): Promise<z.infer<typeof TemplateTailoringStatus>> {
  const session = await ownedRequest(caller, sessionId);
  if (session.status !== 'pending') return tailoringStatus(caller, sessionId);
  if (!(await tailoredSessionAuthorized(session))) throw new ConflictError('Saved context changed');
  try {
    const admission = await admitAthenaGeneration(session, { runnableStatuses: ['pending'] });
    if (admission.mode === 'sync') await driveSession(caller.orgId, session.id);
  } catch (error) {
    // Another HTTP attempt may already own this generation. Its actual state is the answer.
    if (!(error instanceof ConflictError)) throw error;
  }
  return tailoringStatus(caller, sessionId);
}
/** Explicit retry reuses the existing reply/resume protocol and exact retained context. */
export async function retryTailoredRequest(
  caller: TailoringCaller,
  sessionId: string,
): Promise<z.infer<typeof TemplateTailoringStatus>> {
  const session = await ownedRequest(caller, sessionId);
  if (!(await tailoredSessionAuthorized(session))) throw new ConflictError('Saved context changed');
  if (session.status === 'pending') return deliverTailoredRequest(caller, sessionId);
  if (session.status === 'failed')
    await postReplyAndResume(
      caller.orgId,
      session.id,
      caller.actorId,
      'Retry the requested starting-work suggestion from the selected saved context.',
      'principal',
    );
  return tailoringStatus(caller, sessionId);
}
