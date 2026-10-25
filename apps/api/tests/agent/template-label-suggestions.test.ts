/** Actual stored examples, policy, restart, and review-only behavior without a provider call. */
import type * as Db from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import { LabelTemplateSuggestionSelection } from '@docket/work/template-gallery-contract';
import { getDb, one, clearDocketPro } from '../support/routes-harness';
import { labelConversionFixture } from '../support/label-conversion-fixtures';
import {
  prepareLabelTemplateSuggestion,
  saveLabelTemplateSuggestion,
} from '../../src/agent/template-label-suggestions';
import { tailoredSessionAuthorized } from '../../src/agent/template-tailoring';

let schema: typeof Db;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture() {
  const f = await labelConversionFixture(schema);
  return {
    ...f,
    selection: {
      labelGroupId: f.group.id,
      labelId: f.standIn.id,
      kind: 'task' as const,
      workIds: [f.work.id],
    },
  };
}
async function saved(f: Awaited<ReturnType<typeof fixture>>) {
  const preview = await prepareLabelTemplateSuggestion(f.caller, f.selection);
  return saveLabelTemplateSuggestion(f.caller, {
    ...f.selection,
    fingerprint: preview.fingerprint,
  });
}
async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id))),
  ).toEqual(f.work);
  const labels = await schema.db
    .select()
    .from(schema.taskLabel)
    .where(eq(schema.taskLabel.taskId, f.work.id));
  expect(labels.map((row) => row.labelId).sort()).toEqual([f.standIn.id, f.unrelated.id].sort());
}

it('checks actual visible selected examples, and keeps bodies only in the restricted transcript', async () => {
  const f = await fixture();
  const session = await saved(f);
  const activity = await schema.db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.sessionId, session.id));
  expect(JSON.stringify(activity)).not.toMatch(/Community dinner|Hand-written notes|Work kind/);
  const transcript = one(
    await schema.db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, session.id)),
  );
  expect(JSON.stringify(transcript.messages)).toContain('Hand-written notes');
  expect(await tailoredSessionAuthorized(session)).toBe(true);
  await unchanged(f);
});

