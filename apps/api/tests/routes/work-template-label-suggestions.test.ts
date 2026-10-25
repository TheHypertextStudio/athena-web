/** Label examples enter the existing restricted proposal pipeline through checked routes. */
import type * as Db from '@docket/db';
import { Hono } from 'hono';
import { beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../../src/context';
import proposals from '../../src/routes/work-template-proposals';
import { labelConversionFixture } from '../support/label-conversion-fixtures';
import { appWithActor, fakeSession, getDb } from '../support/routes-harness';

let schema: typeof Db;
beforeAll(async () => {
  schema = await getDb();
});
const routes = new Hono<AppEnv>().route(
  '/v1/orgs/:orgId/templates/definitions/proposals',
  proposals,
);

it('reviews only explicitly selected actual labelled work without converting it', async () => {
  const f = await labelConversionFixture(schema);
  const client = appWithActor(
    routes,
    f.orgId,
    ['manage'],
    f.caller.actorId,
    fakeSession(f.caller.userId),
  );
  const response = await client.request(
    `/v1/orgs/${f.orgId}/templates/definitions/proposals/label-suggestions/preview`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        labelGroupId: f.group.id,
        labelId: f.standIn.id,
        kind: 'task',
        workIds: [f.work.id],
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    labelGroup: { id: f.group.id, name: 'Work kind' },
    label: { id: f.standIn.id, name: 'Event' },
    work: [{ id: f.work.id, kind: 'task', name: 'Community dinner' }],
    fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});

it('offers only currently authorized source metadata and refuses forged request authority', async () => {
  const f = await labelConversionFixture(schema),
    other = await labelConversionFixture(schema);
  const client = appWithActor(
    routes,
    f.orgId,
    ['manage'],
    f.caller.actorId,
    fakeSession(f.caller.userId),
  );
  const url = `/v1/orgs/${f.orgId}/templates/definitions/proposals/label-suggestions`;
  expect(await (await client.request(url + '/sources')).json()).toMatchObject({
    availability: 'available',
    groups: [{ id: f.group.id, name: f.group.name }],
    labels: [{ id: f.standIn.id, groupId: f.group.id, name: f.standIn.name }],
  });
  await schema.db
    .update(schema.labelGroup)
    .set({ teamId: other.teamId })
    .where(eq(schema.labelGroup.id, f.group.id));
  expect(await (await client.request(url + '/sources')).json()).toEqual({
    availability: 'available',
    groups: [],
    labels: [],
  });
  const response = await client.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      labelGroupId: f.group.id,
      labelId: f.standIn.id,
      kind: 'task',
      workIds: [f.work.id],
      fingerprint: 'a'.repeat(64),
      ownerUserId: f.caller.userId,
    }),
  });
  expect(response.status).toBe(422);
  const foreign = appWithActor(
    routes,
    f.orgId,
    ['manage'],
    other.caller.actorId,
    fakeSession(f.caller.userId),
  );
  expect((await foreign.request(url + '/sources')).status).toBe(404);
});
