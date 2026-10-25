import { persistWaitingAthenaWake } from './async-runner';
/** Recipient-authorized Inbox review over canonical drafts and their existing receipts. */
import {
  actor,
  auditEvent,
  changeSet,
  agentSessionRun,
  notification,
  sessionActivity,
  sessionTemplateProposal,
  type Database,
} from '@docket/db';
import {
  WorkTemplateCreate,
  type TemplateProposalReview,
} from '@docket/work/work-template-contract';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import { draftOf } from '../lib/templates/model';
import { lockTemplate, type TemplateTransaction } from '../lib/templates/persistence';
import {
  createWorkTemplateInTransaction,
  reconcileTemplateCreationEffects,
} from '../lib/templates/service';
import {
  recordChangeSetInTransaction,
  undoChangeSetAtomically,
  type UndoAccessCheck,
} from '../mcp/change-set';
import { catalogChange } from '../mcp/change-set-catalog';
import { athenaProvenance, clientProvenance, originFor } from '../lib/provenance/context';
import { templateProposalRecipient } from './template-proposal-recipient';
import { bindTemplateProposalUndoGuard } from './template-proposal-undo';
import { labelSuggestionContinuation } from './template-label-continuation';

type Proposal = typeof sessionTemplateProposal.$inferSelect;
/** Verified human request identity; no caller-provided author or recipient is accepted. */
export interface TemplateReviewCaller {
  readonly orgId: string;
  readonly actorId: string;
  readonly userId: string;
}
/** Exact proposal and draft revisions visible in the review being acted upon. */
export interface TemplateReviewDecision {
  readonly action: 'keep' | 'adjust' | 'dismiss' | 'undo';
  readonly expectedRevision: number;
  readonly expectedTemplateRevision: number | null;
}

/** Load one recipient-private review and recheck the persisted authority that selected them. */
async function checkedProposal(
  database: Database,
  caller: TemplateReviewCaller,
  id: string,
): Promise<Proposal> {
  const [row] = await database
    .select()
    .from(sessionTemplateProposal)
    .where(
      and(
        eq(sessionTemplateProposal.activityId, id),
        eq(sessionTemplateProposal.organizationId, caller.orgId),
        eq(sessionTemplateProposal.recipientActorId, caller.actorId),
        eq(sessionTemplateProposal.recipientUserId, caller.userId),
      ),
    )
    .for('update');
  if (!row) throw new NotFoundError();
  const recipient = await templateProposalRecipient(database, row.sessionId, caller.orgId);
  if (
    recipient.recipientActorId !== caller.actorId ||
    recipient.recipientUserId !== caller.userId ||
    recipient.proposerActorId !== row.proposerActorId
  )
    throw new NotFoundError();
  return row;
}

/** Project only authorized exact content, including edits made since a draft was proposed. */
async function reviewDetail(
  tx: TemplateTransaction,
  caller: TemplateReviewCaller,
  row: Proposal,
): Promise<TemplateProposalReview> {
  const draft = await reviewDraft(tx, caller, row);
  const labelConversion = await labelSuggestionContinuation(tx, caller, row.sessionId, draft);
  return {
    activityId: row.activityId,
    sessionId: row.sessionId,
    proposerName: await proposerName(tx, row),
    state: row.state,
    revision: row.revision,
    definition: draft ? draftOf(draft) : row.definition,
    templateId: draft?.id ?? (row.state === 'undone' ? row.templateId : null),
    templateRevision: draft?.draftRevision ?? null,
    publicationState:
      draft?.publicationState === 'legacy_pending' ? null : (draft?.publicationState ?? null),
    hasReceipt: hasReviewReceipt(row, caller),
    visibility: 'personal' as const,
    ...(labelConversion ? { labelConversion } : {}),
  };
}

async function proposerName(tx: TemplateTransaction, row: Proposal): Promise<string> {
  const [proposer] = await tx.select().from(actor).where(eq(actor.id, row.proposerActorId));
  return proposer?.kind === 'agent' ? proposer.displayName : 'Athena';
}

function hasReviewReceipt(row: Proposal, caller: TemplateReviewCaller): boolean {
  return (
    row.changeSetId !== null &&
    (row.proposerActorId === caller.actorId || row.state === 'kept' || row.state === 'undone')
  );
}

