import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../../src/context';
import routes from '../../src/routes/work-template-label-conversion';
import templates from '../../src/routes/templates';
import {
  appWithActor,
  fakeSession,
  getDb,
  one,
  seedTaskAccessOrg,
  seedUserWithHub,
} from '../support/routes-harness';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture(nested = false) {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const userId = await seedUserWithHub(schema.db, schema, 'Conversion human');
  await schema.db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, f.humanActorId));
  const caller = { orgId: f.orgId, actorId: f.humanActorId };
  const group = one(
    await schema.db
      .insert(schema.labelGroup)
      .values({ organizationId: f.orgId, name: 'Kind' })
      .returning(),
  );
  const label = one(
    await schema.db
      .insert(schema.label)
      .values({ organizationId: f.orgId, groupId: group.id, name: 'Event', color: 'blue' })
      .returning(),
  );
  const task = one(
    await schema.db
      .insert(schema.task)
      .values({
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Event',
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
      })
      .returning(),
  );
  await schema.db
    .insert(schema.taskLabel)
    .values({ organizationId: f.orgId, taskId: task.id, labelId: label.id });
  const draft = await createWorkTemplate(
    caller,
    WorkTemplateCreate.parse({
      targetType: 'task',
      scope: 'personal',
      definition: { name: 'Event', payload: { targetType: 'task' } },
    }),
  );
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const app = appWithActor(
    nested
      ? new Hono<AppEnv>().route('/v1/orgs/:orgId/templates', templates)
      : new Hono<AppEnv>().route('/conversion', routes),
    f.orgId,
    ['manage'],
    f.humanActorId,
    fakeSession(userId),
  );
  const choices = {
    labelGroupId: group.id,
    items: [
      {
        kind: 'task',
        id: task.id,
        removeLabelIds: [label.id],
        workTypeId: published.id,
        workTypeVersionId: published.latestPublishedVersionId,
      },
    ],
  };
  const prefix = nested
    ? `/v1/orgs/${f.orgId}/templates/definitions/label-conversions`
    : '/conversion';
  const post = (path: string, body: unknown) =>
    app.request(prefix + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { ...f, choices, post, app, prefix };
}
describe('typed explicit label conversion routes', () => {
  it('undoes an actual session-owned batch through the complete nested template router', async () => {
    const f = await fixture(true);
    const preview = await f.post('/preview', f.choices);
    expect(preview.status).toBe(200);
    const review = (await preview.json()) as { reviewFingerprint: string };
    const requestId = crypto.randomUUID();
    expect(
      (
        await f.post('', {
          ...f.choices,
          requestId,
          expectedReviewFingerprint: review.reviewFingerprint,
        })
      ).status,
    ).toBe(200);
    const reconciled = await f.app.request(f.prefix + '/requests/' + requestId);
    expect(reconciled.status).toBe(200);
    expect(await reconciled.json()).toMatchObject({ state: 'converted', itemCount: 1 });
    const undone = await f.post('/requests/' + requestId + '/undo', {});
    const body = await undone.json();
    expect(undone.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ state: 'undone', itemCount: 1 });
  });
  it('reviews, confirms and reconciles an actual session-owned batch', async () => {
    const f = await fixture(),
      response = await f.post('/preview', f.choices);
    expect(response.status).toBe(200);
    const review = (await response.json()) as { reviewFingerprint: string };
    const requestId = crypto.randomUUID();
    const confirmed = await f.post('', {
      ...f.choices,
      requestId,
      expectedReviewFingerprint: review.reviewFingerprint,
    });
    expect(confirmed.status).toBe(200);
    const receipt = await confirmed.json();
    const reconciled = await f.app.request('/conversion/requests/' + requestId);
    expect(reconciled.status).toBe(200);
    expect(await reconciled.json()).toEqual(receipt);
    const undone = await f.post('/requests/' + requestId + '/undo', {});
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({ state: 'undone', itemCount: 1 });
  });
  it('refuses client authority fields and more than one hundred selected rows', async () => {
    const f = await fixture();
    expect((await f.post('/preview', { ...f.choices, actorId: f.humanActorId })).status).toBe(422);
    expect(
      (
        await f.post('/preview', {
          ...f.choices,
          items: Array.from({ length: 101 }, () => one(f.choices.items)),
        })
      ).status,
    ).toBe(422);
  });
});
