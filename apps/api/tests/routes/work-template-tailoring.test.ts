/** Actual authenticated tailoring metadata/checkpoint endpoints, without provider execution. */
import type * as Db from '@docket/db';
import { Hono } from 'hono';
import { beforeAll, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import {
  TemplateTailoringPreview,
  TemplateTailoringSources,
  TemplateTailoringStatus,
} from '@docket/work/template-gallery-contract';
import type { AppEnv } from '../../src/context';
import tailoring from '../../src/routes/work-template-tailoring';
import { saveTailoredRequest } from '../../src/agent/template-tailoring';
import { saveTranscript } from '../../src/agent/transcript';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { appWithActor, fakeSession, getDb } from '../support/routes-harness';
let schema: typeof Db;
beforeAll(async () => {
  schema = await getDb();
});
const routes = new Hono<AppEnv>().route(
  '/v1/orgs/:orgId/templates/definitions/proposals/tailoring',
  tailoring,
);
async function fixture() {
  const f = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
  if (f.ctx.principal.kind !== 'user') throw new Error('Human required');
  const userId = f.ctx.principal.userId;
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: userId,
      contextOrganizationId: f.orgId,
      kind: 'chat',
      trigger: 'delegation',
      status: 'completed',
    })
    .returning();
  const id = assertDefined(session).id;
  await saveTranscript(
    schema.db,
    id,
    null,
    [{ role: 'user', content: [{ type: 'text', text: 'Plan a neighborhood volunteer event.' }] }],
    userId,
  );
  const client = appWithActor(routes, f.orgId, ['contribute'], f.actorId, fakeSession(userId));
  return {
    ...f,
    userId,
    client,
    selection: { fork: 'nonprofit' as const, sessionIds: [id], importedTaskIds: [] },
    url: `/v1/orgs/${f.orgId}/templates/definitions/proposals/tailoring`,
  };
}
it('shows actual authorized source labels and reads only the saved request owned by the caller', async () => {
  const f = await fixture();
  const sources = await f.client.request(f.url + '/sources');
  expect(sources.status).toBe(200);
  expect(TemplateTailoringSources.parse(await sources.json()).conversations).toEqual([
    { id: f.selection.sessionIds[0], label: 'Plan a neighborhood volunteer event.' },
  ]);
  const preview = await f.client.request(f.url + '/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(f.selection),
  });
  expect(preview.status).toBe(200);
  const checked = TemplateTailoringPreview.parse(await preview.json());
  const session = await saveTailoredRequest(
    { orgId: f.orgId, actorId: f.actorId, userId: f.userId },
    { ...f.selection, fingerprint: checked.fingerprint },
  );
  const status = await f.client.request(f.url + '/' + session.id);
  expect(TemplateTailoringStatus.parse(await status.json())).toEqual({
    sessionId: session.id,
    status: 'pending',
    proposalIds: [],
  });
  const foreign = appWithActor(routes, f.orgId, ['contribute'], f.sarahId, fakeSession(f.userId));
  expect((await foreign.request(f.url + '/' + session.id)).status).toBe(404);
});
it('rejects forged source bodies and owner identifiers before any generation request', async () => {
  const f = await fixture();
  const response = await f.client.request(f.url + '/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...f.selection, conversation: 'invented', ownerUserId: f.userId }),
  });
  expect(response.status).toBe(422);
  const request = await f.client.request(f.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...f.selection,
      fingerprint: 'a'.repeat(64),
      definition: { name: 'Bypass' },
    }),
  });
  expect(request.status).toBe(422);
});