async function reviewDraft(tx: TemplateTransaction, caller: TemplateReviewCaller, row: Proposal) {
  if (!row.templateId || row.state === 'undone') return null;
  if (row.proposerActorId !== caller.actorId && row.state !== 'kept') return null;
  return lockTemplate(tx, caller.orgId, row.templateId, caller.actorId);
}

/** Read one exact review without changing its approval or notification-read state. */
export async function getTemplateProposalReview(
  caller: TemplateReviewCaller,
  id: string,
): Promise<TemplateProposalReview> {
  return serializableTx(async (tx) =>
    reviewDetail(tx, caller, await checkedProposal(tx, caller, id)),
  );
}

function requireReviewedRevision(row: Proposal, decision: TemplateReviewDecision): void {
  if (row.revision !== decision.expectedRevision)
    throw new ConflictError('Proposal changed during review');
}

/** Settle the original action and Inbox notice in the transaction that performs the decision. */
async function settle(
  tx: TemplateTransaction,
  row: Proposal,
  state: Proposal['state'],
  fields: Partial<Proposal> = {},
) {
  const [saved] = await tx
    .update(sessionTemplateProposal)
    .set({ ...fields, state, revision: row.revision + 1 })
    .where(
      and(
        eq(sessionTemplateProposal.activityId, row.activityId),
        eq(sessionTemplateProposal.revision, row.revision),
      ),
    )
    .returning();
  if (!saved) throw new ConflictError('Proposal changed during review');
  await tx
    .update(sessionActivity)
    .set({ approvalStatus: state === 'kept' ? 'applied' : 'rejected' })
    .where(eq(sessionActivity.id, row.activityId));
  if (row.notificationId)
    await tx
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(eq(notification.id, row.notificationId), eq(notification.userId, row.recipientUserId)),
      );
  await tx.insert(auditEvent).values({
    organizationId: row.organizationId,
    actorId: row.recipientActorId,
    subjectType: 'agent_session',
    subjectId: row.sessionId,
    type: state === 'kept' ? 'approved' : 'rejected',
    metadata: {
      activityId: row.activityId,
      templateReviewState: state,
      proposerActorId: row.proposerActorId,
    },
  });
  const [waiting] = await tx
    .select({ status: agentSessionRun.status })
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, row.sessionId))
    .orderBy(desc(agentSessionRun.generation))
    .limit(1);
  if (waiting?.status === 'waiting') await persistWaitingAthenaWake(tx, row.sessionId);
  return saved;
}

async function proposalOrigin(tx: TemplateTransaction, row: Proposal) {
  const [proposer] = await tx.select().from(actor).where(eq(actor.id, row.proposerActorId));
  if (!proposer) throw new NotFoundError();
  const base =
    proposer.kind === 'agent'
      ? clientProvenance('api', { name: proposer.displayName, agentActorId: proposer.id })
      : athenaProvenance('chat', row.sessionId);
  return originFor('keep_template_proposal', { sessionId: row.sessionId }, base);
}

/** Materialize the exact stored proposal for its human reviewer, or retain their existing draft. */
async function keep(
  tx: TemplateTransaction,
  caller: TemplateReviewCaller,
  row: Proposal,
  decision: TemplateReviewDecision,
) {
  if (row.templateId && row.proposerActorId === caller.actorId) {
    const draft = await lockTemplate(tx, caller.orgId, row.templateId, caller.actorId);
    if (draft.draftRevision !== decision.expectedTemplateRevision)
      throw new ConflictError('Template changed during review');
    if (
      draft.ownerActorId !== caller.actorId ||
      draft.scope !== 'personal' ||
      draft.publicationState !== 'draft'
    )
      throw new ConflictError('Template is no longer a private draft');
    return {
      row: await settle(tx, row, 'kept', { templateRevision: draft.draftRevision }),
      effects: [],
    };
  }
  const created = await createWorkTemplateInTransaction(
    tx,
    caller,
    WorkTemplateCreate.parse({
      targetType: row.definition.payload.targetType,
      scope: 'personal',
      definition: row.definition,
    }),
  );
  const receipt = await recordChangeSetInTransaction(tx, {
    orgId: caller.orgId,
    actorId: caller.actorId,
    origin: await proposalOrigin(tx, row),
    summary: 'Kept a proposed private template',
    changes: [catalogChange('template', null, created.row)],
  });
  if (!receipt) throw new ConflictError('Template receipt was not retained');
  await tx
    .update(changeSet)
    .set({ templateReviewActorId: caller.actorId })
    .where(eq(changeSet.id, receipt));
  return {
    row: await settle(tx, row, 'kept', {
      templateId: created.row.id,
      templateRevision: created.row.draftRevision,
      changeSetId: receipt,
    }),
    effects: created.effects,
  };
}

