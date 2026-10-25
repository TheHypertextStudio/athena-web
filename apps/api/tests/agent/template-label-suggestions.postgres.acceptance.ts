/** Real PostgreSQL request convergence and restricted-role reads of every actual stored body. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@docket/db';
import { labelConversionFixture } from '../support/label-conversion-fixtures';
import { installTestProductEntitlementFixture } from '../support/product-entitlement';
import { one } from '../support/routes-harness';
import {
  prepareLabelTemplateSuggestion,
  saveLabelTemplateSuggestion,
} from '../../src/agent/template-label-suggestions';
import { persistTemplateToolProposal } from '../../src/agent/template-proposal-loop';
import { decideTemplateProposal } from '../../src/agent/template-proposal-review';

const visibleBodies = { transcript: 1, proposal: 1, draft: 1, receipt: 1 };
const url = process.env['LABEL_SUGGESTION_PG_URL'] ?? '';
const client = postgres(url, { max: 2, prepare: false });
beforeAll(async () => {
  const target = new URL(url);
  expect(target.hostname).toBe('127.0.0.1');
  expect(target.pathname).toBe('/proposal_oct25');
  expect(process.env['DATABASE_URL']).toBe(url);
  const [row] = await client<
    { version: number; database: string }[]
  >`select current_setting('server_version_num')::integer as version, current_database() as database`;
  expect(row?.version).toBeGreaterThanOrEqual(180000);
  expect(row?.database).toBe('proposal_oct25');
  await installTestProductEntitlementFixture({ exec: (sql) => client.unsafe(sql) });
  await client.unsafe(
    'grant select on actor,agent,agent_session,session_template_proposal,agent_session_transcript,change_set,change_set_entry,template to proposal_oct25_reader',
  );
});
afterAll(async () => {
  await schema.closeDb();
  await client.end();
});

it('serializes duplicate exact-source requests through the normal durable recorder', async () => {
  const f = await labelConversionFixture(schema);
  const selection = {
    labelGroupId: f.group.id,
    labelId: f.standIn.id,
    kind: 'task' as const,
    workIds: [f.work.id],
  };
  const preview = await prepareLabelTemplateSuggestion(f.caller, selection);
  const [a, b] = await Promise.all([
    saveLabelTemplateSuggestion(f.caller, { ...selection, fingerprint: preview.fingerprint }),
    saveLabelTemplateSuggestion(f.caller, { ...selection, fingerprint: preview.fingerprint }),
  ]);
  expect(a.id).toBe(b.id);
  expect(
    await schema.db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, a.externalRunRef ?? '')),
  ).toHaveLength(1);
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.work.id))),
  ).toEqual(f.work);
});

async function otherWorkspaceAuthor(organizationId: string, userId: string) {
  const member = one(
    await schema.db
      .insert(schema.actor)
      .values({
        organizationId: organizationId,
        kind: 'human',
        userId: userId,
        displayName: 'Other workspace author',
      })
      .returning(),
  );
  await schema.db.insert(schema.grant).values({
    organizationId: organizationId,
    subjectKind: 'actor',
    subjectId: member.id,
    resourceKind: 'organization',
    resourceId: organizationId,
    capabilities: ['manage'],
    effect: 'allow',
    cascades: true,
  });
  return member;
}

it('restricts actual transcript, proposal, kept canonical draft and receipt bodies to the original reviewer', async () => {
  const f = await labelConversionFixture(schema),
    other = await labelConversionFixture(schema);
  const member = await otherWorkspaceAuthor(f.orgId, other.caller.userId);
  const selection = {
    labelGroupId: f.group.id,
    labelId: f.standIn.id,
    kind: 'task' as const,
    workIds: [f.work.id],
  };
  const checked = await prepareLabelTemplateSuggestion(f.caller, selection);
  const session = await saveLabelTemplateSuggestion(f.caller, {
    ...selection,
    fingerprint: checked.fingerprint,
  });
  await schema.db.transaction((tx) =>
    persistTemplateToolProposal(tx, {
      sessionId: session.id,
      orgId: f.orgId,
      toolUseId: 'actual-label-context',
      proposalGroupId: schema.genId(),
      execute: false,
      raw: {
        orgId: f.orgId,
        name: 'Private labelled event',
        payload: { targetType: 'task', description: 'Private proposed outline' },
      },
    }),
  );
  const proposal = one(
    await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.sessionId, session.id)),
  );
  const kept = await decideTemplateProposal(f.caller, proposal.activityId, {
    action: 'keep',
    expectedRevision: 0,
    expectedTemplateRevision: null,
  });
  const settled = one(
    await schema.db
      .select()
      .from(schema.sessionTemplateProposal)
      .where(eq(schema.sessionTemplateProposal.activityId, proposal.activityId)),
  );
  async function read(actorId: string, orgId = f.orgId) {
    return client.begin(async (tx) => {
      await tx.unsafe('set local role proposal_oct25_reader');
      await tx`select set_config('docket.organization_id',${orgId},true),set_config('docket.actor_id',${actorId},true)`;
      const [row] = await tx<
        { transcript: number; proposal: number; draft: number; receipt: number }[]
      >`select
        (select count(*)::integer from agent_session_transcript where session_id=${session.id}) as transcript,
        (select count(*)::integer from session_template_proposal where activity_id=${proposal.activityId}) as proposal,
        (select count(*)::integer from template where id=${kept.templateId}) as draft,
        (select count(*)::integer from change_set_entry where change_set_id=${settled.changeSetId}) as receipt`;
      return row;
    });
  }
  expect(await read(f.caller.actorId)).toEqual(visibleBodies);
  expect(await read(member.id)).toEqual({ transcript: 0, proposal: 0, draft: 0, receipt: 0 });
  expect(await read(other.caller.actorId)).toEqual({
    transcript: 0,
    proposal: 0,
    draft: 0,
    receipt: 0,
  });
  expect(await read(f.caller.actorId, other.orgId)).toEqual({
    transcript: 0,
    proposal: 0,
    draft: 0,
    receipt: 0,
  });
  expect(await read('')).toEqual({ transcript: 0, proposal: 0, draft: 0, receipt: 0 });
});
