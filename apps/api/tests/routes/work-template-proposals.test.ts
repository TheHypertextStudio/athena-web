/** HTTP review contracts enforce real caller identity and exact reviewed revisions. */
import type * as Db from '@docket/db';
import { TemplateProposalReview } from '@docket/work/work-template-contract';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, expect, it } from 'vitest';
import type { AppEnv } from '../../src/context';
import definitions from '../../src/routes/work-template-definitions';
import { persistTemplateToolProposal } from '../../src/agent/template-proposal-loop';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { appWithActor, fakeSession, getDb } from '../support/routes-harness';
let schema: typeof Db;
beforeAll(async () => {
  schema = await getDb();
});
const routes = new Hono<AppEnv>().route('/v1/orgs/:orgId/templates/definitions', definitions);
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
  await schema.db.transaction((tx) =>
    persistTemplateToolProposal(tx, {
      sessionId: assertDefined(session).id,
      orgId: f.orgId,
      toolUseId: 'route-proposal',
      proposalGroupId: schema.genId(),
      execute: false,
      raw: {
        orgId: f.orgId,
        name: 'Event',
        payload: { targetType: 'project', description: 'Private preparation' },
      },
    }),
  );
  const [proposal] = await schema.db
    .select()
    .from(schema.sessionTemplateProposal)
    .where(eq(schema.sessionTemplateProposal.sessionId, assertDefined(session).id));
  const client = appWithActor(routes, f.orgId, ['contribute'], f.actorId, fakeSession(userId));
  return {
    ...f,
    userId,
    proposal: assertDefined(proposal),
    client,
    url: `/v1/orgs/${f.orgId}/templates/definitions/proposals/${assertDefined(proposal).activityId}`,
  };
}
it('reads exact private content and accepts Adjust into the same canonical editor draft', async () => {
  const f = await fixture();
  const response = await f.client.request(f.url);
  expect(response.status).toBe(200);
  const review = TemplateProposalReview.parse(await response.json());
  expect(review.templateId).toBeNull();
  const saved = await f.client.request(`${f.url}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'adjust',
      expectedRevision: review.revision,
      expectedTemplateRevision: null,
    }),
  });
  expect(saved.status).toBe(200);
  const kept = TemplateProposalReview.parse(await saved.json());
  expect(kept).toMatchObject({ state: 'kept', publicationState: 'draft', hasReceipt: true });
  expect(kept.templateId).toBeTruthy();
});
it('returns404 for another same-workspace actor and409 for a stale review without settling Inbox', async () => {
  const f = await fixture();
  const foreign = appWithActor(routes, f.orgId, ['contribute'], f.sarahId, fakeSession(f.userId));
  expect((await foreign.request(f.url)).status).toBe(404);
  const stale = await f.client.request(`${f.url}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'keep', expectedRevision: 99, expectedTemplateRevision: null }),
  });
  expect(stale.status).toBe(409);
  const [notice] = await schema.db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.id, assertDefined(f.proposal.notificationId)));
  expect(notice?.readAt).toBeNull();
});
it('rejects caller-supplied recipient and definition fields at the HTTP boundary', async () => {
  const f = await fixture();
  const result = await f.client.request(`${f.url}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'keep',
      expectedRevision: 0,
      expectedTemplateRevision: null,
      recipientActorId: f.sarahId,
      definition: { name: 'Injected' },
    }),
  });
  expect(result.status).toBe(422);
});