it('fails closed for foreign or hidden examples, wrong labels, archived rows and team groups', async () => {
  const f = await fixture(),
    foreign = await fixture();
  await expect(
    prepareLabelTemplateSuggestion(f.caller, { ...f.selection, workIds: [foreign.work.id] }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    prepareLabelTemplateSuggestion(f.caller, { ...f.selection, labelId: f.unrelated.id }),
  ).rejects.toMatchObject({ status: 404 });
  await schema.db
    .update(schema.task)
    .set({ archivedAt: new Date() })
    .where(eq(schema.task.id, f.work.id));
  await expect(prepareLabelTemplateSuggestion(f.caller, f.selection)).rejects.toMatchObject({
    status: 404,
  });
  await schema.db
    .update(schema.task)
    .set({ archivedAt: null, visibility: 'private' })
    .where(eq(schema.task.id, f.work.id));
  await schema.db
    .update(schema.grant)
    .set({ cascades: false })
    .where(eq(schema.grant.organizationId, f.orgId));
  await expect(prepareLabelTemplateSuggestion(f.caller, f.selection)).rejects.toMatchObject({
    status: 404,
  });
  await schema.db
    .update(schema.labelGroup)
    .set({ teamId: foreign.teamId })
    .where(eq(schema.labelGroup.id, f.group.id));
  await expect(prepareLabelTemplateSuggestion(f.caller, f.selection)).rejects.toMatchObject({
    status: 404,
  });
});

it('accepts source View without source Edit, while requiring current template authoring and Pro', async () => {
  const f = await fixture();
  await schema.db
    .update(schema.grant)
    .set({ cascades: false })
    .where(eq(schema.grant.organizationId, f.orgId));
  await expect(prepareLabelTemplateSuggestion(f.caller, f.selection)).resolves.toMatchObject({
    work: [{ id: f.work.id }],
  });
  await schema.db
    .update(schema.grant)
    .set({ capabilities: ['view'] })
    .where(eq(schema.grant.organizationId, f.orgId));
  await expect(prepareLabelTemplateSuggestion(f.caller, f.selection)).rejects.toMatchObject({
    status: 403,
  });
  await schema.db
    .update(schema.grant)
    .set({ capabilities: ['manage'] })
    .where(eq(schema.grant.organizationId, f.orgId));
  await clearDocketPro(schema.db, schema, f.orgId);
  await expect(prepareLabelTemplateSuggestion(f.caller, f.selection)).rejects.toMatchObject({
    status: 402,
  });
});

it('rejects zero, more than 100, duplicate and caller-supplied source bodies', async () => {
  const f = await fixture();
  for (const value of [
    { ...f.selection, workIds: [] },
    { ...f.selection, workIds: Array(101).fill(f.work.id) },
    { ...f.selection, workIds: [f.work.id, f.work.id] },
    { ...f.selection, body: 'invented' },
  ])
    expect(LabelTemplateSuggestionSelection.safeParse(value).success).toBe(false);
});

it('reordered selections and concurrent retries converge, but current source changes invalidate review and resume', async () => {
  const f = await fixture();
  const next = one(
    await schema.db
      .insert(schema.task)
      .values({
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Volunteer welcome',
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
      })
      .returning(),
  );
  await schema.db
    .insert(schema.taskLabel)
    .values({ organizationId: f.orgId, taskId: next.id, labelId: f.standIn.id });
  const selection = { ...f.selection, workIds: [f.work.id, next.id] };
  const preview = await prepareLabelTemplateSuggestion(f.caller, selection);
  expect(
    (
      await prepareLabelTemplateSuggestion(f.caller, {
        ...selection,
        workIds: [...selection.workIds].reverse(),
      })
    ).fingerprint,
  ).toBe(preview.fingerprint);
  const request = { ...selection, fingerprint: preview.fingerprint };
  const [a, b] = await Promise.all([
    saveLabelTemplateSuggestion(f.caller, request),
    saveLabelTemplateSuggestion(f.caller, request),
  ]);
  expect(a.id).toBe(b.id);
  await schema.db
    .update(schema.task)
    .set({ description: 'A changed source' })
    .where(eq(schema.task.id, next.id));
  await expect(saveLabelTemplateSuggestion(f.caller, request)).rejects.toMatchObject({
    status: 409,
  });
  expect(await tailoredSessionAuthorized(one([a]))).toBe(false);
});

it('label removal invalidates both request and retained session before any provider turn', async () => {
  const f = await fixture();
  const session = await saved(f);
  await schema.db
    .delete(schema.taskLabel)
    .where(and(eq(schema.taskLabel.taskId, f.work.id), eq(schema.taskLabel.labelId, f.standIn.id)));
  expect(await tailoredSessionAuthorized(session)).toBe(false);
  const { MockAgentTurnRuntime } = await import('@docket/athena/turn');
  const { driveSession } = await import('../../src/agent/loop');
  expect(
    (
      await driveSession(f.orgId, session.id, {
        turnRuntime: new MockAgentTurnRuntime({ script: [] }),
      })
    ).status,
  ).toBe('canceled');
});

it('rechecks source contents after a provider turn before retaining any proposed action', async () => {
  const { MockAgentTurnRuntime } = await import('@docket/athena/turn');
  const { driveSession } = await import('../../src/agent/loop');
  const f = await fixture(),
    session = await saved(f);
  const scripted = new MockAgentTurnRuntime({
    script: [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'stale-label-proposal',
              name: 'define_template',
              input: { orgId: f.orgId, name: 'Stale event', payload: { targetType: 'task' } },
            },
          ],
        },
        stopReason: 'tool_use',
      },
    ],
  });
  const runtime: Pick<typeof scripted, 'streamTurn'> = {
    async *streamTurn(input) {
      await schema.db
        .update(schema.task)
        .set({ description: 'Source changed during generation' })
        .where(eq(schema.task.id, f.work.id));
      yield* scripted.streamTurn(input);
    },
  };
  expect((await driveSession(f.orgId, session.id, { turnRuntime: runtime })).status).toBe(
    'canceled',
  );
  expect(
    await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.sessionId, session.id)),
  ).toHaveLength(0);
});

it('rejects forged ordinary writes and cannot execute directly after reopening the saved restricted session', async () => {
  const { MockAgentTurnRuntime } = await import('@docket/athena/turn');
  const { driveSession } = await import('../../src/agent/loop');
  const { openToolbox } = await import('../../src/agent/toolbox');
  const f = await fixture(),
    session = await saved(f);
  const toolbox = await openToolbox({ kind: 'athena', ownerUserId: f.caller.userId }, session.id);
  try {
    expect(toolbox.tools.map((tool) => tool.name)).toEqual(['define_template']);
    expect(
      (
        await toolbox.callTool('define_template', {
          orgId: f.orgId,
          name: 'Bypass',
          payload: { targetType: 'task' },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await toolbox.close();
  }
  await expect(
    driveSession(f.orgId, session.id, {
      turnRuntime: new MockAgentTurnRuntime({
        script: [
          {
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'bad-label-write',
                  name: 'update_task',
                  input: { orgId: f.orgId, id: f.work.id, title: 'Forbidden replacement' },
                },
              ],
            },
            stopReason: 'tool_use',
          },
        ],
      }),
    }),
  ).rejects.toMatchObject({ status: 403 });
  await unchanged(f);
  expect(
    await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, session.id),
          eq(schema.sessionActivity.type, 'action'),
        ),
      ),
  ).toHaveLength(0);
});

