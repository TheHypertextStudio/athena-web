/** Generic Undo must settle the same recipient-private review as its dedicated Inbox action. */
import { changeSet, db, sessionTemplateProposal } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '../error';
import { tryUndoTemplateCopyChangeSet } from '../lib/template-gallery/undo';
import type { UndoAccessCheck, UndoOutcome } from '../mcp/change-set-undo-access';
import type { TemplateReviewCaller } from './template-proposal-review';

interface BoundReview {
  readonly orgId: string;
  readonly receiptId: string;
  readonly actorId: string;
  readonly userId: string;
}
const reviewedGuards = new WeakMap<UndoAccessCheck, BoundReview>();

/** Bind atomic reentry only after the actual stored receipt and recipient have been checked. */
export async function bindTemplateProposalUndoGuard(
  caller: TemplateReviewCaller,
  receiptId: string,
  guard: UndoAccessCheck,
): Promise<UndoAccessCheck> {
  const [row] = await db
    .select({ id: sessionTemplateProposal.activityId })
    .from(sessionTemplateProposal)
    .innerJoin(changeSet, eq(changeSet.id, sessionTemplateProposal.changeSetId))
    .where(
      and(
        eq(sessionTemplateProposal.organizationId, caller.orgId),
        eq(sessionTemplateProposal.changeSetId, receiptId),
        eq(sessionTemplateProposal.recipientActorId, caller.actorId),
        eq(sessionTemplateProposal.recipientUserId, caller.userId),
        eq(changeSet.organizationId, caller.orgId),
        eq(changeSet.templateReviewActorId, caller.actorId),
      ),
    );
  if (!row) throw new NotFoundError();
  reviewedGuards.set(guard, { ...caller, receiptId });
  return guard;
}

/** Route a proposal receipt through current review authority; unrelated receipts retain their own engine. */
async function tryUndoTemplateProposalReceipt(
  orgId: string,
  receiptId: string,
  guard?: UndoAccessCheck,
): Promise<{ summary: string; outcomes: UndoOutcome[] } | null> {
  const bound = guard ? reviewedGuards.get(guard) : undefined;
  const [receipt] = await db
    .select({
      owner: changeSet.templateReviewActorId,
      summary: changeSet.summary,
      origin: changeSet.origin,
    })
    .from(changeSet)
    .where(and(eq(changeSet.id, receiptId), eq(changeSet.organizationId, orgId)));
  if (
    !receipt?.owner ||
    !['define_template', 'keep_template_proposal'].includes(receipt.origin.tool)
  )
    return null;
  const [proposal] = await db
    .select({
      id: sessionTemplateProposal.activityId,
      actorId: sessionTemplateProposal.recipientActorId,
      userId: sessionTemplateProposal.recipientUserId,
    })
    .from(sessionTemplateProposal)
    .where(
      and(
        eq(sessionTemplateProposal.organizationId, orgId),
        eq(sessionTemplateProposal.changeSetId, receiptId),
      ),
    );
  if (receipt.owner !== proposal?.actorId) throw new NotFoundError();
  if (isBoundReview(bound, orgId, receiptId, proposal)) return null;
  requireCaller(guard, orgId, proposal);
  const identity = { orgId, actorId: proposal.actorId, userId: proposal.userId };
  const { getTemplateProposalReview, decideTemplateProposal } =
    await import('./template-proposal-review');
  const current = await getTemplateProposalReview(identity, proposal.id);
  const result = await decideTemplateProposal(
    identity,
    proposal.id,
    {
      action: 'undo',
      expectedRevision: current.revision,
      expectedTemplateRevision: current.templateRevision,
    },
    guard,
  );
  if (result.state !== 'undone' || !result.templateId) throw new NotFoundError();
  return {
    summary: receipt.summary,
    outcomes: [{ kind: 'template', id: result.templateId, reverted: true }],
  };
}

function isBoundReview(
  bound: BoundReview | undefined,
  orgId: string,
  receiptId: string,
  proposal: Pick<BoundReview, 'actorId' | 'userId'>,
): boolean {
  return (
    bound?.orgId === orgId &&
    bound.receiptId === receiptId &&
    bound.actorId === proposal.actorId &&
    bound.userId === proposal.userId
  );
}
function requireCaller(
  guard: UndoAccessCheck | undefined,
  orgId: string,
  proposal: Pick<BoundReview, 'actorId' | 'userId'>,
): void {
  const caller = guard?.templateCopyCaller;
  if (
    caller?.orgId !== orgId ||
    ('actorId' in caller ? caller.actorId !== proposal.actorId : caller.userId !== proposal.userId)
  )
    throw new NotFoundError();
}

/** Dispatch protected template receipts before the generic engine reads or reverses their snapshots. */
export async function tryUndoTemplateReceipt(
  orgId: string,
  receiptId: string,
  guard?: UndoAccessCheck,
): Promise<{ summary: string; outcomes: UndoOutcome[] } | null> {
  return (
    (await tryUndoTemplateProposalReceipt(orgId, receiptId, guard)) ??
    tryUndoTemplateCopyChangeSet(orgId, receiptId, guard?.templateCopyCaller, guard)
  );
}
