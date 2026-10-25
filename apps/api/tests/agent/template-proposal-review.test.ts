/** Real persistence and review transitions for recipient-private Athena template proposals. */
import { assertDefined } from '@docket/test-utils';
import type * as Db from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { persistTemplateToolProposal } from '../../src/agent/template-proposal-loop';
import {
  decideTemplateProposal,
  getTemplateProposalReview,
} from '../../src/agent/template-proposal-review';
import { editWorkTemplateDraft, publishWorkTemplate } from '../../src/lib/templates/service';
import { CapabilityError } from '../../src/error';
import { workScheduleUndoAccess } from '../../src/lib/recurrence/work-schedule-undo-access';
import { undoChangeSet, undoChangeSetAtomically } from '../../src/mcp/change-set';
import { WorkTemplateDraftUpdate } from '@docket/work/work-template-contract';

let schema: typeof Db;
beforeAll(async () => {
  schema = await getMigratedDb();
});
async function fixture() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Human fixture required');
  const userId = f.ctx.principal.userId;
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: userId,
      contextOrganizationId: f.orgId,
      status: 'running',
      trigger: 'delegation',
    })
    .returning();
  if (!session) throw new Error('Session required');
  await schema.db.transaction((tx) =>
    persistTemplateToolProposal(tx, {
      sessionId: session.id,
      orgId: f.orgId,
      toolUseId: 'proposal-call',
      proposalGroupId: schema.genId(),
      execute: false,
      raw: {
        orgId: f.orgId,
        name: 'Private Event',
        payload: { targetType: 'project', description: 'Secret preparation outline' },
      },
    }),
  );
  const [proposal] = await schema.db
    .select()
    .from(schema.sessionTemplateProposal)
    .where(eq(schema.sessionTemplateProposal.sessionId, session.id));
  if (!proposal) throw new Error('Proposal required');
  return { ...f, session, proposal, caller: { orgId: f.orgId, actorId: f.actorId, userId } };
}
async function createdTemplates(orgId: string) {
  return schema.db
    .select()
    .from(schema.template)
    .where(
      and(
        eq(schema.template.organizationId, orgId),
        eq(schema.template.isSeed, false),
        eq(schema.template.isBase, false),
      ),
    );
}
const decision = { action: 'keep' as const, expectedRevision: 0, expectedTemplateRevision: null };