it('rejects a provider proposal whose kind differs from the retained label examples', async () => {
  const { MockAgentTurnRuntime } = await import('@docket/athena/turn');
  const { driveSession } = await import('../../src/agent/loop');
  const f = await fixture(),
    session = await saved(f);
  const runtime = new MockAgentTurnRuntime({
    script: [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'wrong-label-kind',
              name: 'define_template',
              input: {
                orgId: f.orgId,
                name: 'Wrong-kind event',
                payload: { targetType: 'project' },
              },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Review ready.' }] },
        stopReason: 'end_turn',
      },
    ],
  });
  await expect(driveSession(f.orgId, session.id, { turnRuntime: runtime })).rejects.toMatchObject({
    status: 403,
  });
  expect(
    await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.sessionId, session.id)),
  ).toHaveLength(0);
  await unchanged(f);
});

it('rolls back the session and activity if private transcript storage fails', async () => {
  const f = await fixture();
  await schema.db
    .update(schema.task)
    .set({ description: 'label-suggestion-rollback' })
    .where(eq(schema.task.id, f.work.id));
  const preview = await prepareLabelTemplateSuggestion(f.caller, f.selection);
  await schema.db.execute(
    sql`alter table agent_session_transcript add constraint label_suggestion_rollback check (messages::text not like '%label-suggestion-rollback%') not valid`,
  );
  try {
    await expect(
      saveLabelTemplateSuggestion(f.caller, { ...f.selection, fingerprint: preview.fingerprint }),
    ).rejects.toThrow();
    expect(
      await schema.db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.externalRunRef, 'template-tailor:' + preview.fingerprint)),
    ).toHaveLength(0);
  } finally {
    await schema.db.execute(
      sql`alter table agent_session_transcript drop constraint label_suggestion_rollback`,
    );
  }
});

it('forces a durable Inbox proposal under autonomy and Keep leaves the original work and labels untouched', async () => {
  const { MockAgentTurnRuntime } = await import('@docket/athena/turn');
  const { driveSession } = await import('../../src/agent/loop');
  const { getTemplateProposalReview, decideTemplateProposal } =
    await import('../../src/agent/template-proposal-review');
  const f = await fixture();
  await schema.db
    .update(schema.hub)
    .set({ preferences: { athena: { approvalMode: 'routine_autonomy' } } })
    .where(eq(schema.hub.userId, f.caller.userId));
  const session = await saved(f);
  const runtime = new MockAgentTurnRuntime({
    script: [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'label-event',
              name: 'define_template',
              input: {
                orgId: f.orgId,
                name: 'Community event',
                payload: {
                  targetType: 'task',
                  description: 'Prepare accessible food and a welcome.',
                },
              },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Review ready.' }] },
        stopReason: 'end_turn',
      },
    ],
  });
  expect((await driveSession(f.orgId, session.id, { turnRuntime: runtime })).status).toBe(
    'awaiting_approval',
  );
  const proposal = one(
    await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.sessionId, session.id)),
  );
  expect(proposal.templateId).toBeNull();
  expect(proposal.notificationId).not.toBeNull();
  await unchanged(f);
  const review = await getTemplateProposalReview(f.caller, proposal.activityId);
  const kept = await decideTemplateProposal(f.caller, proposal.activityId, {
    action: 'keep',
    expectedRevision: review.revision,
    expectedTemplateRevision: review.templateRevision,
  });
  expect(kept.publicationState).toBe('draft');
  expect(kept).not.toHaveProperty('labelConversion');
  await unchanged(f);
  const { publishWorkTemplate } = await import('../../src/lib/templates/service');
  const published = await publishWorkTemplate(
    f.caller,
    assertDefined(kept.templateId),
    assertDefined(kept.templateRevision),
  );
  expect(await getTemplateProposalReview(f.caller, proposal.activityId)).toMatchObject({
    labelConversion: {
      labelGroupId: f.group.id,
      labelId: f.standIn.id,
      workTypeId: published.id,
      workTypeVersionId: published.latestPublishedVersionId,
    },
  });
});