/** Undo only the receipt bound to this review, with normal later-edit/publication conflict detection. */
async function undo(
  caller: TemplateReviewCaller,
  id: string,
  decision: TemplateReviewDecision,
  adapterGuard?: UndoAccessCheck,
) {
  const checked = await serializableTx(async (tx) => checkedProposal(tx, caller, id));
  if (checked.state === 'undone') return getTemplateProposalReview(caller, id);
  requireReviewedRevision(checked, decision);
  if (
    !checked.changeSetId ||
    (checked.proposerActorId !== caller.actorId && checked.state !== 'kept')
  )
    throw new ConflictError('No reviewed draft to undo');
  await undoChangeSetAtomically(
    caller.orgId,
    checked.changeSetId,
    async ({ tx }) => {
      const row = await checkedProposal(tx, caller, id);
      requireReviewedRevision(row, decision);
      await settle(tx, row, 'undone');
    },
    await bindTemplateProposalUndoGuard(caller, checked.changeSetId, async (tx, entries) => {
      if (adapterGuard) await adapterGuard(tx, entries);
      const row = await checkedProposal(tx, caller, id);
      requireReviewedRevision(row, decision);
      if (
        row.changeSetId !== checked.changeSetId ||
        entries.some(
          (entry) => entry.entityKind !== 'template' || entry.entityId !== row.templateId,
        )
      )
        throw new NotFoundError();
    }),
  );
  return getTemplateProposalReview(caller, id);
}

async function requireReviewReady(tx: TemplateTransaction, row: Proposal): Promise<void> {
  const [activity] = await tx
    .select({ status: sessionActivity.approvalStatus })
    .from(sessionActivity)
    .where(eq(sessionActivity.id, row.activityId))
    .for('update');
  if (!activity || activity.status === 'approved' || activity.status === 'executing')
    throw new ConflictError('Template preparation is still running');
}

/** Execute one revision-bound review decision atomically and return the authoritative continuation. */
export async function decideTemplateProposal(
  caller: TemplateReviewCaller,
  id: string,
  decision: TemplateReviewDecision,
  adapterUndoGuard?: UndoAccessCheck,
): Promise<TemplateProposalReview> {
  if (decision.action === 'undo') return undo(caller, id, decision, adapterUndoGuard);
  const result = await serializableTx(async (tx) => {
    const row = await checkedProposal(tx, caller, id);
    const target = decision.action === 'dismiss' ? 'dismissed' : 'kept';
    if (row.state === target) return { detail: await reviewDetail(tx, caller, row), effects: [] };
    if (row.state !== 'pending') throw new ConflictError('Proposal has already been decided');
    await requireReviewReady(tx, row);
    requireReviewedRevision(row, decision);
    const saved =
      target === 'dismissed'
        ? { row: await settle(tx, row, 'dismissed'), effects: [] }
        : await keep(tx, caller, row, decision);
    return { detail: await reviewDetail(tx, caller, saved.row), effects: saved.effects };
  });
  await reconcileTemplateCreationEffects(result.effects);
  return result.detail;
}

/** Export recipient-private review content only while the account still has its active tenant identity. */
export async function collectTemplateProposalExport(
  database: Database,
  userId: string,
): Promise<{ proposal: Proposal }[]> {
  return database
    .select({ proposal: sessionTemplateProposal })
    .from(sessionTemplateProposal)
    .innerJoin(
      actor,
      and(
        eq(actor.id, sessionTemplateProposal.recipientActorId),
        eq(actor.organizationId, sessionTemplateProposal.organizationId),
      ),
    )
    .where(
      and(
        eq(sessionTemplateProposal.recipientUserId, userId),
        eq(actor.userId, userId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
}
