/** Exercise actual persisted Athena turns, private tool dispatch, and Inbox continuation. */
import type * as Db from '@docket/db';
import { MockAgentTurnRuntime } from '@docket/athena/turn';
import { assertDefined } from '@docket/test-utils';
import { and, eq } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import { getMigratedDb } from '../support/db';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { driveSession } from '../../src/agent/loop';
import { decideTemplateProposal } from '../../src/agent/template-proposal-review';
import { decideActivity } from '../../src/routes/agent-session-approval';
let schema: typeof Db;
beforeAll(async () => {
  schema = await getMigratedDb();
});

async function fixture(mode: 'routine_autonomy' | 'ask_before_acting') {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Human fixture required');
  const userId = f.ctx.principal.userId;
  await schema.db
    .insert(schema.hub)
    .values({ userId, preferences: { athena: { approvalMode: mode } } });
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: userId,
      contextOrganizationId: f.orgId,
      status: 'pending',
      trigger: 'delegation',
    })
    .returning();
  const sessionId = assertDefined(session).id;
  await schema.db
    .insert(schema.sessionActivity)
    .values({ sessionId, type: 'response', body: { text: 'Suggest an event template.' } });
  const turnRuntime = new MockAgentTurnRuntime({
    script: [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'event-proposal',
              name: 'define_template',
              input: {
                orgId: f.orgId,
                name: 'Community Event',
                payload: { targetType: 'project', description: 'Private event outline' },
              },
            },
          ],
        },
        stopReason: 'tool_use',
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Ready to review.' }] },
        stopReason: 'end_turn',
      },
    ],
  });
  return { ...f, userId, sessionId, turnRuntime };
}

it('the real review-first loop persists no draft, safe activity, one notice and resumes from Keep', async () => {
  const f = await fixture('ask_before_acting');
  const stopped = await driveSession(f.orgId, f.sessionId, { turnRuntime: f.turnRuntime });
  expect(stopped.status).toBe('awaiting_approval');
  const [proposal] = await schema.db
    .select()
    .from(schema.sessionTemplateProposal)
    .where(eq(schema.sessionTemplateProposal.sessionId, f.sessionId));
  const row = assertDefined(proposal);
  expect(row.templateId).toBeNull();
  const [action] = await schema.db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.id, row.activityId));
  expect(JSON.stringify(action?.body)).not.toContain('Private event outline');
  await expect(
    decideActivity(f.orgId, f.actorId, f.sessionId, row.activityId, { decision: 'approve' }),
  ).rejects.toThrow();
  const kept = await decideTemplateProposal(
    { orgId: f.orgId, actorId: f.actorId, userId: f.userId },
    row.activityId,
    { action: 'keep', expectedRevision: 0, expectedTemplateRevision: null },
  );
  expect(kept.state).toBe('kept');
  const runs = await schema.db
    .select()
    .from(schema.agentSessionRun)
    .where(eq(schema.agentSessionRun.sessionId, f.sessionId));
  const dispatch = await schema.db
    .select()
    .from(schema.agentSessionDispatch)
    .where(
      and(
        eq(schema.agentSessionDispatch.runId, assertDefined(runs[0]).id),
        eq(schema.agentSessionDispatch.action, 'wake'),
      ),
    );
  expect(dispatch).toHaveLength(1);
});
it('the real autonomous loop attaches one unpublished draft and receipt to its original restricted proposal', async () => {
  const f = await fixture('routine_autonomy');
  const result = await driveSession(f.orgId, f.sessionId, { turnRuntime: f.turnRuntime });
  expect(result.status).toBe('completed');
  const proposals = await schema.db
    .select()
    .from(schema.sessionTemplateProposal)
    .where(eq(schema.sessionTemplateProposal.sessionId, f.sessionId));
  expect(proposals).toHaveLength(1);
  const row = assertDefined(proposals[0]);
  expect(row.changeSetId).toBeTruthy();
  const [template] = await schema.db
    .select()
    .from(schema.template)
    .where(eq(schema.template.id, assertDefined(row.templateId)));
  expect(template).toMatchObject({
    ownerActorId: f.actorId,
    publicationState: 'draft',
    latestPublishedVersionId: null,
  });
  const actions = await schema.db
    .select()
    .from(schema.sessionActivity)
    .where(
      and(
        eq(schema.sessionActivity.sessionId, f.sessionId),
        eq(schema.sessionActivity.type, 'action'),
      ),
    );
  expect(actions).toHaveLength(1);
  expect(JSON.stringify(actions)).not.toContain('Private event outline');
});
