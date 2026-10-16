import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import {
  appWithActor,
  clearDocketPro,
  getDb,
  seedTaskAccessOrg,
  one,
} from '../support/routes-harness';
import type templatesRouter from '../../src/routes/templates';

let schema: typeof DbModule, router: typeof templatesRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/templates')).default;
});
const headers = { 'content-type': 'application/json' };
const definition = {
  name: 'Event',
  payload: { targetType: 'project', description: 'Venue and guests' },
};
async function fixture() {
  const workspace = await seedTaskAccessOrg(schema.db, schema, 'manage');
  await clearDocketPro(schema.db, schema, workspace.orgId);
  return {
    ...workspace,
    app: appWithActor(router, workspace.orgId, ['manage'], workspace.humanActorId),
  };
}
describe('manual template maintenance on Free', () => {
  it('creates, edits, publishes and archives through the canonical interface', async () => {
    const { app } = await fixture();
    const created = await app.request('/definitions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetType: 'project', scope: 'personal', definition }),
    });
    expect(created.status).toBe(201);
    const original = WorkTemplateOut.parse(await created.json());
    const edited = await app.request(`/definitions/${original.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedRevision: original.revision,
        definition: { ...definition, name: 'Community event' },
      }),
    });
    expect(edited.status).toBe(200);
    const draft = WorkTemplateOut.parse(await edited.json());
    const published = await app.request(`/definitions/${draft.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: draft.revision }),
    });
    expect(published.status).toBe(200);
    expect(WorkTemplateOut.parse(await published.json()).latestVersion?.number).toBe(1);
    expect(
      (await app.request(`/definitions/${draft.id}/archive`, { method: 'POST', headers })).status,
    ).toBe(200);
    const ordinary = z
      .object({ items: z.array(WorkTemplateOut) })
      .parse(await (await app.request('/definitions')).json());
    expect(ordinary.items.some((item) => item.id === draft.id)).toBe(false);
    const retained = z
      .object({ items: z.array(WorkTemplateOut) })
      .parse(await (await app.request('/definitions?includeArchived=true')).json());
    expect(retained.items.find((item) => item.id === draft.id)).toMatchObject({
      status: 'archived',
      latestVersion: { number: 1, definition: { name: 'Community event' } },
    });
  });
  it('preserves compatible manual creation, editing and deletion', async () => {
    const { app } = await fixture();
    const created = await app.request('/', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetType: 'project',
        scope: 'personal',
        name: 'Event',
        payload: definition.payload,
      }),
    });
    expect(created.status).toBe(201);
    const original = (await created.json()) as { id: string };
    expect(
      (
        await app.request(`/${original.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ name: 'Community event' }),
        })
      ).status,
    ).toBe(200);
    expect((await app.request(`/${original.id}`, { method: 'DELETE' })).status).toBe(200);
    const reader = appWithActor(router, (await fixture()).orgId, ['view']);
    expect(
      (
        await reader.request('/', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            targetType: 'project',
            name: 'Denied',
            payload: definition.payload,
          }),
        })
      ).status,
    ).toBe(403);
  });
});

it('refuses narrowing a real base template to one team without changing its revision or offerings', async () => {
  const f = await fixture();
  const list = z
    .object({ items: z.array(WorkTemplateOut) })
    .parse(await (await f.app.request('/definitions')).json());
  const base = list.items.find((item) => item.isBase && item.targetType === 'project');
  if (!base) throw new Error('Missing provisioned Project base');
  const before = one(
    await schema.db.select().from(schema.template).where(eq(schema.template.id, base.id)),
  );
  const response = await f.app.request(`/definitions/${base.id}/draft`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ expectedRevision: base.revision, offeredTeamIds: [f.teamId] }),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'conflict' });
  expect(
    one(await schema.db.select().from(schema.template).where(eq(schema.template.id, base.id))),
  ).toEqual(before);
  expect(
    await schema.db
      .select()
      .from(schema.workTypeTeam)
      .where(
        and(
          eq(schema.workTypeTeam.organizationId, f.orgId),
          eq(schema.workTypeTeam.workTypeId, base.id),
        ),
      ),
  ).toEqual([]);
});
