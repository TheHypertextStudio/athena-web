/** Atomic proposal persistence beside the canonical template and change-set writer. */
import type { NotificationBody } from '@docket/notifications/notification-contract';
import { isDeepStrictEqual } from 'node:util';
import {
  genId,
  notification,
  sessionActivity,
  sessionTemplateProposal,
  type Database,
} from '@docket/db';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../error';
import { templateProposalRecipient } from './template-proposal-recipient';
import { requireLabelSuggestionKind } from './template-label-policy';

/** A proposed definition or a draft already written by its verified executor. */
export interface TemplateProposalWrite {
  readonly sessionId: string;
  readonly orgId: string;
  readonly definition: WorkTemplateDefinition;
  readonly input: Record<string, unknown>;
  readonly activityId?: string;
  readonly toolUseId?: string;
  readonly proposalGroupId?: string;
  readonly execute?: boolean;
  readonly applied?: {
    readonly templateId: string;
    readonly revision: number;
    readonly changeSetId: string;
  };
}

/** Safe notification reference; proposed documents never enter the generic Inbox body. */
export function templateReviewNotification(
  orgId: string,
  sessionId: string,
  activityId: string,
): NotificationBody {
  return {
    title: 'Review a proposed template',
    summary: 'Review the outline and decide whether to keep a private draft.',
    url: `/orgs/${orgId}/work-templates/review/${activityId}`,
    templateReview: {
      activityId,
      sessionId,
      allowedActions: ['keep', 'adjust', 'dismiss', 'undo'],
    },
  };
}

/** Store the private proposal and safe action/notification in the caller's transaction. */
export async function writeTemplateProposal(
  database: Database,
  input: TemplateProposalWrite,
): Promise<string> {
  const recipient = await templateProposalRecipient(database, input.sessionId, input.orgId);
  await requireLabelSuggestionKind(database, input.sessionId, input.definition.payload.targetType);
  const attached = await attachAppliedDraft(database, input);
  if (attached) return attached;
  const repeated = await repeatedProposal(database, input);
  if (repeated) return repeated;
  const activityId = input.activityId ?? genId();
  await insertProposalActivity(database, input, activityId);
  const noticeId = genId();
  await database.insert(notification).values({
    id: noticeId,
    userId: recipient.recipientUserId,
    organizationId: input.orgId,
    type: 'approval_request',
    body: templateReviewNotification(input.orgId, input.sessionId, activityId),
  });
  await database.insert(sessionTemplateProposal).values({
    activityId,
    sessionId: input.sessionId,
    toolUseId: input.toolUseId ?? activityId,
    organizationId: input.orgId,
    recipientActorId: recipient.recipientActorId,
    recipientUserId: recipient.recipientUserId,
    proposerActorId: recipient.proposerActorId,
    definition: input.definition,
    input: input.input,
    notificationId: noticeId,
    templateId: input.applied?.templateId ?? null,
    templateRevision: input.applied?.revision ?? null,
    changeSetId: input.applied?.changeSetId ?? null,
  });
  return activityId;
}

async function attachAppliedDraft(
  database: Database,
  input: TemplateProposalWrite,
): Promise<string | null> {
  if (input.applied) {
    const pending = await database
      .select({ proposal: sessionTemplateProposal })
      .from(sessionTemplateProposal)
      .innerJoin(sessionActivity, eq(sessionActivity.id, sessionTemplateProposal.activityId))
      .where(
        and(
          eq(sessionTemplateProposal.sessionId, input.sessionId),
          eq(sessionTemplateProposal.organizationId, input.orgId),
          eq(sessionTemplateProposal.state, 'pending'),
          eq(sessionActivity.approvalStatus, 'executing'),
        ),
      );
    const matching = pending.find(({ proposal }) => isDeepStrictEqual(proposal.input, input.input));
    if (matching) {
      await database
        .update(sessionTemplateProposal)
        .set({
          templateId: input.applied.templateId,
          templateRevision: input.applied.revision,
          changeSetId: input.applied.changeSetId,
        })
        .where(eq(sessionTemplateProposal.activityId, matching.proposal.activityId));
      return matching.proposal.activityId;
    }
  }
  return null;
}

async function insertProposalActivity(
  database: Database,
  input: TemplateProposalWrite,
  activityId: string,
): Promise<void> {
  const body = {
    action: {
      kind: 'define_template',
      summary: 'Review a proposed work template',
      mode: 'proposal' as const,
      toolCall: {
        connection: 'docket',
        tool: 'define_template',
        input: { orgId: input.orgId, templateProposalId: activityId },
        toolUseId: input.toolUseId ?? activityId,
      },
    },
  };
  await database.insert(sessionActivity).values({
    id: activityId,
    sessionId: input.sessionId,
    organizationId: input.orgId,
    type: 'action',
    approvalStatus: input.applied ? 'applied' : input.execute ? 'approved' : 'proposed',
    body,
    ...(input.proposalGroupId ? { proposalGroupId: input.proposalGroupId } : {}),
  });
}

async function repeatedProposal(
  database: Database,
  input: TemplateProposalWrite,
): Promise<string | null> {
  if (input.toolUseId) {
    const [existing] = await database
      .select()
      .from(sessionTemplateProposal)
      .where(
        and(
          eq(sessionTemplateProposal.sessionId, input.sessionId),
          eq(sessionTemplateProposal.toolUseId, input.toolUseId),
        ),
      );
    if (existing) {
      if (!isDeepStrictEqual(existing.input, input.input))
        throw new ConflictError('Proposal changed');
      return existing.activityId;
    }
  }
  return null;
}