describe('template proposal review', () => {
  it('stores exact review-first content privately without creating a template or leaking it into activity or notification', async () => {
    const f = await fixture();
    expect(await createdTemplates(f.orgId)).toHaveLength(0);
    const [activity] = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, f.proposal.activityId));
    const [notice] = await schema.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, assertDefined(f.proposal.notificationId)));
    expect(JSON.stringify([activity?.body, notice?.body])).not.toContain('Secret preparation');
    expect(await getTemplateProposalReview(f.caller, f.proposal.activityId)).toMatchObject({
      state: 'pending',
      templateId: null,
      definition: { name: 'Private Event', payload: { description: 'Secret preparation outline' } },
    });
    expect(notice?.readAt).toBeNull();
  });
  it('deduplicates a replayed persisted tool use without another proposal or notification', async () => {
    const f = await fixture();
    await schema.db.transaction((tx) =>
      persistTemplateToolProposal(tx, {
        sessionId: f.session.id,
        orgId: f.orgId,
        toolUseId: 'proposal-call',
        proposalGroupId: schema.genId(),
        execute: false,
        raw: f.proposal.input,
      }),
    );
    expect(
      await schema.db
        .select()
        .from(schema.sessionTemplateProposal)
        .where(eq(schema.sessionTemplateProposal.sessionId, f.session.id)),
    ).toHaveLength(1);
    expect(
      await schema.db
        .select()
        .from(schema.notification)
        .where(eq(schema.notification.userId, f.caller.userId)),
    ).toHaveLength(1);
  });
  it('cannot materialize a second draft while the automatic action is executing', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.sessionActivity)
      .set({ approvalStatus: 'executing' })
      .where(eq(schema.sessionActivity.id, f.proposal.activityId));
    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, decision),
    ).rejects.toThrow();
    expect(await createdTemplates(f.orgId)).toHaveLength(0);
  });
  it('keeps the exact definition once with a receipt and atomically settles the action and notification', async () => {
    const f = await fixture();
    const kept = await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    expect(await decideTemplateProposal(f.caller, f.proposal.activityId, decision)).toEqual(kept);
    expect(await createdTemplates(f.orgId)).toHaveLength(1);
    expect(kept).toMatchObject({
      state: 'kept',
      hasReceipt: true,
      publicationState: 'draft',
      definition: f.proposal.definition,
    });
    const [activity] = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, f.proposal.activityId));
    const [notice] = await schema.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, assertDefined(f.proposal.notificationId)));
    expect(activity?.approvalStatus).toBe('applied');
    expect(notice?.readAt).toBeInstanceOf(Date);
    expect(
      await schema.db
        .select()
        .from(schema.workTypeVersion)
        .where(eq(schema.workTypeVersion.workTypeId, assertDefined(kept.templateId))),
    ).toHaveLength(0);
  });
  it('serializes concurrent Keep retries to one canonical draft and one receipt', async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([
      decideTemplateProposal(f.caller, f.proposal.activityId, decision),
      decideTemplateProposal(f.caller, f.proposal.activityId, decision),
    ]);
    expect(first).toEqual(second);
    expect(await createdTemplates(f.orgId)).toHaveLength(1);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toHaveLength(1);
  });
  it('keeps mark-read independent from approval and dismisses without creating a draft', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.notification)
      .set({ readAt: new Date() })
      .where(eq(schema.notification.id, assertDefined(f.proposal.notificationId)));
    expect((await getTemplateProposalReview(f.caller, f.proposal.activityId)).state).toBe(
      'pending',
    );
    await decideTemplateProposal(f.caller, f.proposal.activityId, {
      ...decision,
      action: 'dismiss',
    });
    expect(await createdTemplates(f.orgId)).toHaveLength(0);
    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, decision),
    ).rejects.toThrow();
  });
  it('hides a proposal from another active human and foreign tenants', async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(getTemplateProposalReview(other.caller, f.proposal.activityId)).rejects.toThrow();
    await expect(
      getTemplateProposalReview(
        { ...f.caller, userId: other.caller.userId },
        f.proposal.activityId,
      ),
    ).rejects.toThrow();
    await expect(
      decideTemplateProposal(other.caller, f.proposal.activityId, decision),
    ).rejects.toThrow();
  });
  it('rejects stale proposal revisions without creating a draft or settling the notice', async () => {
    const f = await fixture();
    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, { ...decision, expectedRevision: 1 }),
    ).rejects.toThrow();
    expect(await createdTemplates(f.orgId)).toHaveLength(0);
    const [notice] = await schema.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, assertDefined(f.proposal.notificationId)));
    expect(notice?.readAt).toBeNull();
  });
  it('uses the bound receipt for Undo and treats a retry as the same completed decision', async () => {
    const f = await fixture();
    const kept = await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const input = {
      action: 'undo' as const,
      expectedRevision: kept.revision,
      expectedTemplateRevision: kept.templateRevision,
    };
    const undone = await decideTemplateProposal(f.caller, f.proposal.activityId, input);
    expect(undone.state).toBe('undone');
    expect(await decideTemplateProposal(f.caller, f.proposal.activityId, input)).toEqual(undone);
    expect(await createdTemplates(f.orgId)).toHaveLength(0);
  });
  it('refuses callerless generic Undo of a recipient-private proposal receipt', async () => {
    const f = await fixture();
    await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const [saved] = await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId));
    await expect(undoChangeSet(f.orgId, assertDefined(saved?.changeSetId))).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await getTemplateProposalReview(f.caller, f.proposal.activityId)).toMatchObject({
      state: 'kept',
    });
    expect(await createdTemplates(f.orgId)).toHaveLength(1);
  });
  it('settles the same Inbox review when its actual owner uses generic Undo', async () => {
    const f = await fixture();
    const kept = await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const [saved] = await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId));
    const result = await undoChangeSet(
      f.orgId,
      assertDefined(saved?.changeSetId),
      workScheduleUndoAccess(f.caller),
    );
    expect(result.outcomes).toEqual([{ kind: 'template', id: kept.templateId, reverted: true }]);
    expect(await getTemplateProposalReview(f.caller, f.proposal.activityId)).toMatchObject({
      state: 'undone',
    });
    expect(await createdTemplates(f.orgId)).toHaveLength(0);
    const [activity] = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, f.proposal.activityId));
    const [notice] = await schema.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, assertDefined(f.proposal.notificationId)));
    expect(activity?.approvalStatus).toBe('rejected');
    expect(notice?.readAt).not.toBeNull();
    expect(
      await undoChangeSet(
        f.orgId,
        assertDefined(saved?.changeSetId),
        workScheduleUndoAccess(f.caller),
      ),
    ).toEqual(result);
  });
  it('refuses foreign, wrong-workspace, and purged generic proposal Undo bindings', async () => {
    const f = await fixture();
    await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const [saved] = await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId));
    const receipt = assertDefined(saved?.changeSetId);
    for (const caller of [
      { orgId: f.orgId, actorId: 'other-actor' },
      { orgId: 'other-org', userId: f.caller.userId },
    ]) {
      await expect(
        undoChangeSetAtomically(f.orgId, receipt, undefined, workScheduleUndoAccess(caller)),
      ).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(await getTemplateProposalReview(f.caller, f.proposal.activityId)).toMatchObject({
      state: 'kept',
    });
    await schema.db
      .delete(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId));
    await expect(
      undoChangeSet(f.orgId, receipt, workScheduleUndoAccess(f.caller)),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await createdTemplates(f.orgId)).toHaveLength(1);
  });
  it('rolls back generic proposal Undo settlement after a later draft edit', async () => {
    const f = await fixture();
    const kept = await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const [saved] = await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId));
    await editWorkTemplateDraft(
      f.caller,
      assertDefined(kept.templateId),
      WorkTemplateDraftUpdate.parse({
        expectedRevision: kept.templateRevision,
        definition: { ...kept.definition, name: 'Later work' },
      }),
    );
    await expect(
      undoChangeSet(f.orgId, assertDefined(saved?.changeSetId), workScheduleUndoAccess(f.caller)),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await getTemplateProposalReview(f.caller, f.proposal.activityId)).toMatchObject({
      state: 'kept',
      definition: { name: 'Later work' },
    });
    const [receipt] = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.id, assertDefined(saved?.changeSetId)));
    expect(receipt?.undoneAt).toBeNull();
  });
  it('retains the adapter transaction guard when generic Undo dispatches a proposal', async () => {
    const f = await fixture();
    await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const [saved] = await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId));
    const guard = Object.assign(
      async () => {
        throw new CapabilityError();
      },
      { templateCopyCaller: f.caller },
    );
    await expect(
      undoChangeSet(f.orgId, assertDefined(saved?.changeSetId), guard),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await getTemplateProposalReview(f.caller, f.proposal.activityId)).toMatchObject({
      state: 'kept',
    });
  });
  it('preserves later draft edits and publication when Undo conflicts', async () => {
    const f = await fixture();
    const kept = await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const edited = await editWorkTemplateDraft(
      f.caller,
      assertDefined(kept.templateId),
      WorkTemplateDraftUpdate.parse({
        expectedRevision: kept.templateRevision,
        definition: { ...kept.definition, name: 'My revision' },
      }),
    );
    await publishWorkTemplate(f.caller, edited.id, edited.draftRevision);
    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, {
        action: 'undo',
        expectedRevision: kept.revision,
        expectedTemplateRevision: kept.templateRevision,
      }),
    ).rejects.toThrow();
    expect((await getTemplateProposalReview(f.caller, f.proposal.activityId)).definition.name).toBe(
      'My revision',
    );
  });
  it('rolls back the draft and keeps Inbox actionable if receipt recording fails', async () => {
    const f = await fixture();
    await schema.db.execute(
      sql`alter table change_set add constraint fail_proposal_receipt check(template_review_actor_id is null) not valid`,
    );
    try {
      await expect(
        decideTemplateProposal(f.caller, f.proposal.activityId, decision),
      ).rejects.toThrow();
      expect(await createdTemplates(f.orgId)).toHaveLength(0);
      expect((await getTemplateProposalReview(f.caller, f.proposal.activityId)).state).toBe(
        'pending',
      );
      const [notice] = await schema.db
        .select()
        .from(schema.notification)
        .where(eq(schema.notification.id, assertDefined(f.proposal.notificationId)));
      expect(notice?.readAt).toBeNull();
    } finally {
      await schema.db.execute(sql`alter table change_set drop constraint fail_proposal_receipt`);
    }
  });
  it('rechecks authoring policy and paid capability before a human can keep an automated proposal', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, f.orgId));
    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, decision),
    ).rejects.toThrow();
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'contributors' })
      .where(eq(schema.organization.id, f.orgId));
    await schema.db
      .delete(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, f.orgId));
    await expect(
      decideTemplateProposal(f.caller, f.proposal.activityId, decision),
    ).rejects.toThrow();
    expect(await createdTemplates(f.orgId)).toHaveLength(0);
  });
  it('exports only the active recipient content and purges it with the recipient account', async () => {
    const f = await fixture();
    const { collectTemplateProposalExport } =
      await import('../../src/agent/template-proposal-review');
    expect(await collectTemplateProposalExport(schema.db, f.caller.userId)).toHaveLength(1);
    expect(await collectTemplateProposalExport(schema.db, 'absent')).toHaveLength(0);
    await schema.db.delete(schema.user).where(eq(schema.user.id, f.caller.userId));
    expect(
      await schema.db
        .select()
        .from(schema.sessionTemplateProposal)
        .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId)),
    ).toHaveLength(0);
  });
  it('RLS excludes another active workspace actor from restricted proposal bodies and transcripts', async () => {
    const f = await fixture();
    await schema.db.insert(schema.agentSessionTranscript).values({
      sessionId: f.session.id,
      ownerUserId: f.caller.userId,
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Private provider context' }] },
      ],
    });
    await decideTemplateProposal(f.caller, f.proposal.activityId, decision);
    const [saved] = await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, f.proposal.activityId));
    const receiptId = assertDefined(saved?.changeSetId);
    await expect(
      schema.db
        .update(schema.changeSet)
        .set({ templateReviewActorId: null })
        .where(eq(schema.changeSet.id, receiptId)),
    ).rejects.toThrow();
    await schema.db.execute(sql`create role proposal_test_reader nologin`);
    await schema.db.execute(sql`grant usage on schema public to proposal_test_reader`);
    await schema.db.execute(
      sql`grant select on session_template_proposal, actor, agent, agent_session, agent_session_transcript, change_set, change_set_entry to proposal_test_reader`,
    );
    await schema.db.transaction(async (tx) => {
      await tx.execute(sql`set local role proposal_test_reader`);
      await tx.execute(
        sql`select set_config('docket.organization_id', ${f.orgId}, true), set_config('docket.actor_id', ${f.actorId}, true)`,
      );
      expect(await tx.select().from(schema.sessionTemplateProposal)).toHaveLength(1);
      expect(await tx.select().from(schema.agentSessionTranscript)).toHaveLength(1);
      expect(
        await tx
          .select()
          .from(schema.changeSetEntry)
          .where(eq(schema.changeSetEntry.changeSetId, receiptId)),
      ).toHaveLength(1);
      await tx.execute(sql`select set_config('docket.actor_id', ${f.sarahId}, true)`);
      expect(await tx.select().from(schema.sessionTemplateProposal)).toHaveLength(0);
      expect(await tx.select().from(schema.agentSessionTranscript)).toHaveLength(0);
      expect(
        await tx
          .select()
          .from(schema.changeSetEntry)
          .where(eq(schema.changeSetEntry.changeSetId, receiptId)),
      ).toHaveLength(0);
    });
  });
});
