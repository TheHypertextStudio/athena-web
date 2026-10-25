/** Saved-context requests must preserve real owner, source and restart boundaries. */
import type * as Db from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { saveTranscript } from '../../src/agent/transcript';
import { prepareTailoredRequest, saveTailoredRequest } from '../../src/agent/template-tailoring';

let schema: typeof Db;
beforeAll(async () => {
  schema = await getMigratedDb();
});
async function fixture() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Human required');
  const caller = { orgId: f.orgId, actorId: f.actorId, userId: f.ctx.principal.userId };
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: caller.userId,
      contextOrganizationId: f.orgId,
      kind: 'chat',
      trigger: 'delegation',
      status: 'completed',
    })
    .returning();
  const source = assertDefined(session);
  await saveTranscript(
    schema.db,
    source.id,
    null,
    [
      {
        role: 'user',
        content: [{ type: 'text', text: 'We organize accessible neighborhood events.' }],
      },
    ],
    caller.userId,
  );
  return {
    ...f,
    caller,
    source,
    selection: { fork: 'nonprofit' as const, sessionIds: [source.id], importedTaskIds: [] },
  };
}
describe('saved-context template tailoring', () => {
  it('stores exact actual context privately and retries converge without creating drafts', async () => {
    const f = await fixture();
    const preview = await prepareTailoredRequest(f.caller, f.selection);
    const input = { ...f.selection, fingerprint: preview.fingerprint };
    const first = await saveTailoredRequest(f.caller, input);
    const repeated = await saveTailoredRequest(f.caller, input);
    expect(repeated.id).toBe(first.id);
    expect(first.ownerUserId).toBe(f.caller.userId);
    const [transcript] = await schema.db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, first.id));
    expect(JSON.stringify(transcript?.messages)).toContain('accessible neighborhood events');
    const activities = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, first.id));
    expect(JSON.stringify(activities)).not.toContain('accessible neighborhood events');
    expect(
      await schema.db
        .select()
        .from(schema.sessionTemplateProposal)
        .where(eq(schema.sessionTemplateProposal.sessionId, first.id)),
    ).toHaveLength(0);
  });
  it('refuses a foreign owned conversation and empty selection before creating a request', async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(
      prepareTailoredRequest(f.caller, { ...f.selection, sessionIds: [other.source.id] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      prepareTailoredRequest(f.caller, { ...f.selection, sessionIds: [] }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('rechecks the saved source fingerprint and preserves the edited conversation', async () => {
    const f = await fixture();
    const preview = await prepareTailoredRequest(f.caller, f.selection);
    await saveTranscript(
      schema.db,
      f.source.id,
      null,
      [{ role: 'user', content: [{ type: 'text', text: 'Updated scope' }] }],
      f.caller.userId,
    );
    await expect(
      saveTailoredRequest(f.caller, { ...f.selection, fingerprint: preview.fingerprint }),
    ).rejects.toMatchObject({ status: 409 });
    const next = await prepareTailoredRequest(f.caller, f.selection);
    expect(next.fingerprint).not.toBe(preview.fingerprint);
  });
  it('rechecks current authoring policy and actual active human identity', async () => {
    const f = await fixture();
    const preview = await prepareTailoredRequest(f.caller, f.selection);
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, f.orgId));
    await expect(
      saveTailoredRequest(f.caller, { ...f.selection, fingerprint: preview.fingerprint }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      prepareTailoredRequest({ ...f.caller, actorId: f.sarahId }, f.selection),
    ).rejects.toMatchObject({ status: 404 });
  });
});

it('forces review-only definitions even when the human normally allows autonomy', async () => {
  const { MockAgentTurnRuntime } = await import('@docket/athena/turn');
  const { driveSession } = await import('../../src/agent/loop');
  const f = await fixture();
  await schema.db.insert(schema.hub).values({
    userId: f.caller.userId,
    preferences: { athena: { approvalMode: 'routine_autonomy' } },
  });
  const preview = await prepareTailoredRequest(f.caller, f.selection);
  const session = await saveTailoredRequest(f.caller, {
    ...f.selection,
    fingerprint: preview.fingerprint,
  });
  const turnRuntime = new MockAgentTurnRuntime({
    script: [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tailored-event',
              name: 'define_template',
              input: {
                orgId: f.orgId,
                name: 'Neighborhood Event',
                payload: {
                  targetType: 'project',
                  description: 'Prepare the actual neighborhood event.',
                },
              },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Review is ready.' }] },
        stopReason: 'end_turn',
      },
    ],
  });
  const result = await driveSession(f.orgId, session.id, { turnRuntime });
  expect(result.status).toBe('awaiting_approval');
  const proposals = await schema.db
    .select()
    .from(schema.sessionTemplateProposal)
    .where(eq(schema.sessionTemplateProposal.sessionId, session.id));
  expect(proposals).toHaveLength(1);
  expect(proposals[0]?.templateId).toBeNull();
});

it('uses only actual authorized imported records and rechecks their edited contents', async () => {
  const { seedMcpUpdateTask } = await import('../mcp/mcp-update-tool-fixtures');
  const f = await fixture(),
    other = await fixture();
  const [source] = await schema.db
    .insert(schema.integration)
    .values({
      organizationId: f.orgId,
      provider: 'linear',
      pattern: 'connector',
      status: 'connected',
    })
    .returning();
  const id = await seedMcpUpdateTask(schema.db, schema, f, {
    source: 'linked',
    sourceIntegrationId: assertDefined(source).id,
    externalId: 'event-1',
    title: 'Volunteer welcome',
    description: 'Imported accessibility preparation',
  });
  const foreign = await seedMcpUpdateTask(schema.db, schema, other, {
    title: 'Foreign private work',
    source: 'linked',
  });
  const selection = { ...f.selection, sessionIds: [], importedTaskIds: [id] };
  const invalid = await seedMcpUpdateTask(schema.db, schema, f, {
    source: 'linked',
    title: 'Unproven import',
  });
  await expect(
    prepareTailoredRequest(f.caller, { ...selection, importedTaskIds: [invalid] }),
  ).rejects.toMatchObject({ status: 404 });
  const missingExternal = await seedMcpUpdateTask(schema.db, schema, f, {
    source: 'linked',
    sourceIntegrationId: assertDefined(source).id,
    title: 'Missing external identity',
  });
  await expect(
    prepareTailoredRequest(f.caller, { ...selection, importedTaskIds: [missingExternal] }),
  ).rejects.toMatchObject({ status: 404 });
  const preview = await prepareTailoredRequest(f.caller, selection);
  expect(preview.importedWorkCount).toBe(1);
  await expect(
    prepareTailoredRequest(f.caller, { ...selection, importedTaskIds: [foreign] }),
  ).rejects.toMatchObject({ status: 404 });
  await schema.db
    .update(schema.task)
    .set({ description: 'Revised imported scope' })
    .where(eq(schema.task.id, id));
  await expect(
    saveTailoredRequest(f.caller, { ...selection, fingerprint: preview.fingerprint }),
  ).rejects.toMatchObject({ status: 409 });
  await schema.db.update(schema.task).set({ visibility: 'private' }).where(eq(schema.task.id, id));
  await schema.db
    .update(schema.grant)
    .set({ cascades: false })
    .where(eq(schema.grant.organizationId, f.orgId));
  await expect(prepareTailoredRequest(f.caller, selection)).rejects.toMatchObject({ status: 404 });
});
it('keeps Free manual availability honest and refuses generation after entitlement revocation', async () => {
  const { listTailoringSources } = await import('../../src/agent/template-tailoring-delivery');
  const f = await fixture();
  const preview = await prepareTailoredRequest(f.caller, f.selection);
  await schema.db
    .delete(schema.organizationProductEntitlement)
    .where(eq(schema.organizationProductEntitlement.organizationId, f.orgId));
  expect(await listTailoringSources(f.caller)).toEqual({
    availability: 'requires_pro',
    conversations: [],
    importedWork: [],
  });
  await expect(
    saveTailoredRequest(f.caller, { ...f.selection, fingerprint: preview.fingerprint }),
  ).rejects.toMatchObject({ status: 402 });
});
it('does not expose reasoning/tool results and cannot directly execute any tool from a restricted session', async () => {
  const { openToolbox } = await import('../../src/agent/toolbox');
  const f = await fixture();
  const preview = await prepareTailoredRequest(f.caller, f.selection);
  const session = await saveTailoredRequest(f.caller, {
    ...f.selection,
    fingerprint: preview.fingerprint,
  });
  const toolbox = await openToolbox({ kind: 'athena', ownerUserId: f.caller.userId }, session.id);
  try {
    expect(toolbox.tools.map((tool) => tool.name)).toEqual(['define_template']);
    expect(
      (await toolbox.callTool('create_task', { orgId: f.orgId, title: 'Should never exist' }))
        .isError,
    ).toBe(true);
    expect(
      (
        await toolbox.callTool('define_template', {
          orgId: f.orgId,
          name: 'Should not auto-save',
          payload: { targetType: 'task' },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await toolbox.close();
  }
});
it('cancels before the provider after source access changes and rejects hallucinated writes', async () => {
  const { MockAgentTurnRuntime } = await import('@docket/athena/turn');
  const { driveSession } = await import('../../src/agent/loop');
  const f = await fixture();
  const preview = await prepareTailoredRequest(f.caller, f.selection);
  const session = await saveTailoredRequest(f.caller, {
    ...f.selection,
    fingerprint: preview.fingerprint,
  });
  await schema.db
    .update(schema.agentSession)
    .set({ contextOrganizationId: null })
    .where(eq(schema.agentSession.id, f.source.id));
  const runtime = new MockAgentTurnRuntime({ script: [] });
  expect((await driveSession(f.orgId, session.id, { turnRuntime: runtime })).status).toBe(
    'canceled',
  );
  const next = await fixture();
  const checked = await prepareTailoredRequest(next.caller, next.selection);
  const request = await saveTailoredRequest(next.caller, {
    ...next.selection,
    fingerprint: checked.fingerprint,
  });
  const badRuntime = new MockAgentTurnRuntime({
    script: [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'create_task',
              id: 'bad',
              input: { orgId: next.orgId, title: 'Forbidden generated task' },
            },
          ],
        },
        stopReason: 'tool_use',
      },
    ],
  });
  await expect(
    driveSession(next.orgId, request.id, { turnRuntime: badRuntime }),
  ).rejects.toMatchObject({ status: 403 });
  const [settled] = await schema.db
    .select()
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, request.id));
  expect(settled?.status).toBe('failed');
  const activities = await schema.db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.sessionId, request.id));
  expect(activities.some((row) => row.type === 'action')).toBe(false);
});
it('keeps provider reasoning/tool results out of copied source context and fingerprints the selected fork', async () => {
  const f = await fixture();
  await saveTranscript(
    schema.db,
    f.source.id,
    null,
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Plan a neighborhood event.' },
          {
            type: 'tool_result',
            toolUseId: 'private-tool',
            content: 'TOOL_SECRET',
            isError: false,
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'REASONING_SECRET', signature: 'signature' },
          { type: 'text', text: 'A useful visible outline.' },
        ],
      },
    ],
    f.caller.userId,
  );
  const preview = await prepareTailoredRequest(f.caller, f.selection);
  expect(
    (await prepareTailoredRequest(f.caller, { ...f.selection, fork: 'personal' })).fingerprint,
  ).not.toBe(preview.fingerprint);
  const session = await saveTailoredRequest(f.caller, {
    ...f.selection,
    fingerprint: preview.fingerprint,
  });
  const [transcript] = await schema.db
    .select()
    .from(schema.agentSessionTranscript)
    .where(eq(schema.agentSessionTranscript.sessionId, session.id));
  expect(JSON.stringify(transcript?.messages)).toContain('A useful visible outline');
  expect(JSON.stringify(transcript?.messages)).not.toMatch(/TOOL_SECRET|REASONING_SECRET/);
});
it('concurrent retries converge and a failed transcript write leaves no request or activity', async () => {
  const { sql } = await import('drizzle-orm');
  const f = await fixture();
  const preview = await prepareTailoredRequest(f.caller, f.selection);
  const pair = await Promise.all([
    saveTailoredRequest(f.caller, { ...f.selection, fingerprint: preview.fingerprint }),
    saveTailoredRequest(f.caller, { ...f.selection, fingerprint: preview.fingerprint }),
  ]);
  expect(pair[0].id).toBe(pair[1].id);
  const failed = await fixture();
  await saveTranscript(
    schema.db,
    failed.source.id,
    null,
    [{ role: 'user', content: [{ type: 'text', text: 'tailoring-rollback-marker' }] }],
    failed.caller.userId,
  );
  const checked = await prepareTailoredRequest(failed.caller, failed.selection);
  await schema.db.execute(
    sql`alter table agent_session_transcript add constraint tailoring_test_rollback check (messages::text not like '%tailoring-rollback-marker%') not valid`,
  );
  try {
    await expect(
      saveTailoredRequest(failed.caller, { ...failed.selection, fingerprint: checked.fingerprint }),
    ).rejects.toThrow();
    const sessions = await schema.db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, 'template-tailor:' + checked.fingerprint));
    expect(sessions).toHaveLength(0);
  } finally {
    await schema.db.execute(
      sql`alter table agent_session_transcript drop constraint tailoring_test_rollback`,
    );
  }
});
